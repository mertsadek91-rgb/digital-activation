/**
 * The shopper's display currency.
 *
 * A cookie rather than a URL segment: a currency is a preference, not a
 * different page, and putting it in the path would split every product into
 * one URL per currency for a crawler to deduplicate. Crawlers send no cookie,
 * so they always see dollars, and the structured data they read always agrees
 * with the page they were served.
 *
 * The API decides what the code means. A currency with no rate loaded comes
 * back labelled USD, so a stale cookie can never show dirham figures that are
 * really dollars.
 */
export const CURRENCY_COOKIE = 'da_currency';
export const DEFAULT_CURRENCY = 'USD';

export function validCurrency(value: string | null | undefined): string {
  return value && /^[A-Z]{3}$/.test(value) ? value : DEFAULT_CURRENCY;
}

/** Read in the browser. Server components use `serverCurrency` in lib/api.ts. */
export function browserCurrency(): string {
  if (typeof document === 'undefined') return DEFAULT_CURRENCY;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CURRENCY_COOKIE}=([^;]*)`));
  return validCurrency(match ? decodeURIComponent(match[1] ?? '') : null);
}

export function setBrowserCurrency(code: string): void {
  // A year, site-wide, Lax: a preference the shopper set, read on every page.
  document.cookie = `${CURRENCY_COOKIE}=${encodeURIComponent(validCurrency(code))}; path=/; max-age=31536000; samesite=lax`;
}
