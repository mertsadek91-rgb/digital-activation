import { XMLParser } from 'fast-xml-parser';
import { unzipSync } from 'fflate';

import { say } from '../common/panel-locale.js';

import type { SheetCell, SheetGrid } from './sheet-parse.js';

/**
 * Reads an uploaded .xlsx into the same grid the Google Sheets API returns,
 * so `parseSheet` handles both without knowing which one it got (TASK-0133).
 *
 * The supplier's Google Sheet was taken down by Google; the list now arrives
 * as an Excel file. An .xlsx keeps what a CSV loses: the strikethrough on a
 * name (out of stock), both on the whole cell and on runs inside it, and the
 * merged category cells.
 *
 * Only the parts that carry those are read: the workbook (tab order), its
 * relationships, the shared strings, the styles (which font is struck) and
 * the worksheets. Each tab becomes one sheet with `sheetId` = its position,
 * so tab 0 is the first one a person sees.
 *
 * The file comes from a staff member, but it is still a zip a stranger could
 * have built: its declared sizes are checked before anything is inflated, a
 * part with a DOCTYPE is refused (an .xlsx never has one, an entity bomb
 * does), and a value far below the last real row is refused rather than
 * allocated. Parsing runs on the event loop, so the work one file can cause
 * is capped too: the inflated size, the tabs, the cells, and each part is
 * parsed once however many tabs point at it.
 */

/** What crosses the wire as base64 in a 2 MiB JSON body. */
export const MAX_XLSX_BYTES = Math.floor(1.4 * 1024 * 1024);
/** Inflated size of every part read, together. A 300-line price list is well under 2 MiB. */
const MAX_INFLATED_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;
const MAX_SHEETS = 20;
/** Cells visited across every tab; the supplier's list has about 2,000. */
const MAX_CELLS = 200_000;
/** One cell's text. The longest the supplier writes is a remark of a sentence or two. */
const MAX_CELL_TEXT = 2_000;
/**
 * Text handed to parseSheet, all cells together. Shared strings are stored
 * once and referenced by index, so a few bytes of zip can repeat one long
 * string in every cell; the cost is counted per use, not per string.
 */
const MAX_TEXT = 2_000_000;

export class XlsxReadError extends Error {}

const ARRAYS = new Set(['sheet', 'Relationship', 'si', 'r', 'font', 'xf', 'row', 'c', 'mergeCell']);

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  htmlEntities: false,
  isArray: (name) => ARRAYS.has(name),
});

type Node = Record<string, unknown>;

