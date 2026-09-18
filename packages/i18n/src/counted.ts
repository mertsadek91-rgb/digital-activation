/**
 * Counting things in Arabic.
 *
 * Arabic does not have a singular and a plural. It has six agreements for a
 * counted noun, and the catalog was using one of them for all of them — every
 * product grid on this store said "3 منتجاً", which is the form that belongs
 * to eleven and above. The right answer for three is "3 منتجات".
 *
 *   0        لا منتجات
 *   1        منتج واحد
 *   2        منتجان
 *   3–10     3 منتجات          (جمع القلة، مجرور)
 *   11–99    11 منتجاً          (مفرد، منصوب)
 *   100+     100 منتج           (مفرد، مجرور)
 *
 * `Intl.PluralRules` already knows this. Its CLDR categories for Arabic — zero,
 * one, two, few, many, other — are that table exactly, including the part that
 * trips people writing the rule by hand: the bands are on the last two digits,
 * so 103 is "few" (مئة وثلاثة منتجات) and 111 is "many" (مئة وأحد عشر منتجاً),
 * while 100 itself is "other". Writing the arithmetic out here would be a
 * second implementation of a table the platform ships and the tests below
 * would be checking my copy of it rather than the language.
 *
 * English goes through the same call so a caller never has to remember which
 * language needs which branch — `Intl.PluralRules` gives it one and other, and
 * a form that is not supplied falls back to `other`, which is what every
 * English caller wants and what an Arabic caller gets only by leaving one out.
 */

/**
 * The forms of one counted noun. `{n}` is replaced with the number.
 *
 * `zero`, `one` and `two` carry no `{n}` in normal Arabic — "منتجان" already
 * says two — so they are written as whole phrases rather than as a number and
 * a word.
 */
export interface CountForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  /** Required: every language reaches this category, and it is the fallback. */
  other: string;
}

const RULES = new Map<string, Intl.PluralRules>();

function rulesFor(locale: string): Intl.PluralRules {
  const cached = RULES.get(locale);
  if (cached) return cached;
  const made = new Intl.PluralRules(locale);
  RULES.set(locale, made);
  return made;
}

/**
 * One counted noun, agreeing with its number.
 *
 * The number is formatted for the locale rather than interpolated raw, so an
 * Arabic page can decide once whether it wants Arabic-Indic digits instead of
 * threading that decision through every caller. This store shows Latin digits
 * in Arabic — which is what its own legacy pages did and what the price
 * formatter already does — so `ar` is asked for that explicitly.
 */
export function counted(count: number, locale: string, forms: CountForms): string {
  const category = rulesFor(locale).select(count);
  const chosen =
    (category === 'zero' ? forms.zero : undefined) ??
    (category === 'one' ? forms.one : undefined) ??
    (category === 'two' ? forms.two : undefined) ??
    (category === 'few' ? forms.few : undefined) ??
    (category === 'many' ? forms.many : undefined) ??
    forms.other;

  return chosen.replace('{n}', formatNumber(count, locale));
}

function formatNumber(count: number, locale: string): string {
  // `ar` alone resolves to Arabic-Indic digits in most ICU builds. This store
  // writes its prices and its counts in Latin digits, so the numbering system
  // is pinned rather than left to whichever ICU the host happens to ship.
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : locale).format(count);
}

/**
 * The one noun this catalog counts everywhere: products in a grid.
 *
 * Here rather than in each page because there are three grids — the store, a
 * collection and a brand — and three copies of a six-way agreement is three
 * chances to get one of them wrong, which is how the original single form
 * ended up in all three.
 */
export function productCount(count: number, locale: string): string {
  if (locale === 'ar') {
    return counted(count, 'ar', {
      zero: 'لا منتجات',
      one: 'منتج واحد',
      two: 'منتجان',
      few: '{n} منتجات',
      many: '{n} منتجاً',
      other: '{n} منتج',
    });
  }

  return counted(count, 'en', { one: '{n} product', other: '{n} products' });
}
