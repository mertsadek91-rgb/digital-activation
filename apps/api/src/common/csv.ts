/**
 * CSV for the panel's exports, written for Excel first.
 *
 * Excel is what the people downloading these open them in, and it has two
 * habits that matter here. It reads a file without a byte-order mark as the
 * machine's legacy code page, which turns every Arabic name into mojibake —
 * so every export starts with `CSV_BOM`. And it runs a cell that starts with
 * `=`, `+`, `-` or `@` as a formula, which makes a customer's name field a
 * way to put a formula on a member of staff's machine — so such cells are
 * prefixed with an apostrophe, which Excel shows as text and hides.
 */
export const CSV_BOM = '﻿';

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | boolean | Date | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Numbers are ours and never user input; a negative amount stays a number.
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One line, CRLF-terminated as RFC 4180 and Excel both expect. */
export function csvRow(values: readonly Parameters<typeof csvCell>[0][]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}

/**
 * Parses an export's `from` / `to` query value.
 *
 * A bare date is a whole day in UTC, and `to` is inclusive of it: "to the
 * 30th" means through the end of the 30th, which is what a person asking for
 * a month's orders means. Returns null for an empty value, and undefined for
 * one that does not parse, so the caller can refuse it.
 */
export function exportBound(
  value: string | undefined,
  edge: 'from' | 'to',
): Date | null | undefined {
  if (!value?.trim()) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const day = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) return undefined;
    return edge === 'from' ? day : new Date(day.getTime() + 86_400_000 - 1);
  }
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? undefined : at;
}