export function readXlsx(bytes: Uint8Array): SheetGrid {
  if (bytes.byteLength === 0) throw new XlsxReadError(say('الملف فارغ.', 'The file is empty.'));
  if (bytes.byteLength > MAX_XLSX_BYTES) {
    throw new XlsxReadError(
      say(
        `حجم الملف ${kb(bytes.byteLength)} كيلوبايت، والحد ${kb(MAX_XLSX_BYTES)} كيلوبايت.`,
        `The file is ${kb(bytes.byteLength)} KB; the limit is ${kb(MAX_XLSX_BYTES)} KB.`,
      ),
    );
  }
  // An old binary .xls (OLE2) is the usual wrong file; say so plainly.
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new XlsxReadError(
      say(
        'هذا ملف ‎.xls قديم. افتحه في Excel واحفظه باسم ‎.xlsx ثم ارفعه.',
        'This is an old .xls file. Open it in Excel, save it as .xlsx and upload that.',
      ),
    );
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw notXlsx();

  let parts: Record<string, Uint8Array>;
  try {
    let inflated = 0;
    parts = unzipSync(bytes, {
      filter: (file) => {
        if (
          !/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(
            file.name,
          )
        ) {
          return false;
        }
        // Deflate never makes data much bigger, so a part that is larger packed
        // than it says it is unpacked lies about its size. fflate bounds its
        // output by the declared size, but would still inflate the whole stream.
        if (file.size > file.originalSize + file.originalSize / 64 + 1024) throw notXlsx();
        inflated += file.originalSize;
        if (inflated > MAX_INFLATED_BYTES) throw new XlsxReadError(tooLarge());
        return true;
      },
    });
  } catch (error) {
    if (error instanceof XlsxReadError) throw error;
    throw notXlsx();
  }

  const decoder = new TextDecoder('utf-8');
  const parsed = new Map<string, Node | null>();
  const part = (name: string): Node | null => {
    if (parsed.has(name)) return parsed.get(name) ?? null;
    const data = parts[name];
    let node: Node | null = null;
    if (data) {
      const text = decoder.decode(data);
      // Excel writes UTF-8. A UTF-16 part decodes here with NULs between the
      // letters, which would hide a DOCTYPE from the check below; refuse it.
      if (text.includes('\u0000') || /<!DOCTYPE/i.test(text)) throw notXlsx();
      try {
        node = xml.parse(text) as Node;
      } catch {
        throw notXlsx();
      }
    }
    parsed.set(name, node);
    return node;
  };

  const workbook = part('xl/workbook.xml');
  if (!workbook) throw notXlsx();
  const rels = part('xl/_rels/workbook.xml.rels');
  const targetOf = new Map<string, string>();
  for (const rel of list(child(child(rels, 'Relationships'), 'Relationship'))) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target) targetOf.set(id, resolveTarget(target));
  }

  const strings = list(child(part('xl/sharedStrings.xml'), 'sst', 'si')).map(richText);
  const struckFonts = list(child(part('xl/styles.xml'), 'styleSheet', 'fonts', 'font')).map(
    (font) => flag(child(font, 'strike')) === true,
  );
  const struckStyles = list(child(part('xl/styles.xml'), 'styleSheet', 'cellXfs', 'xf')).map(
    (xf) => struckFonts[Number(attr(xf, 'fontId') ?? 0)] ?? false,
  );

  const entries = list(child(workbook, 'workbook', 'sheets', 'sheet'));
  if (entries.length > MAX_SHEETS) {
    throw new XlsxReadError(
      say(
        `في الملف ${String(entries.length)} تبويباً، والحد ${String(MAX_SHEETS)}. احذف التبويبات الزائدة وأعد الرفع.`,
        `The file has ${String(entries.length)} tabs; the limit is ${String(MAX_SHEETS)}. Delete the extra tabs and upload again.`,
      ),
    );
  }
  const sheets: NonNullable<SheetGrid['sheets']> = [];
  const seen = new Set<string>();
  const budget = { cells: MAX_CELLS, text: MAX_TEXT };
  entries.forEach((entry, index) => {
    const target = targetOf.get(attr(entry, 'id') ?? '');
    // Two tabs never share a worksheet; a file that says so is read once.
    if (!target || seen.has(target)) return;
    seen.add(target);
    const sheet = part(target);
    if (!sheet) return;
    const rowData = rows(sheet, strings, struckStyles, budget);
    sheets.push({
      properties: { sheetId: index, title: attr(entry, 'name') ?? `Sheet${String(index + 1)}` },
      merges: list(child(sheet, 'worksheet', 'mergeCells', 'mergeCell')).flatMap((merge) => {
        const range = parseRange(attr(merge, 'ref') ?? '');
        if (!range) return [];
        // parseSheet walks every row of a merge. Rows past the last value hold
        // nothing to fill, so a merge is cut there ("A2:A1048576" is a common
        // Excel habit, and a file of thousands of them is an easy stall), and
        // what is left is paid for from the same cell budget.
        const clamped = {
          ...range,
          endRowIndex: Math.min(range.endRowIndex, rowData.length),
          endColumnIndex: Math.min(range.endColumnIndex, MAX_COLUMNS),
        };
        const area =
          Math.max(0, clamped.endRowIndex - clamped.startRowIndex) *
          Math.max(0, clamped.endColumnIndex - clamped.startColumnIndex);
        if (area === 0) return [];
        spend(budget, area);
        return [clamped];
      }),
      data: [{ startRow: 0, startColumn: 0, rowData }],
    });
  });
  if (sheets.length === 0) throw notXlsx();
  return { sheets };
}

