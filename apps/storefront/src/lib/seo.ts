/**
 * Storefront-side SEO wiring. The rules themselves live in @da/seo and
 * @da/contracts so the API and the sitemap generator agree with the pages.
 */
import type { Metadata } from 'next';

import { NOINDEX_PREFIXES } from '@da/contracts';
import { indexingPolicy, robotsMeta } from '@da/seo';
import { BRAND } from '@da/ui';

export { indexingPolicy, robotsMeta };

export const NOINDEX_PREFIXES_ROBOTS = NOINDEX_PREFIXES;

/**
 * Crawl rules for the indexable case. AI crawlers are welcome by design.
 *
 * Each private prefix is disallowed twice, bare and under `/en`: robots.txt
 * matches from the start of the path, so `/account` never covered
 * `/en/account`, and the English half of every private route was crawlable.
 *
 * `/cart` and `/checkout` are deliberately not disallowed. Both carry a
 * `noindex` meta tag, and a crawler that is refused the URL never reads that
 * tag — which is how a disallowed page stays in the index as a bare link it
 * was told about elsewhere. Letting it fetch the page is what lets it drop it.
 */
const CRAWL_BLOCKED = NOINDEX_PREFIXES.filter(
  (prefix) => prefix !== '/cart' && prefix !== '/checkout',
);

export function robotsTxtRules() {
  const disallow = [
    ...CRAWL_BLOCKED.flatMap((prefix) => [prefix, `/en${prefix}`]),
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

/**
 * A page title, with the brand added by the layout's template unless the
 * title already carries it.
 *
 * Several stored SEO titles were written with the brand on the end — the
 * warranty page's reads "… | متجر التفعيل الرقمي" — and the template would
 * print it twice. Those pass through untouched.
 */
export function pageTitle(title: string): string | { absolute: string } {
  return title.includes(BRAND.nameAr) || title.includes(BRAND.nameEn) ? { absolute: title } : title;
}

/**
 * The URL of page N of a paginated listing.
 *
 * Page 2 onwards canonicalises to itself, not to page 1. Pointing every page
 * at the first tells a crawler pages 2–N are duplicates of it, and the
 * products that only appear on them lose the one crawl path they had.
 */
export function paginatedUrl(url: string, page: number): string {
  if (page <= 1) return url;
  const next = new URL(url);
  next.searchParams.set('page', String(page));
  return next.toString();
}

/**
 * The share-card fields every page should carry.
 *
 * Next replaces a parent's `openGraph` wholesale when a page sets its own
 * rather than merging the two, so a product page that set only its title and
 * image lost the site name and locale with it. Pages spread this first.
 */
export function openGraphDefaults(locale: string) {
  const ar = locale === 'ar';
  const brand = ar ? BRAND.nameAr : BRAND.nameEn;
  return {
    siteName: brand,
    type: 'website' as const,
    locale: ar ? 'ar_SA' : 'en_US',
    alternateLocale: ar ? ['en_US'] : ['ar_SA'],
    images: [{ url: '/brand/logo.webp', alt: brand }],
  };
}

/** "– صفحة 2" / "– Page 2", or nothing on page 1. */
export function pageSuffix(page: number, locale: string): string {
  if (page <= 1) return '';
  return locale === 'ar' ? ` – صفحة ${String(page)}` : ` – Page ${String(page)}`;
}
