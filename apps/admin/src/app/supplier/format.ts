import type { AdminLocale } from '../../i18n/locale';

/** Date and time in the panel's language, Gregorian calendar, Latin digits. */
export function formatWhen(iso: string, locale: AdminLocale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function formatDay(iso: string, locale: AdminLocale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB', {
    dateStyle: 'medium',
  }).format(new Date(iso));
}

export function usd(amount: string | null): string {
  return amount === null ? '—' : `$${amount}`;
}

/** A change fraction as a signed percentage: 0.125 → "+12.5%". */
export function percent(change: number | null): string {
  if (change === null) return '—';
  const value = Math.round(change * 1000) / 10;
  return `${value > 0 ? '+' : ''}${String(value)}%`;
}

/** A logged value for display: booleans, nulls and objects made readable. */
export function shown(value: unknown, yes: string, no: string): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? yes : no;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}
