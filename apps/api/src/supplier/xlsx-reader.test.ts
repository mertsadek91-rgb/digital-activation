import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseSheet } from './sheet-parse.js';
import { MAX_XLSX_BYTES, XlsxReadError, readXlsx } from './xlsx-reader.js';

/**
 * A minimal .xlsx built in memory, laid out like the supplier's list: a title
 * row with the update date, a header, a merged category, a struck-through
 * name (cell font), a partly struck name (rich-text runs) and a price stored
 * as a number with float noise.
 */
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Notes" sheetId="1" r:id="rId1"/>
    <sheet name="Price list" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/>
</Relationships>`;

const STRINGS = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Update Date: 2026-10-20</t></si>
  <si><t>Product category</t></si>
  <si><t>Product name</t></si>
  <si><t>Unit price</t></si>
  <si><t>Office &amp; Windows</t></si>
  <si><t xml:space="preserve">Suite Pro Key 1 PC </t></si>
  <si><t>Win Pro OEM Key</t></si>
  <si><r><t>Antivirus </t></r><r><rPr><strike/><sz val="11"/></rPr><t>Total</t></r></si>
  <si><r><rPr><strike val="0"/></rPr><t>Old</t></r><r><rPr><strike/></rPr><t>Struck runs</t></r></si>
  <si><t>just notes</t></si>
</sst>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/></font><font><strike/><sz val="11"/></font></fonts>
  <cellXfs count="2"><xf fontId="0"/><xf fontId="1"/></cellXfs>
</styleSheet>`;

const NOTES_SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="s"><v>9</v></c></row></sheetData>
</worksheet>`;

const LIST_SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="D1" t="s"><v>0</v></c></row>
    <row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c></row>
    <row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="s"><v>5</v></c><c r="C4"><v>12.499999999999998</v></c></row>
    <row r="5"><c r="A5" s="1"/><c r="B5" t="s" s="1"><v>6</v></c><c r="C5" s="1"><v>20</v></c></row>
    <row r="6"><c r="B6" t="s"><v>7</v></c><c r="C6" t="str"><v>Price fluctuation</v></c></row>
    <row r="7"><c r="B7" t="s"><v>8</v></c><c r="C7" t="inlineStr"><is><t>$3.10</t></is></c></row>
  </sheetData>
  <mergeCells count="1"><mergeCell ref="A4:A7"/></mergeCells>
</worksheet>`;

