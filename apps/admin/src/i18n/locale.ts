/**
 * The panel's own language, which is not the catalog's.
 *
 * Two different locales run through this app and conflating them breaks both.
 * This one is the language the *staff member* reads: labels, buttons, errors,
 * the nav. The other is the locale of the *content* being edited — a product
 * has an Arabic translation and an English one, and the editor switches
 * between them regardless of which language its own buttons are in. An English
 * speaker editing the Arabic copy is a normal case, so `ProductCopy`'s locale
 * stays a separate piece of state everywhere it appears.
 *
 * Arabic remains the default: the team that uses this panel daily reads
 * Arabic, and a staff member who has never touched the switcher must not have
 * the panel change under them.
 */

export const ADMIN_LOCALES = ['ar', 'en'] as const;

export type AdminLocale = (typeof ADMIN_LOCALES)[number];

export const DEFAULT_ADMIN_LOCALE: AdminLocale = 'ar';

/**
 * Not prefixed with `__Host-` and not httpOnly, unlike the session.
 *
 * The client half of the switcher writes it through `document.cookie`, so it
 * has to be readable there. Nothing sensitive lives in it — it says `ar` or
 * `en` — and the session cookies it sits beside keep their own stricter flags.
 */
export const ADMIN_LOCALE_COOKIE = 'da_admin_locale';

/** A year: a language preference is not a session, and outlives one. */
export const ADMIN_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const ADMIN_LOCALE_DIR: Record<AdminLocale, 'rtl' | 'ltr'> = {
  ar: 'rtl',
  en: 'ltr',
};

/** What the switcher calls each language — in that language, not the current one. */
export const ADMIN_LOCALE_LABEL: Record<AdminLocale, string> = {
  ar: 'العربية',
  en: 'English',
};

export function isAdminLocale(value: unknown): value is AdminLocale {
  return typeof value === 'string' && ADMIN_LOCALES.includes(value as AdminLocale);
}

/** Anything unrecognised falls back rather than throwing: a bad cookie is not an outage. */
export function toAdminLocale(value: unknown): AdminLocale {
  return isAdminLocale(value) ? value : DEFAULT_ADMIN_LOCALE;
}