interface Budget {
  cells: number;
  text: number;
}

/** Cells visited, and merged cells parseSheet will walk, across every tab. */
function spend(budget: Budget, cells: number): void {
  budget.cells -= cells;
  if (budget.cells < 0) {
    throw new XlsxReadError(
      say(
        `في الملف أكثر من ${String(MAX_CELLS)} خلية. أبقِ قائمة الأسعار وحدها وأعد الرفع.`,
        `The file has more than ${String(MAX_CELLS)} cells. Keep only the price list and upload again.`,
      ),
    );
  }
}

/** One worksheet's cells as Google's rowData: index = row - 1, column - 1. */
function rows(
  sheet: Node,
  strings: RichText[],
  struckStyles: boolean[],
  budget: Budget,
): { values: SheetCell[] }[] {
  const out: { values: SheetCell[] }[] = [];
  let nextRow = 1;
  for (const row of list(child(sheet, 'worksheet', 'sheetData', 'row'))) {
    const rowNumber = Number(attr(row, 'r') ?? nextRow);
    nextRow = rowNumber + 1;
    let nextColumn = 1;
    for (const cell of list(child(row, 'c'))) {
      spend(budget, 1);
      // From the file: cut to a cell-reference length before it reaches a message or a log.
      const ref = attr(cell, 'r')?.slice(0, 12);
      const column = ref ? columnOf(ref) : nextColumn;
      nextColumn = column + 1;

      const content = cellText(cell, strings);
      if (content === null || content.text === '') continue;
      if (content.text.length > MAX_CELL_TEXT) {
        throw new XlsxReadError(
          say(
            `نص الخلية ${ref ?? `R${String(rowNumber)}C${String(column)}`} أطول من ${String(MAX_CELL_TEXT)} حرف. اختصره وأعد الرفع.`,
            `The text in ${ref ?? `R${String(rowNumber)}C${String(column)}`} is longer than ${String(MAX_CELL_TEXT)} characters. Shorten it and upload again.`,
          ),
        );
      }
      budget.text -= content.text.length;
      if (budget.text < 0) throw new XlsxReadError(tooLarge());
      if (rowNumber > MAX_ROWS || column > MAX_COLUMNS) {
        throw new XlsxReadError(
          say(
            `في الملف قيمة في الخلية ${ref ?? `R${String(rowNumber)}C${String(column)}`}، أبعد من ${String(MAX_ROWS)} صف أو ${String(MAX_COLUMNS)} عمود. احذفها وأعد الرفع.`,
            `The file has a value at ${ref ?? `R${String(rowNumber)}C${String(column)}`}, beyond ${String(MAX_ROWS)} rows or ${String(MAX_COLUMNS)} columns. Delete it and upload again.`,
          ),
        );
      }

      const struck = struckStyles[Number(attr(cell, 's') ?? 0)] ?? false;
      const value: SheetCell = {
        formattedValue: content.text,
        effectiveFormat: { textFormat: { strikethrough: struck } },
      };
      if (content.runs) value.textFormatRuns = content.runs;
      for (let index = out.length; index < rowNumber; index += 1) out.push({ values: [] });
      const target = out[rowNumber - 1];
      if (target) target.values[column - 1] = value;
    }
  }
  // Holes left by skipped cells stay undefined, as in the API's response.
  return out;
}

interface RichText {
  text: string;
  runs?: { startIndex: number; format: { strikethrough?: boolean } }[];
}

function cellText(cell: Node, strings: RichText[]): RichText | null {
  const type = attr(cell, 't') ?? 'n';
  if (type === 'inlineStr') return richText(child(cell, 'is'));
  const raw = textOf(child(cell, 'v'));
  if (raw === null) return null;
  switch (type) {
    case 's':
      return strings[Number(raw)] ?? null;
    case 'b':
      return { text: raw === '1' ? 'TRUE' : 'FALSE' };
    case 'n': {
      // 12.499999999999998 → 12.5: Excel stores the binary double and shows 15 digits.
      const number = Number(raw);
      return { text: Number.isFinite(number) ? String(Number(number.toPrecision(15))) : raw };
    }
    default:
      return { text: raw };
  }
}

