import { defineRouting } from 'next-intl/routing';

/**
 * Arabic is the default and takes no prefix, so the existing `/` keeps every
 * bit of history it has — it is the strongest organic asset in the store,
 * carrying 69.6% of all impressions. English lives under `/en`.
 *
 * `localePrefix: 'as-needed'` is what produces that asymmetry.
 */
export const routing = defineRouting({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'as-needed',
  // Off: a Gulf visitor arriving on an Arabic page should stay on it, and a
  // header-based redirect would also fragment how crawlers see the site.
  localeDetection: false,
});

export type AppRoutingLocale = (typeof routing.locales)[number];
