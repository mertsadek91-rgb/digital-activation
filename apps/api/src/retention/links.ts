import { newsletterToken } from '../subscriptions/subscriptions.service.js';

/** Where the storefront is, and the locale prefix its routes take (Arabic has none). */
export function storefrontUrl(path: string, locale: 'ar' | 'en'): URL {
  const base = process.env.STOREFRONT_URL ?? 'http://localhost:3000';
  return new URL(`${locale === 'en' ? '/en' : ''}${path}`, base);
}

/**
 * The unsubscribe link for the email body, and the headers for the inbox.
 *
 * The body links to the existing newsletter page, which withdraws consent
 * when the reader presses its button. The header adds the API's one-click
 * endpoint (RFC 8058): Gmail and Yahoo show their own "unsubscribe" beside the
 * sender and POST to it without opening anything, and they now expect it on
 * every bulk marketing message. It needs the API's public address, which is
 * only known when `API_PUBLIC_URL` (or the storefront's `NEXT_PUBLIC_API_URL`)
 * is set; without it the header carries the page alone.
 */
export function unsubscribeLinks(
  email: string,
  locale: 'ar' | 'en',
): { pageUrl: string; headers: Record<string, string> } {
  const token = newsletterToken(email, 'newsletter-unsubscribe');
  const page = storefrontUrl('/newsletter/unsubscribe', locale);
  page.searchParams.set('token', token);

  const apiBase = process.env.API_PUBLIC_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!apiBase) {
    return { pageUrl: page.toString(), headers: { 'List-Unsubscribe': `<${page.toString()}>` } };
  }
  const oneClick = new URL('/v1/marketing/unsubscribe', apiBase);
  oneClick.searchParams.set('token', token);
  return {
    pageUrl: page.toString(),
    headers: {
      'List-Unsubscribe': `<${oneClick.toString()}>, <${page.toString()}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

/** A date as the reader would write it, in the store's timezone. */
export function formatDate(date: Date, locale: 'ar' | 'en', timeZone: string): string {
  // Gregorian and Latin digits in Arabic too: the rest of the store prints
  // dates that way, and an Umm al-Qura date beside a Gregorian order date
  // reads as two different days.
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    dateStyle: 'long',
    timeZone,
  }).format(date);
}

export function formatDateTime(date: Date, locale: 'ar' | 'en', timeZone: string): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(date);
}
