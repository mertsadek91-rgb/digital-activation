import { hasLocale } from 'next-intl';

import { routing, type AppRoutingLocale } from './routing';

/**
 * The one answer to "is this page Arabic?".
 *
 * The code used to ask it two ways — `locale === 'ar'` in some files and
 * `locale !== 'en'` in others — and the two agree only while the locale is one
 * of the two the store serves. They split on anything else: the empty string
 * `getLocale()` returns on an unmatched route, or `wp-login.php` arriving as a
 * "locale". One page would then render Arabic copy inside an English layout.
 *
 * Anything that is not a served locale resolves to the default, which is what
 * `request.ts` does when it picks the messages, so the strings and the
 * direction checks cannot disagree about which language a page is in.
 */
export function resolveLocale(locale: string | undefined): AppRoutingLocale {
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

export function isArabic(locale: string | undefined): boolean {
  return resolveLocale(locale) === 'ar';
}
