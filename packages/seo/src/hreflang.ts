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
  return [
    { hrefLang: 'ar', href: absoluteUrl(baseUrl, path, 'ar') },
    { hrefLang: 'en', href: absoluteUrl(baseUrl, path, 'en') },
    { hrefLang: 'x-default', href: absoluteUrl(baseUrl, path, DEFAULT_LOCALE) },
  ];
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
