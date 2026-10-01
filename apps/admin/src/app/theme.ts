/**
 * Light or dark, as a cookie.
 *
 * A cookie rather than localStorage for the same reason the locale is one:
 * the root layout reads it on the server and sets `data-theme` on `<html>`
 * before anything paints, so a dark panel never flashes light on the way in
 * — and the admin's CSP runs no inline script that could patch it up after.
 */

export const ADMIN_THEMES = ['light', 'dark'] as const;

export type AdminTheme = (typeof ADMIN_THEMES)[number];

export const ADMIN_THEME_COOKIE = 'da_admin_theme';

/** A year, like the locale: a preference, not a session. */
export const ADMIN_THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function toAdminTheme(value: unknown): AdminTheme {
  return value === 'dark' ? 'dark' : 'light';
}