function xlsx(parts: Record<string, string> = {}): Uint8Array {
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': WORKBOOK,
    'xl/_rels/workbook.xml.rels': RELS,
    'xl/sharedStrings.xml': STRINGS,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': NOTES_SHEET,
    'xl/worksheets/sheet2.xml': LIST_SHEET,
    ...parts,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

describe('readXlsx', () => {
  it('gives one sheet per tab, in tab order', () => {
    const grid = readXlsx(xlsx());
    expect(grid.sheets?.map((sheet) => sheet.properties)).toEqual([
      { sheetId: 0, title: 'Notes' },
      { sheetId: 1, title: 'Price list' },
    ]);
  });

  it('reads the list through parseSheet: categories, strikes, prices, update date', () => {
    const parsed = parseSheet(readXlsx(xlsx()), 1);
    expect(parsed.updatedLabel).toBe('2026-10-20');
    expect(
      parsed.lines.map((line) => [line.name, line.category, line.costUsd, line.rowNumber]),
    ).toEqual([
      ['Suite Pro Key 1 PC', 'Office & Windows', '12.50', 4],
      ['Win Pro OEM Key', 'Office & Windows', '20.00', 5],
      ['Antivirus Total', 'Office & Windows', null, 6],
      ['OldStruck runs', 'Office & Windows', '3.10', 7],
    ]);
    const stock = parsed.lines.map((line) => [line.outOfStock, line.partialStrike]);
    // Cell font struck → out; "Total" of "Antivirus Total" → partial;
    // "Old" explicitly not struck, the rest struck (10 of 13) → partial.
    expect(stock).toEqual([
      [false, false],
      [true, false],
      [false, true],
      [false, true],
    ]);
    expect(parsed.lines[0]?.priceText).toBe('12.5');
    expect(parsed.lines[2]?.priceText).toBe('Price fluctuation');
  });

  it('treats a run with no font of its own as the cell font', () => {
    const strings = STRINGS.replace(
      '<si><t>Win Pro OEM Key</t></si>',
      '<si><r><t>Win Pro </t></r><r><t>OEM Key</t></r></si>',
    );
    const parsed = parseSheet(readXlsx(xlsx({ 'xl/sharedStrings.xml': strings })), 1);
    expect(parsed.lines[1]).toMatchObject({ name: 'Win Pro OEM Key', outOfStock: true });
  });

  it('keeps the position of empty fonts and strings, which are looked up by index', () => {
    const styles = STYLES.replace('<font><sz val="11"/></font>', '<font/>');
    const strings = STRINGS.replace(
      '<si><t>just notes</t></si>',
      '<si/><si><t>just notes</t></si>',
    );
    const notes = NOTES_SHEET.replace('<v>9</v>', '<v>10</v>');
    const grid = readXlsx(
      xlsx({
        'xl/styles.xml': styles,
        'xl/sharedStrings.xml': strings,
        'xl/worksheets/sheet1.xml': notes,
      }),
    );
    expect(grid.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.formattedValue).toBe(
      'just notes',
    );
    const parsed = parseSheet(grid, 1);
    expect(parsed.lines.map((line) => line.outOfStock)).toEqual([false, true, false, false]);
  });

  it('refuses an old .xls, a non-zip and an empty file with a readable reason', () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(() => readXlsx(xls)).toThrow(/\.xls/);
    expect(() => readXlsx(strToU8('name,price\nx,1'))).toThrow(XlsxReadError);
    expect(() => readXlsx(new Uint8Array())).toThrow(XlsxReadError);
  });

  it('refuses a zip that is not a workbook', () => {
    const zip = zipSync({ 'hello.txt': strToU8('hi') });
    expect(() => readXlsx(zip)).toThrow(XlsxReadError);
  });

  it('refuses a file over the size limit before unzipping it', () => {
    expect(() => readXlsx(new Uint8Array(MAX_XLSX_BYTES + 1).fill(0x50))).toThrow(/KB|كيلوبايت/);
  });

  it('refuses a part with a DOCTYPE (entity expansion)', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "aaaaaaaaaa">]><sst><si><t>&a;</t></si></sst>`;
    expect(() => readXlsx(xlsx({ 'xl/sharedStrings.xml': bomb }))).toThrow(XlsxReadError);
  });

  it('refuses parts that unpack far beyond any price list', () => {
    // 50 MiB of one repeated byte compresses to a few kilobytes.
    const huge = new Uint8Array(50 * 1024 * 1024).fill(0x20);
    const zip = zipSync({ 'xl/workbook.xml': strToU8(WORKBOOK), 'xl/sharedStrings.xml': huge });
    expect(zip.byteLength).toBeLessThan(MAX_XLSX_BYTES);
    expect(() => readXlsx(zip)).toThrow(XlsxReadError);
  });

  it('inflates no more than a part declares, when the declared size lies', () => {
    const huge = new Uint8Array(50 * 1024 * 1024).fill(0x20);
    const lying = zipSync({
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(RELS),
      'xl/sharedStrings.xml': huge,
    });
    // Rewrite the declared uncompressed size of every entry (local header and
    // central directory) to 100 bytes; fflate sizes its output buffer from it.
    const view = new DataView(lying.buffer, lying.byteOffset, lying.byteLength);
    for (let at = 0; at + 4 <= lying.length; at += 1) {
      const signature = view.getUint32(at, true);
      if (signature === 0x04034b50) view.setUint32(at + 22, 100, true);
      if (signature === 0x02014b50) view.setUint32(at + 24, 100, true);
    }
    expect(() => readXlsx(lying)).toThrow(XlsxReadError);
  });

  it('refuses a value far below the last real row instead of allocating it', () => {
    const sheet = LIST_SHEET.replace(
      '</sheetData>',
      '<row r="900000"><c r="B900000" t="s"><v>6</v></c></row></sheetData>',
    );
    expect(() => readXlsx(xlsx({ 'xl/worksheets/sheet2.xml': sheet }))).toThrow(/B900000/);
  });

  it('reads a worksheet once, however many tabs point at it', () => {
    const entries = Array.from(
      { length: 15 },
      (_, i) => `<sheet name="Copy ${String(i)}" sheetId="${String(i + 3)}" r:id="rId2"/>`,
    ).join('');
    const workbook = WORKBOOK.replace('</sheets>', `${entries}</sheets>`);
    const grid = readXlsx(xlsx({ 'xl/workbook.xml': workbook }));
    expect(grid.sheets?.map((sheet) => sheet.properties?.title)).toEqual(['Notes', 'Price list']);
  });

  it('refuses a workbook with more tabs than a price list needs', () => {
    const entries = Array.from(
      { length: 25 },
      (_, i) => `<sheet name="T${String(i)}" sheetId="${String(i + 3)}" r:id="rId1"/>`,
    ).join('');
    const workbook = WORKBOOK.replace('</sheets>', `${entries}</sheets>`);
    expect(() => readXlsx(xlsx({ 'xl/workbook.xml': workbook }))).toThrow(/tabs|تبويب/);
  });

  it('refuses a sheet with more cells than the cap, before reading them all', () => {
    const row = (r: number) =>
      `<row r="${String(r)}">${Array.from({ length: 200 }, (_, c) => `<c><v>${String(c)}</v></c>`).join('')}</row>`;
    const sheet = `<worksheet><sheetData>${Array.from({ length: 1100 }, (_, r) => row(r + 1)).join('')}</sheetData></worksheet>`;
    expect(() => readXlsx(xlsx({ 'xl/worksheets/sheet2.xml': sheet }))).toThrow(/cells|خلية/);
  });

  it('cuts merges at the last row with a value, so a whole-column merge costs nothing', () => {
    const merges = Array.from({ length: 2000 }, () => '<mergeCell ref="A2:A1048576"/>').join('');
    const sheet = LIST_SHEET.replace(
      '<mergeCells count="1">',
      `<mergeCells count="2001">${merges}`,
    ).replace('<mergeCell ref="A4:A7"/>', '<mergeCell ref="A4:A1048576"/>');
    const started = Date.now();
    const parsed = parseSheet(readXlsx(xlsx({ 'xl/worksheets/sheet2.xml': sheet })), 1);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(parsed.lines.map((line) => line.category)).toEqual(Array(4).fill('Office & Windows'));
  });

  it('counts merged cells against the cell cap', () => {
    // 20,000 real rows; then merges that each span all of them.
    const rows = Array.from(
      { length: 20_000 },
      (_, i) => `<row r="${String(i + 1)}"><c r="A${String(i + 1)}"><v>1</v></c></row>`,
    ).join('');
    const merges = Array.from({ length: 20 }, () => '<mergeCell ref="A1:A20000"/>').join('');
    const sheet = `<worksheet><sheetData>${rows}</sheetData><mergeCells>${merges}</mergeCells></worksheet>`;
    expect(() => readXlsx(xlsx({ 'xl/worksheets/sheet2.xml': sheet }))).toThrow(/cells|خلية/);
  });

  it('refuses a UTF-16 part, whose DOCTYPE a UTF-8 check would miss', () => {
    const text = '<?xml version="1.0"?><!DOCTYPE sst [<!ENTITY a "a">]><sst/>';
    const utf16 = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i += 1) utf16[i * 2] = text.charCodeAt(i);
    const zip = zipSync({
      'xl/workbook.xml': strToU8(WORKBOOK),
      'xl/_rels/workbook.xml.rels': strToU8(RELS),
      'xl/sharedStrings.xml': utf16,
    });
    expect(() => readXlsx(zip)).toThrow(XlsxReadError);
  });

  it('refuses a cell with more text than any price list line', () => {
    const strings = STRINGS.replace(
      '<si><t>just notes</t></si>',
      `<si><t>${'x'.repeat(2001)}</t></si>`,
    );
    expect(() => readXlsx(xlsx({ 'xl/sharedStrings.xml': strings }))).toThrow(/2000/);
  });

  it('counts a shared string each time a cell uses it', () => {
    // One 1,900-character string in 1,100 cells: 2 MB of text from a tiny zip.
    const strings = STRINGS.replace(
      '<si><t>just notes</t></si>',
      `<si><t>${'x'.repeat(1900)}</t></si>`,
    );
    const rows = Array.from(
      { length: 1100 },
      (_, i) => `<row r="${String(i + 10)}"><c r="B${String(i + 10)}" t="s"><v>9</v></c></row>`,
    ).join('');
    const sheet = LIST_SHEET.replace('</sheetData>', `${rows}</sheetData>`);
    const started = Date.now();
    expect(() =>
      readXlsx(xlsx({ 'xl/sharedStrings.xml': strings, 'xl/worksheets/sheet2.xml': sheet })),
    ).toThrow(XlsxReadError);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('refuses malformed XML as an unreadable file, not a crash', () => {
    // A part cut off mid-tag, and a tag the parser refuses as a prototype key.
    const cut = LIST_SHEET.slice(0, LIST_SHEET.indexOf('</sheetData>')) + '<row r="9"><c';
    const proto = LIST_SHEET.replace('</sheetData>', '<__proto__>x</__proto__></sheetData>');
    expect(() => readXlsx(xlsx({ 'xl/worksheets/sheet2.xml': proto }))).toThrow(XlsxReadError);
    expect(() => readXlsx(xlsx({ 'xl/worksheets/sheet2.xml': cut }))).toThrow(XlsxReadError);
  });

  it('keeps an overlong cell reference out of the message', () => {
    const ref = `B9${'9'.repeat(5000)}`;
    const sheet = LIST_SHEET.replace(
      '</sheetData>',
      `<row r="900000"><c r="${ref}" t="s"><v>6</v></c></row></sheetData>`,
    );
    try {
      readXlsx(xlsx({ 'xl/worksheets/sheet2.xml': sheet }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(XlsxReadError);
      expect((error as Error).message.length).toBeLessThan(400);
    }
  });

  it('skips cells that only carry a style', () => {
    const grid = readXlsx(xlsx());
    const row5 = grid.sheets?.[1]?.data?.[0]?.rowData?.[4]?.values ?? [];
    expect(row5[0]).toBeUndefined();
    expect(row5[1]?.formattedValue).toBe('Win Pro OEM Key');
  });
});
