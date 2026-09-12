/**
 * Matching Arabic text the way people actually write it.
 *
 * Two things use this and they must not drift: the 404 suggester, which
 * matches a dead URL against the catalog, and the store's search box. Both ask
 * the same question — which products share words with this string — and a
 * second tokenizer would eventually answer it differently, so a visitor would
 * be offered a product on the 404 page that the search box then could not
 * find.
 */

/** Words this short are prepositions and file extensions, not subjects. */
const MIN_WORD = 3;

/**
 * Words that are part of the address rather than part of the question.
 *
 * A path carries its own routing vocabulary — `/en/store/…`, `/product/…`,
 * `/collections/…` — and the visitor did not type any of it looking for a
 * product called "store". Counted, they dilute the score to the point of
 * silence: `/en/store/acrobat-professional` scores one word in three and falls
 * under the threshold, so the store answers "no idea" to somebody who typed
 * the name of a product it sells. Both spellings are here because the legacy
 * store used `/product/` and this one uses `/store/`.
 */
const ROUTE_WORDS = new Set([
  'store',
  'shop',
  'product',
  'products',
  'collection',
  'collections',
  'category',
  'categories',
  'page',
  'index',
  'html',
  'htm',
  'php',
  'aspx',
  'منتج',
  'المنتج',
  'قسم',
  'التصنيف',
  'صفحه',
]);

/**
 * Splits a path or a name into words, and levels the spellings apart.
 *
 * Arabic-aware, and it has to be twice over.
 *
 * First, `\w` in a JavaScript regex is ASCII-only, so splitting on it would
 * reduce every Arabic legacy URL — which is all of them — to nothing.
 *
 * Second, and this is what decides whether any of this works on the real
 * traffic: the same Arabic word is routinely written more than one way, and
 * URLs are where that shows most. أ إ آ and ا are the same letter carrying
 * different hamza marks that people and slug generators drop at will; ة and ه
 * are interchanged at the end of a word; ى and ي likewise. The store's own
 * data has both — a product named "أشتراك" against a legacy URL spelling it
 * "اشتراك". Matching those as different words means matching nothing, so
 * every form is folded to one before comparison. The diacritics and the
 * tatweel are stripped for the same reason: they decorate a word without
 * changing which word it is.
 */
export function words(value: string): Set<string> {
  let text = value;
  try {
    text = decodeURIComponent(value);
  } catch {
    // A malformed percent-escape is a crawler probing. Match on the raw text.
  }

  const folded = text
    .toLowerCase()
    // The tatweel, and every non-spacing mark — which for Arabic is the
    // harakat. Written as a Unicode property rather than as a literal range
    // because a character class holding combining marks is ambiguous about
    // what it matches, and the linter is right to say so.
    .replace(/ـ/g, '')
    .replace(/\p{Mn}/gu, '')
    // Every alif, one alif.
    .replace(/[آأإٱ]/g, 'ا')
    // Taa marbuta reads as haa at the end of a word.
    .replace(/ة/g, 'ه')
    // Alif maqsura reads as yaa.
    .replace(/[ىي]/g, 'ي')
    // Hamza on a seat, without the seat.
    .replace(/[ؤئ]/g, 'ء');

  return new Set(
    folded.split(/[^\p{Letter}\p{Number}]+/u).filter((word) => word.length >= MIN_WORD),
  );
}

/**
 * The words in a path that are actually about something.
 *
 * What the matcher scores against, and the reason it is a separate function is
 * that the score is a *share* of these: leaving the routing vocabulary in
 * makes every path look less like every product, in proportion to how deep it
 * is nested.
 */
export function subjectWords(path: string): Set<string> {
  return new Set([...words(path)].filter((word) => !ROUTE_WORDS.has(word)));
}
