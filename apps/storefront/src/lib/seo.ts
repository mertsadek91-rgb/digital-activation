/**
 * Storefront-side SEO wiring. The rules themselves live in @da/seo and
 * @da/contracts so the API and the sitemap generator agree with the pages.
 */
import type { Metadata } from 'next';

import { NOINDEX_PREFIXES } from '@da/contracts';
import { indexingPolicy, robotsMeta } from '@da/seo';

export { indexingPolicy, robotsMeta };

export const NOINDEX_PREFIXES_ROBOTS = NOINDEX_PREFIXES;

/** Crawl rules for the indexable case. AI crawlers are welcome by design. */
export function robotsTxtRules() {
  const disallow = [
    ...NOINDEX_PREFIXES,
    '/*?add-to-cart=',
    '/*?orderby=',
    '/*?filter_',
    '/*?min_price=',
    '/*?max_price=',
  ];

  return [
    { userAgent: '*', allow: '/', disallow },
    // Citation by answer engines is the point of the content plan, not a leak.
    { userAgent: 'GPTBot', allow: '/' },
    { userAgent: 'ClaudeBot', allow: '/' },
    { userAgent: 'PerplexityBot', allow: '/' },
    { userAgent: 'Google-Extended', allow: '/' },
  ];
}

/**
 * The head of a page that is not there.
 *
 * Three routes answer 404 — the catch-all, a product and a collection — and
 * all three used to title it `Not found`, in English, on a store whose default
 * language is Arabic. That string is what a browser tab shows, what a share
 * card shows, and what somebody sees in their history a week later trying to
 * find the link that broke.
 *
 * `index: false` alongside it is belt and braces: Next already sends
 * `noindex` on a 404 status, and a crawler that somehow reads this page
 * without the status must not file it either.
 */
export function notFoundMetadata(locale: string): Metadata {
  const ar = locale !== 'en';
  return {
    title: ar ? 'الصفحة غير موجودة' : 'Page not found',
    description: ar
      ? 'الرابط الذي فتحته لم يعد يشير إلى صفحة في المتجر.'
      : 'The link you opened no longer points to a page in this store.',
    robots: { index: false, follow: false },
  };
}
