import { z } from 'zod';

/**
 * Shape of the `seo` Json column on Page and Article, and of the SEO fields on
 * the translation tables.
 *
 * `robots` is spelled out rather than free text, because the legacy store shipped
 * `follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large`
 * as an opaque string on every page including the ones that should not have been
 * indexed at all.
 */
export const robotsSchema = z
  .object({
    index: z.boolean().default(true),
    follow: z.boolean().default(true),
    maxImagePreview: z.enum(['none', 'standard', 'large']).default('large'),
    maxSnippet: z.number().int().min(-1).default(-1),
  })
  .strict();

export const seoMetaSchema = z
  .object({
    /** 50–60 characters renders without truncation in most SERPs. */
    title: z.string().min(1).max(70).optional(),
    description: z.string().min(1).max(180).optional(),
    ogImageAssetId: z.string().optional(),
    /** Only for genuine duplicates. Self-referencing canonicals are the default. */
    canonicalOverride: z.string().url().optional(),
    robots: robotsSchema.optional(),
  })
  .strict();

export type SeoMeta = z.infer<typeof seoMetaSchema>;

/**
 * Publish gate. A product or page cannot reach PUBLISHED until every one of
 * these passes, in both locales. 43 of the 101 legacy products were published
 * with no SEO title and no meta description; this is the check that makes that
 * impossible rather than merely discouraged.
 */
export const SEO_PUBLISH_REQUIREMENTS = {
  titleMinLength: 20,
  descriptionMinLength: 70,
  bodyMinWords: 120,
  requiresHeroImage: true,
  requiresHeroAltPerLocale: true,
  requiresPrimaryCategory: true,
  requiresSku: true,
} as const;

/** URL prefixes. Kept in one place so the sitemap, the router and the 301 map
 *  cannot drift apart. Arabic is at the root; English is prefixed. */
export const ROUTES = {
  home: '/',
  store: '/store',
  product: (slug: string) => `/store/${slug}`,
  collection: (slug: string) => `/collections/${slug}`,
  brand: (slug: string) => `/brands/${slug}`,
  blog: '/blog',
  post: (slug: string) => `/blog/${slug}`,
  guide: (slug: string) => `/guides/${slug}`,
  comparison: (slug: string) => `/compare/${slug}`,
  glossary: (slug: string) => `/glossary/${slug}`,
  tool: (slug: string) => `/tools/${slug}`,
  deals: '/deals',
  goldenWarranty: '/golden-warranty',
  business: '/business',
  about: '/about',
  contact: '/contact',
  account: '/account',
  licenses: '/account/licenses',
  cart: '/cart',
  checkout: '/checkout',
} as const;

/** Paths that must never be indexed, mirrored into robots.txt. */
export const NOINDEX_PREFIXES = [
  '/cart',
  '/checkout',
  '/account',
  '/search',
  '/product-tag',
] as const;
