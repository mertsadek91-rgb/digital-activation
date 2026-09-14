/**
 * Alternates and canonicals.
 *
 * Arabic sits at the root and English is prefixed, so `/` keeps the history it
 * already has — it is the single strongest organic asset in the store, holding
 * 69.6% of all impressions. The legacy site emitted no hreflang at all while
 * English demand went unanswered.
 */
import { DEFAULT_LOCALE, type AppLocale } from '@da/contracts';

export interface AlternateLink {
  hrefLang: string;
  href: string;
}

/** `/store/win-11` for ar, `/en/store/win-11` for en. */
export function localizedPath(path: string, locale: AppLocale): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return normalized;
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`;
}

export function absoluteUrl(baseUrl: string, path: string, locale: AppLocale): string {
  return new URL(localizedPath(path, locale), baseUrl).toString();
}

/**
 * Reciprocal alternates plus x-default. x-default points at Arabic: an unmatched
 * visitor is more likely to be a Gulf buyer than not.
 */
export function alternates(baseUrl: string, path: string): AlternateLink[] {
  return alternatesIn(baseUrl, path, ['ar', 'en']);
}

/**
 * Alternates for a page that does not exist in every language.
 *
 * Most of this site does: a product, a collection and an editorial page each
 * fall back across locales, so `/en/store/x` always renders something and the
 * blanket pair above is honest. The blog does not — the seven posts carried
 * over from the old store are Arabic, and serving Arabic prose under an English
 * URL would declare a translation nobody wrote.
 *
 * So the languages are passed in. Declaring `hreflang="en"` for a URL that
 * answers 404 is not a harmless extra line; it is a reciprocity error Search
 * Console reports, and it was about to be emitted seven times.
 *
 * `x-default` still points at Arabic when Arabic is among them, and at the
 * first available language otherwise — an unmatched visitor should be sent
 * somewhere that exists.
 */
export function alternatesIn(
  baseUrl: string,
  path: string,
  locales: readonly AppLocale[],
): AlternateLink[] {
  const links: AlternateLink[] = locales.map((locale) => ({
    hrefLang: locale,
    href: absoluteUrl(baseUrl, path, locale),
  }));
  const fallback = locales.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : locales[0];
  if (fallback) {
    links.push({ hrefLang: 'x-default', href: absoluteUrl(baseUrl, path, fallback) });
  }
  return links;
}

/** Self-referencing by default; an override is only for genuine duplicates. */
export function canonical(
  baseUrl: string,
  path: string,
  locale: AppLocale,
  override?: string,
): string {
  return override ?? absoluteUrl(baseUrl, path, locale);
}
