import { nameKey } from './names.js';

/**
 * Turns a Google Sheets API grid (`spreadsheets.get` with `includeGridData`)
 * into the supplier's price lines.
 *
 * Pure: no network, no database. Everything the supplier's layout does to us
 * is handled here, where a test can pin it:
 *
 *  - The header row is found by its labels ("Product name", "Unit price"),
 *    not assumed to be row 3, and the columns are found the same way. A sheet
 *    whose header no longer has a name and a price column is refused, not
 *    guessed at: a guess is how 300 prices get read from the warranty column.
 *  - The category is a merged cell spanning its group of rows, so a row
 *    inside a merge takes the merge's top-left value.
 *  - "Out of stock" is a strikethrough on the *name* cell. The supplier also
 *    strikes empty remark cells and stray prices for no reason anyone can
 *    tell, so nothing but the name counts. Strikethrough can be on the whole
 *    cell or on runs of its text; a name that is at least 80% struck is out
 *    of stock, and one that is partly struck is flagged for a person.
 *  - An empty price ("Price fluctuation") is a null cost, never zero.
 */

export interface SheetCell {
  formattedValue?: string;
  effectiveFormat?: { textFormat?: { strikethrough?: boolean } };
  userEnteredFormat?: { textFormat?: { strikethrough?: boolean } };
  textFormatRuns?: { startIndex?: number; format?: { strikethrough?: boolean } }[];
}

export interface SheetGrid {
  sheets?: {
    properties?: { sheetId?: number; title?: string };
    merges?: {
      startRowIndex?: number;
      endRowIndex?: number;
      startColumnIndex?: number;
      endColumnIndex?: number;
    }[];
    data?: {
      startRow?: number;
      startColumn?: number;
      rowData?: { values?: SheetCell[] }[];
    }[];
  }[];
}

export interface SupplierLine {
  nameKey: string;
  name: string;
  category: string | null;
  /** Decimal string with two places, or null when the cell has no number. */
  costUsd: string | null;
  priceText: string | null;
  warranty: string | null;
  remarks: string | null;
  outOfStock: boolean;
  partialStrike: boolean;
  wholesaleOnly: boolean;
  /** 1-based, as a person reads it in the sheet. */
  rowNumber: number;
}

export interface ParsedSheet {
  lines: SupplierLine[];
  updatedLabel: string | null;
  warnings: string[];
}

export class SheetShapeError extends Error {}

/** A name at least this struck through is out of stock. */
const STRUCK_SHARE = 0.8;
/** How far down the header row may be. */
const HEADER_SEARCH_ROWS = 25;

