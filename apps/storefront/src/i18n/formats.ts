import type { Formats } from 'next-intl';

/**
 * Named formats the messages can ask for.
 *
 * Prices and counts render with Latin digits in both locales: that is how Gulf
 * e-commerce writes them, and mixing digit systems on one page reads as a
 * rendering fault.
 *
 * `latn` exists because an ICU `#` formats with the locale's default numbering
 * system, and for `ar` that default depends on which ICU the host ships — the
 * server can print "3" and the browser "٣" for the same message, which is both
 * the mixed-digit page above and a hydration mismatch. Counted messages write
 * `{count, number, latn}` where they would otherwise write `#`.
 */
export const formats = {
  number: {
    price: { style: 'currency', currency: 'USD', numberingSystem: 'latn' },
    latn: { numberingSystem: 'latn' },
  },
} satisfies Formats;
