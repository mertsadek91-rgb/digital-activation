import { z } from 'zod';

export const LOCALES = ['ar', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const localeSchema = z.enum(LOCALES);

/** Arabic is the default and lives at the site root, so `/` keeps its history. */
export const DEFAULT_LOCALE: AppLocale = 'ar';

/**
 * Display currencies. Everything is stored in USD; these only affect rendering
 * — and whatever is rendered is also what the page's structured data declares.
 */
export const CURRENCIES = ['USD', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'TRY'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];
export const currencySchema = z.enum(CURRENCIES);

export const BASE_CURRENCY: CurrencyCode = 'USD';

/** Money crosses the wire as a decimal string, never as a float. */
/**
 * An amount as a string, to three decimal places.
 *
 * Three, not two, because the store sells in Kuwaiti dinars: KWD is seeded with
 * `decimals: 3` and so are the Bahraini and Omani currencies it will add next.
 * The schema allowed two, which meant a real KWD total — 12.345 — failed its
 * own contract on the way to the browser. It was latent only because every
 * storefront request so far asks for USD.
 */
export const moneySchema = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,3})?$/, 'expected a decimal amount with up to 3 places');

export const slugSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase latin letters, digits and single hyphens only');

export const emailSchema = z.string().trim().toLowerCase().email().max(320);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(24),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Localised string, keyed by locale. */
export const i18nStringSchema = z.object({
  ar: z.string(),
  en: z.string(),
});
export type I18nString = z.infer<typeof i18nStringSchema>;
