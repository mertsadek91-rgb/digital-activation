/**
 * Arabic text normalisation for search and slugging.
 *
 * Without this, a shop selling "أوفيس" returns nothing for "اوفيس" — and both
 * spellings appear in the real Search Console data for this store, alongside
 * "التفعيل" / "تفعيل" and "التنشيط الرقمي" / "تنشيط الرقمي". Arabic writers
 * vary hamza, alef maksura, ta marbuta and diacritics freely, so the index and
 * the query both get folded to one canonical form.
 *
 * Applied to Meilisearch documents at index time and to the query at search
 * time. Never applied to text shown to a human — folding is for matching only.
 */

const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭ]/g;
const TATWEEL = /ـ/g;

/** Arabic-Indic and extended Arabic-Indic digits to Latin. */
const DIGIT_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

export function normalizeArabicDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
}

/**
 * Folds the variations that carry no meaning for matching:
 *   أ إ آ ٱ -> ا      hamza forms on alef
 *   ى        -> ي      alef maksura
 *   ة        -> ه      ta marbuta
 *   ؤ        -> و
 *   ئ        -> ي
 *   diacritics and tatweel removed
 */
export function foldArabic(input: string): string {
  return input
    .normalize('NFKC')
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** The single entry point for both indexing and querying. */
export function normalizeForSearch(input: string): string {
  return (
    normalizeArabicDigits(foldArabic(input))
      .toLowerCase()
      // Bidi controls, written as escapes: as literal characters they are invisible
      // in an editor and easily mangled by any tool that rewrites the file.
      .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Latin slug from an Arabic or mixed title.
 *
 * Slugs are Latin by decision: the legacy store's percent-encoded Arabic paths
 * ran past 300 characters, broke in analytics and ad tooling, and were unusable
 * as citations. The Arabic keywords live in the title, the H1 and the body,
 * where they are actually weighed.
 *
 * Arabic titles have no useful Latin transliteration here, so this extracts the
 * Latin/numeric tokens a product title almost always already contains
 * ("Windows 11 Pro مفتاح تفعيل" -> "windows-11-pro"). When there are none, the
 * caller must supply a slug by hand rather than get a machine-mangled one.
 */
export function toLatinSlug(input: string): string | null {
  const latin = normalizeArabicDigits(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{Script=Latin}\p{Nd}\s-]+/gu, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (latin.length < 2) return null;
  return latin.slice(0, 96).replace(/-+$/, '');
}
