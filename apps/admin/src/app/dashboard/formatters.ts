'use client';

import { useMemo } from 'react';

import { useAdminLocale } from '../../i18n/provider';

/**
 * Dates, money and counts, in the reader's language and the panel's digits.
 *
 * Built once per locale and passed down rather than re-created per component:
 * an `Intl.NumberFormat` is not free, and this page builds one per row of two
 * tables and one per gridline of a chart if each of them makes its own.
 */
export interface Formatters {
  /**
   * A `YYYY-MM-DD` calendar label as `19/08`, the same in both languages.
   *
   * The chart axis, and the one string on this page that does not follow the
   * reader's locale. It sits inside an SVG that is deliberately left to right,
   * where an Arabic label is reordered against it — "19 أغسطس" came out with
   * the month leading, and switching to Arabic *numerals* was worse, not
   * better: `ar` writes a numeric date with U+200F marks between the parts,
   * so "19/8" rendered as "198/" inside the left-to-right box.
   *
   * Day-then-month is the order both languages read anyway, and two numerals
   * and a slash have no direction to get wrong. The month by name is still
   * there in the tooltip and the table, which follow the page.
   */
  dayNumeric: (date: string) => string;
  /** The same label with its year, for anywhere it stands alone. */
  dayLong: (date: string) => string;
  time: (iso: string) => string;
  dateTime: (iso: string) => string;
  money: (amount: string | number) => string;
  /** Compact, for an axis tick: `$1.2K`. */
  moneyShort: (amount: number) => string;
  whole: (value: number) => string;
}

export function useFormatters(): Formatters {
  const locale = useAdminLocale();

  return useMemo(() => {
    // Gregorian, and Latin digits, because every other number on this panel is
    // written that way — an order count in Western digits beside a date in
    // Arabic-Indic ones reads as two different systems on one row.
    const tag = locale === 'ar' ? 'ar-u-nu-latn-ca-gregory' : 'en-GB';

    // `en-GB`, not `tag`: see the note on `dayNumeric` in the interface.
    const dayNumeric = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit' });
    const dayLong = new Intl.DateTimeFormat(tag, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const time = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' });

    // Money stays in one form in both languages. It is a USD figure with a
    // Latin symbol, the books are kept in USD, and a staff member reading the
    // panel in Arabic is reading the same ledger as one reading it in English.
    const money = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    });
    /**
     * Compact money, done by hand rather than by `notation: 'compact'`.
     *
     * The built-in one does not agree with itself across runtimes: asked for
     * `$150` with `maximumFractionDigits: 1`, Node's ICU answers "$150.0" and
     * Chrome's answers "$150". These labels are rendered on the server and
     * then hydrated in the browser, so that disagreement is not a cosmetic
     * difference — it is a hydration failure that throws away the server's
     * markup and re-renders the page, and it only appears once the chart has
     * an axis tick under a thousand, which is most days.
     *
     * Three branches and a plain formatter are deterministic everywhere.
     */
    const compact = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
    const moneyShort = (amount: number): string => {
      const size = Math.abs(amount);
      const sign = amount < 0 ? '-' : '';
      if (size >= 1_000_000) return `${sign}$${compact.format(size / 1_000_000)}M`;
      if (size >= 1_000) return `${sign}$${compact.format(size / 1_000)}K`;
      return `${sign}$${compact.format(size)}`;
    };

    const whole = new Intl.NumberFormat('en-US');

    // Midday UTC, so a calendar label is never dragged onto the day before by
    // the reader's own offset when it is turned back into a Date to format.
    const asDate = (date: string) => new Date(`${date}T12:00:00Z`);

    return {
      dayNumeric: (date) => dayNumeric.format(asDate(date)),
      dayLong: (date) => dayLong.format(asDate(date)),
      time: (iso) => time.format(new Date(iso)),
      dateTime: (iso) => `${dayLong.format(new Date(iso))} · ${time.format(new Date(iso))}`,
      money: (amount) => money.format(Number(amount)),
      moneyShort,
      whole: (value) => whole.format(value),
    } satisfies Formatters;
  }, [locale]);
}
