/**
 * Storefront-side SEO wiring. The rules themselves live in @da/seo and
 * @da/contracts so the API and the sitemap generator agree with the pages.
 */
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
