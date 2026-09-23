import { describe, expect, it } from 'vitest';

import { csvCell, csvRow, exportBound } from './csv.js';

describe('csvCell', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('keeps Arabic as it is', () => {
    expect(csvCell('محمد')).toBe('محمد');
  });

  it('defuses a cell Excel would run as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM')).toBe("'@SUM");
  });

  it('leaves numbers and empties alone', () => {
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('ends a row with CRLF', () => {
    expect(csvRow(['a', 1, null])).toBe('a,1,\r\n');
  });
});

describe('exportBound', () => {
  it('reads a bare date as a whole UTC day, inclusive at the end', () => {
    expect(exportBound('2026-09-01', 'from')?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(exportBound('2026-09-30', 'to')?.toISOString()).toBe('2026-09-30T23:59:59.999Z');
  });

  it('is null when empty and undefined when unreadable', () => {
    expect(exportBound('', 'from')).toBeNull();
    expect(exportBound(undefined, 'to')).toBeNull();
    expect(exportBound('not a date', 'from')).toBeUndefined();
  });
});
