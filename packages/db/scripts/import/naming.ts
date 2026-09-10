/**
 * Product naming and grouping for the WordPress import.
 *
 * Two problems solved here, both of which decide URLs — so both are permanent.
 *
 * 1. SLUGS. The legacy paths are percent-encoded Arabic running past 300
 *    characters. A naive transliteration is no better: run the titles through
 *    a generic latin-token slugger and you get `11-365` for
 *    "باقة الحماية ويندوز 11 برو + أوفيس 365 + مكافي".
 *
 *    What works is that these titles are bilingual by convention — the Latin
 *    half IS the product name, written by the store itself. Taking the longest
 *    Latin run yields `windows-10-pro`, `office-2021-pro-plus`,
 *    `eset-internet-security-nod32`. 99 of 101 products name themselves.
 *
 * 2. GROUPING. Stripping the tokens that describe a *variant* — licence term,
 *    device count, activation wording — from that Latin run leaves the product.
 *    Two rows that reduce to the same name are the same product, and the
 *    stripped tokens are what distinguishes their variants.
 *
 *    That takes 101 legacy rows to 72 products. It is not a cosmetic tidy-up:
 *    the legacy store had eight separate ESET Internet Security products and
 *    six Autodesk products competing with each other for one keyword, splitting
 *    whatever authority each had.
 *
 * The grouping is derived from the store's own naming rather than a hand-built
 * list, so it can be re-run and reviewed. Anything it cannot name falls to
 * SLUG_OVERRIDES rather than getting a machine-mangled URL.
 */

/** Products whose titles carry no usable Latin run. */
export const SLUG_OVERRIDES: Record<string, string> = {
  // "الباقة الأساسية ويندوز 11 برو + أوفيس 365"
  '13374': 'starter-bundle-windows-11-pro-office-365',
  // "باقة الحماية ويندوز 11 برو + أوفيس 365 + مكافي انترنت سيكيورتي"
  '13912': 'protection-bundle-windows-11-pro-office-365-mcafee',
};

/** English display names for the overridden products. */
export const NAME_OVERRIDES_EN: Record<string, string> = {
  '13374': 'Starter Bundle — Windows 11 Pro + Office 365',
  '13912': 'Protection Bundle — Windows 11 Pro + Office 365 + McAfee',
};

export function longestLatinRun(title: string): string | null {
  const runs = title.match(/[A-Za-z][A-Za-z0-9 .+/&-]*/g) ?? [];
  const sorted = runs
    .map((run) => run.trim())
    .filter((run) => run.length > 2)
    .sort((a, b) => b.replace(/[^A-Za-z]/g, '').length - a.replace(/[^A-Za-z]/g, '').length);
  return sorted[0] ?? null;
}

/**
 * Tokens that describe the variant, not the product. Removing them is what
 * collapses "Autodesk All Apps 1 Year 1 PC" and "Autodesk All Apps 3 Years
 * 3 Devices" onto one product with two variants.
 */
const VARIANT_TOKENS: RegExp[] = [
  /\b\d+\s*(year|years|yr|yrs)\b/gi,
  /\b\d+\s*(month|months|mo)\b/gi,
  /\b\d+\s*(day|days)\b/gi,
  /\blifetime\b/gi,
  /\b\d+\s*(pc|pcs|device|devices|user|users|mac)\b/gi,
  /\b\d+\s*cal\b/gi,
  /\bcal\b/gi,
  /\b(online|manual|phone)\s*activation\b/gi,
  /\bactivation\b/gi,
  /\bsubscription\b/gi,
  /\baccount\b/gi,
  /\bredeem\s*code\b/gi,
  /\bkey\b/gi,
  /\b(retail|oem)\b/gi,
];

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 72);
}

/** The Latin product name with variant tokens removed, or null. */
export function productName(title: string): string | null {
  const run = longestLatinRun(title);
  if (!run) return null;

  let name = run;
  for (const pattern of VARIANT_TOKENS) name = name.replace(pattern, ' ');
  name = name
    .replace(/[()[\]]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // A bare number left at the end is a duration the Arabic half spelled out
  // ("… - 12 شهر"), not a version. A four-digit 19xx/20xx is a version year and
  // stays: office-2021 and visual-studio-2022 are product names, not terms.
  name = name.replace(/\s+(?!(?:19|20)\d{2}\b)\d{1,3}\s*$/g, '').trim();

  return name.length > 2 ? name : run;
}

/** Group slug for a legacy product, or null when it needs an override. */
export function groupSlug(legacyId: string, title: string): string | null {
  const override = SLUG_OVERRIDES[legacyId];
  if (override) return override;

  const name = productName(title);
  return name ? slugify(name) : null;
}

/**
 * SKU suffix describing the variant, appended when a group has more than one.
 * Reads as `-3y-5pc`, so a support conversation about a SKU is legible.
 */
export function variantSuffix(input: {
  periodValue: number | null;
  periodUnit: string;
  deviceCount: number;
  activationHint?: string | undefined;
}): string {
  const parts: string[] = [];

  if (input.periodUnit === 'LIFETIME') parts.push('life');
  else if (input.periodValue) {
    const unit = input.periodUnit === 'YEAR' ? 'y' : input.periodUnit === 'MONTH' ? 'm' : 'd';
    parts.push(`${input.periodValue}${unit}`);
  }

  parts.push(input.deviceCount === 0 ? 'unlimited' : `${input.deviceCount}pc`);
  if (input.activationHint) parts.push(input.activationHint);

  return parts.join('-');
}

/**
 * The Arabic product name for a grouped product.
 *
 * After grouping, taking the first member's title verbatim leaves variant text
 * in the product name: the eight-variant ESET product came out as
 * "… انترنت سيكورتي سنة واحدة لـ جهاز واحد" — one variant's term and device
 * count standing in for all eight.
 *
 * The phrases to remove are not guesswork: they are the keys of the very
 * normalisation tables the import already matched against, so the two cannot
 * drift. Connectors left stranded by the removal ("لـ", "لمدة") go too.
 */
export function arabicProductName(
  title: string,
  periodPhrases: readonly string[],
  devicePhrases: readonly string[],
): string {
  let name = title;

  // Longest first, so "3 سنوات (36 شهر)" is removed before "3 سنوات".
  const phrases = [...periodPhrases, ...devicePhrases].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    if (phrase.length < 3) continue;
    name = name.split(phrase).join(' ');
  }

  // These titles are bilingual, so the same variant information appears twice:
  // "اوتوديسك الحزمة الكاملة سنة واحدة - Autodesk All Apps 1 Year 1 Device".
  // Removing only the Arabic half leaves the Latin half behind.
  for (const pattern of VARIANT_TOKENS) name = name.replace(pattern, ' ');

  return (
    name
      .replace(/\s+(لـ|لمدة|عبر|من)\s*(?=\s|$|[-–—])/g, ' ')
      // Brackets emptied by the removal — "Office 2021 Pro Plus ( )" is what is
      // left of "Retail (Online Activation)".
      .replace(/[([]\s*[)\]]/g, ' ')
      .replace(/\s*[-–—]\s*(?=[-–—]|$)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
      .trim()
  );
}