export function parseSheet(grid: SheetGrid, sheetGid: number): ParsedSheet {
  const sheets = grid.sheets ?? [];
  const sheet = sheets.find((entry) => (entry.properties?.sheetId ?? 0) === sheetGid);
  if (!sheet) {
    throw new SheetShapeError(
      `The spreadsheet has no tab with gid ${String(sheetGid)} (it has ${String(sheets.length)}).`,
    );
  }

  // The API returns blocks with offsets; flatten into one row/column matrix.
  const cells: (SheetCell | undefined)[][] = [];
  for (const block of sheet.data ?? []) {
    const top = block.startRow ?? 0;
    const left = block.startColumn ?? 0;
    (block.rowData ?? []).forEach((row, r) => {
      const target = (cells[top + r] ??= []);
      (row.values ?? []).forEach((cell, c) => {
        target[left + c] = cell;
      });
    });
  }
  const text = (row: number, col: number): string => clean(cells[row]?.[col]?.formattedValue);

  // --- header -------------------------------------------------------------
  let headerRow = -1;
  const columns = { category: -1, name: -1, price: -1, warranty: -1, remarks: -1 };
  for (let row = 0; row < Math.min(cells.length, HEADER_SEARCH_ROWS); row += 1) {
    const labels = (cells[row] ?? []).map((cell) => clean(cell?.formattedValue).toLowerCase());
    const name = labels.findIndex((label) => /product\s*name/.test(label));
    const price = labels.findIndex((label) => /price/.test(label));
    if (name < 0 || price < 0) continue;
    headerRow = row;
    columns.name = name;
    columns.price = price;
    columns.category = labels.findIndex((label) => /categor/.test(label));
    columns.warranty = labels.findIndex((label) => /warrant/.test(label));
    columns.remarks = labels.findIndex((label) => /remark|note/.test(label));
    break;
  }
  if (headerRow < 0) {
    throw new SheetShapeError(
      'No header row with a "Product name" and a "price" column in the first rows. The supplier may have changed the sheet; nothing was read.',
    );
  }

  // --- the supplier's own "Update Date" ----------------------------------
  let updatedLabel: string | null = null;
  for (let row = 0; row < headerRow && updatedLabel === null; row += 1) {
    for (const cell of cells[row] ?? []) {
      const match = /update\s*date\s*[:：]?\s*(.+)/i.exec(clean(cell?.formattedValue));
      if (match?.[1]) {
        updatedLabel = match[1].trim().slice(0, 80);
        break;
      }
    }
  }

  // --- merged category cells ----------------------------------------------
  const categoryOf = new Map<number, string>();
  if (columns.category >= 0) {
    for (const merge of sheet.merges ?? []) {
      const left = merge.startColumnIndex ?? 0;
      const right = merge.endColumnIndex ?? left + 1;
      if (columns.category < left || columns.category >= right) continue;
      const top = merge.startRowIndex ?? 0;
      const value = text(top, left);
      if (!value) continue;
      for (let row = top; row < (merge.endRowIndex ?? top + 1); row += 1) {
        categoryOf.set(row, value);
      }
    }
  }

  // --- lines ----------------------------------------------------------------
  const lines: SupplierLine[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let lastCategory: string | null = null;

  for (let row = headerRow + 1; row < cells.length; row += 1) {
    const ownCategory = columns.category >= 0 ? text(row, columns.category) : '';
    const category: string | null = ownCategory || categoryOf.get(row) || lastCategory;
    if (ownCategory || categoryOf.has(row)) lastCategory = category;

    const nameCell = cells[row]?.[columns.name];
    const name = clean(nameCell?.formattedValue);
    if (!name) continue;
    const key = nameKey(name);
    if (seen.has(key)) {
      warnings.push(`Row ${String(row + 1)}: "${name}" appears twice; the first one is used.`);
      continue;
    }
    seen.add(key);

    const priceText = text(row, columns.price) || null;
    const struck = struckShare(nameCell);

    lines.push({
      nameKey: key,
      name,
      category,
      costUsd: parseUsd(priceText),
      priceText,
      warranty: columns.warranty >= 0 ? text(row, columns.warranty) || null : null,
      remarks: columns.remarks >= 0 ? text(row, columns.remarks) || null : null,
      outOfStock: struck >= STRUCK_SHARE,
      partialStrike: struck > 0 && struck < STRUCK_SHARE,
      wholesaleOnly: /\bMOQ\b/i.test(name),
      rowNumber: row + 1,
    });
  }

  if (lines.length === 0) {
    throw new SheetShapeError('The header was found but no product rows under it.');
  }
  return { lines, updatedLabel, warnings };
}

/** Whitespace collapsed (line breaks included), trimmed. */
function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * "$1,234.50" → "1234.50". Null for a cell with no number in it. A number
 * written with three or more decimals is rounded to the cent here, once.
 */
export function parseUsd(text: string | null): string | null {
  if (!text) return null;
  // A range ("10-15") is not a price anybody can be charged; leave it for a person.
  if (/\d\s*[-–~]\s*\$?\d/.test(text)) return null;
  // "$.50" is fifty cents, not fifty dollars.
  const match = /\d[\d,]*(?:\.\d+)?|\.\d+/.exec(text);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return (Math.round(value * 100) / 100).toFixed(2);
}

/**
 * Share of the name's visible characters that are struck through, 0..1.
 *
 * A run without its own strikethrough setting inherits the cell's. Run
 * indexes are UTF-16 offsets, which is what JavaScript strings index by.
 */
export function struckShare(cell: SheetCell | undefined): number {
  if (!cell) return 0;
  const value = cell.formattedValue ?? '';
  const cellStruck =
    cell.effectiveFormat?.textFormat?.strikethrough ??
    cell.userEnteredFormat?.textFormat?.strikethrough ??
    false;
  const runs = [...(cell.textFormatRuns ?? [])].sort(
    (a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0),
  );
  if (runs.length === 0) return cellStruck && value.trim() ? 1 : 0;

  let visible = 0;
  let struck = 0;
  // Text before the first run (if it does not start at 0) has the cell format.
  const segments: { from: number; to: number; strike: boolean }[] = [];
  if ((runs[0]?.startIndex ?? 0) > 0) {
    segments.push({ from: 0, to: runs[0]?.startIndex ?? 0, strike: cellStruck });
  }
  runs.forEach((run, index) => {
    segments.push({
      from: run.startIndex ?? 0,
      to: runs[index + 1]?.startIndex ?? value.length,
      strike: run.format?.strikethrough ?? cellStruck,
    });
  });
  for (const segment of segments) {
    const count = value.slice(segment.from, segment.to).replace(/\s/g, '').length;
    visible += count;
    if (segment.strike) struck += count;
  }
  return visible === 0 ? 0 : struck / visible;
}