/**
 * A shared or inline string: plain `<t>`, or runs `<r><rPr>…</rPr><t>` with
 * their own font. A run with no `<rPr>` has the cell's font, which is how
 * `struckShare` reads a run without a strikethrough setting.
 */
function richText(node: unknown): RichText {
  const runs = list(child(node, 'r'));
  if (runs.length === 0) return { text: textOf(child(node, 't')) ?? '' };
  let text = '';
  const formats: NonNullable<RichText['runs']> = [];
  for (const run of runs) {
    const properties = child(run, 'rPr');
    const strike =
      properties === undefined ? undefined : flag(child(properties, 'strike')) === true;
    formats.push({
      startIndex: text.length,
      format: strike === undefined ? {} : { strikethrough: strike },
    });
    text += textOf(child(run, 't')) ?? '';
  }
  return { text, runs: formats };
}

// --- small XML helpers ---------------------------------------------------------

function child(node: unknown, ...path: string[]): unknown {
  let current = node;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Node)[key];
  }
  return current;
}

/**
 * Every entry, in order. An empty element (`<font/>`, `<si/>`) parses to "",
 * and it still takes its index: styles and shared strings are looked up by
 * position, so dropping it would shift every later font or string.
 */
function list(node: unknown): Node[] {
  const entries = Array.isArray(node) ? node : node === undefined ? [] : [node];
  return entries.map((entry) => (entry !== null && typeof entry === 'object' ? entry : {}) as Node);
}

function attr(node: unknown, name: string): string | undefined {
  const value = child(node, `@_${name}`);
  return typeof value === 'string' ? value : undefined;
}

/** `<t>x</t>` parses to "x"; `<t xml:space="preserve"> x</t>` to an object with its text. */
function textOf(node: unknown): string | null {
  if (Array.isArray(node)) return node.map((entry) => textOf(entry) ?? '').join('');
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (node !== null && typeof node === 'object') {
    const text = (node as Node)['#text'];
    return typeof text === 'string' || typeof text === 'number' ? String(text) : '';
  }
  return null;
}

/** `<strike/>` is on; `<strike val="0"/>` or `val="false"` is off; absent is undefined. */
function flag(node: unknown): boolean | undefined {
  if (node === undefined) return undefined;
  const value = attr(node, 'val');
  return value === undefined || !['0', 'false'].includes(value);
}

/** "worksheets/sheet1.xml" or "/xl/worksheets/sheet1.xml" → "xl/worksheets/sheet1.xml". */
function resolveTarget(target: string): string {
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

/** "B12" → 2. */
function columnOf(ref: string): number {
  let column = 0;
  for (const letter of /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '') {
    column = column * 26 + (letter.charCodeAt(0) - 64);
  }
  return column;
}

/** "A5:B20" → zero-based, end-exclusive, like the Sheets API's GridRange. */
type GridRange = Required<NonNullable<NonNullable<SheetGrid['sheets']>[number]['merges']>[number]>;

function parseRange(ref: string): GridRange | null {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(ref);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) return null;
  return {
    startRowIndex: Number(match[2]) - 1,
    endRowIndex: Number(match[4]),
    startColumnIndex: columnOf(match[1]) - 1,
    endColumnIndex: columnOf(match[3]),
  };
}

function kb(bytes: number): string {
  return String(Math.round(bytes / 1024));
}

function notXlsx(): XlsxReadError {
  return new XlsxReadError(
    say(
      'تعذّرت قراءة الملف. ارفع ملف Excel بصيغة ‎.xlsx (من Excel أو Google Sheets: تنزيل ← Microsoft Excel).',
      'The file could not be read. Upload an Excel .xlsx file (from Excel, or Google Sheets: Download → Microsoft Excel).',
    ),
  );
}

function tooLarge(): string {
  return say(
    'محتوى الملف بعد فكّ الضغط أكبر من المعقول لقائمة أسعار.',
    'The file is far larger unpacked than a price list could be.',
  );
}
