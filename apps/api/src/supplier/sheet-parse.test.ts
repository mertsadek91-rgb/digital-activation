import { describe, expect, it } from 'vitest';

import {
  SheetShapeError,
  type SheetCell,
  type SheetGrid,
  parseSheet,
  parseUsd,
  struckShare,
} from './sheet-parse.js';

const v = (formattedValue: string, strike = false): SheetCell => ({
  formattedValue,
  effectiveFormat: { textFormat: { strikethrough: strike } },
});

type Merges = NonNullable<NonNullable<SheetGrid['sheets']>[number]['merges']>;

/** A grid shaped like the supplier's: title rows, a header, merged categories. */
function grid(rows: SheetCell[][], merges: Merges = []): SheetGrid {
  return {
    sheets: [
      {
        properties: { sheetId: 0, title: 'List' },
        merges,
        data: [{ rowData: rows.map((values) => ({ values })) }],
      },
    ],
  };
}

const TITLE = [
  v('Example Wholesale Price List'),
  v(''),
  v(''),
  v(''),
  v(''),
  v('Update Date:  2026-09-30'),
];
const HEADER = [
  v('Product category'),
  v('Product name'),
  v('Unit price'),
  v('Warranty'),
  v('Remarks'),
];

describe('parseSheet', () => {
  it('reads lines under the header, with merged categories and the update date', () => {
    const parsed = parseSheet(
      grid(
        [
          TITLE,
          HEADER,
          [
            v('Office Suite'),
            v('Suite Pro Retail Key 1 PC'),
            v('$1.50'),
            v('7 days'),
            v('Hot Sale'),
          ],
          [v(''), v('Suite Pro Retail Key 5 PC'), v('$35.00'), v('7 days'), v('')],
          [v('Antivirus'), v('Shield 1 Device 1 Year'), v('$1,234.5'), v('1 Year'), v('')],
        ],
        [{ startRowIndex: 2, endRowIndex: 4, startColumnIndex: 0, endColumnIndex: 1 }],
      ),
      0,
    );
    expect(parsed.updatedLabel).toBe('2026-09-30');
    expect(
      parsed.lines.map((line) => [line.name, line.category, line.costUsd, line.rowNumber]),
    ).toEqual([
      ['Suite Pro Retail Key 1 PC', 'Office Suite', '1.50', 3],
      ['Suite Pro Retail Key 5 PC', 'Office Suite', '35.00', 4],
      ['Shield 1 Device 1 Year', 'Antivirus', '1234.50', 5],
    ]);
  });

  it('finds the header and columns by label, wherever they are', () => {
    const parsed = parseSheet(
      grid([
        [v('x')],
        [v('x')],
        [v('Remarks'), v('Unit price'), v('Product name')],
        [v('New'), v('$3'), v('Thing A')],
      ]),
      0,
    );
    expect(parsed.lines[0]).toMatchObject({
      name: 'Thing A',
      costUsd: '3.00',
      remarks: 'New',
      category: null,
    });
  });

  it('treats a struck name as out of stock, and ignores strikes on other cells', () => {
    const parsed = parseSheet(
      grid([
        HEADER,
        [v('C'), v('Struck name', true), v('$18.00', true), v('1 Year', true), v('')],
        [v(''), v('Only remarks struck'), v('$7.00'), v('6 Month'), v('', true)],
      ]),
      0,
    );
    expect(parsed.lines.map((line) => [line.name, line.outOfStock])).toEqual([
      ['Struck name', true],
      ['Only remarks struck', false],
    ]);
  });

  it('keeps an empty price as no cost, never zero', () => {
    const parsed = parseSheet(
      grid([HEADER, [v('C'), v('Fluctuating'), v(''), v('7 days'), v('Price fluctuation')]]),
      0,
    );
    expect(parsed.lines[0]).toMatchObject({
      costUsd: null,
      priceText: null,
      remarks: 'Price fluctuation',
    });
  });

  it('flags minimum-order lines and collapses line breaks in names', () => {
    const parsed = parseSheet(
      grid([HEADER, [v('C'), v('Box Package With Key\nMOQ≥50 pieces'), v('$10'), v(''), v('')]]),
      0,
    );
    expect(parsed.lines[0]).toMatchObject({
      name: 'Box Package With Key MOQ≥50 pieces',
      wholesaleOnly: true,
    });
  });

  it('uses the first of two identical names and warns', () => {
    const parsed = parseSheet(
      grid([HEADER, [v(''), v('Same'), v('$1')], [v(''), v('same '), v('$2')]]),
      0,
    );
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.costUsd).toBe('1.00');
    expect(parsed.warnings).toHaveLength(1);
  });

  it('refuses a sheet without a name and price header', () => {
    expect(() =>
      parseSheet(
        grid([
          [v('Name'), v('Cost')],
          [v('a'), v('$1')],
        ]),
        0,
      ),
    ).toThrow(SheetShapeError);
  });

  it('refuses a tab that does not exist', () => {
    expect(() => parseSheet(grid([HEADER]), 5)).toThrow(SheetShapeError);
  });

  it('honours block offsets from the API', () => {
    const parsed = parseSheet(
      {
        sheets: [
          {
            properties: { sheetId: 0 },
            data: [
              {
                startRow: 3,
                startColumn: 1,
                rowData: [{ values: HEADER.slice(1) }, { values: [v('Late'), v('$4')] }],
              },
            ],
          },
        ],
      },
      0,
    );
    expect(parsed.lines[0]).toMatchObject({ name: 'Late', costUsd: '4.00', rowNumber: 5 });
  });
});

describe('struckShare', () => {
  it('reads strikethrough on text runs, inheriting the cell format', () => {
    const cell: SheetCell = {
      formattedValue: 'Product X Lifetime',
      effectiveFormat: { textFormat: { strikethrough: false } },
      textFormatRuns: [{ format: { strikethrough: true } }, { startIndex: 10, format: {} }],
    };
    // "ProductX" (8 visible) struck, "Lifetime" (8) not.
    expect(struckShare(cell)).toBeCloseTo(0.5);
  });

  it('is 1 for a struck cell without runs and 0 for an empty one', () => {
    expect(struckShare(v('abc', true))).toBe(1);
    expect(struckShare(v('', true))).toBe(0);
    expect(struckShare(undefined)).toBe(0);
  });

  it('marks a mostly struck name out of stock and a partly struck one for review', () => {
    const header = [v('Product name'), v('Unit price')];
    const parsed = parseSheet(
      grid([
        header,
        [
          {
            formattedValue: 'Mostly struck name',
            textFormatRuns: [
              { format: { strikethrough: true } },
              { startIndex: 16, format: { strikethrough: false } },
            ],
          },
          v('$1'),
        ],
        [
          {
            formattedValue: 'Half struck',
            textFormatRuns: [{ format: { strikethrough: true } }, { startIndex: 4 }],
          },
          v('$1'),
        ],
      ]),
      0,
    );
    expect(parsed.lines.map((line) => [line.outOfStock, line.partialStrike])).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});

describe('parseUsd', () => {
  it.each([
    ['$1.50', '1.50'],
    ['$1,234.00', '1234.00'],
    ['USD 3', '3.00'],
    ['$2.005', '2.01'],
    ['', null],
    ['Ask', null],
    ['$0.00', null],
    ['$.50', '0.50'],
    ['$10-15', null],
  ])('%s → %s', (input, expected) => {
    expect(parseUsd(input)).toBe(expected);
  });
});
