/**
 * Plain values the storefront's client components need, kept apart from the
 * schemas.
 *
 * A bundler keeps a used module whole. `ROUTES` lived in `seo.ts`, beside
 * the sitemap schemas, so every client component that built a link (the
 * header, the footer, the bottom bar: every page) shipped zod and those
 * schemas with it — a 49 KB chunk Lighthouse counted against the first
 * paint on a phone (TASK-0101). Nothing here imports zod. Each value is
 * re-exported from the module it used to live in, so no import elsewhere
 * changes.
 */

/** URL prefixes. Kept in one place so the sitemap, the router and the 301 map
 *  cannot drift apart. Arabic is at the root; English is prefixed. */
export const ROUTES = {
  home: '/',
  store: '/store',
  /** Already in NOINDEX_PREFIXES: a results page is not a page to index. */
  search: '/search',
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
  accountOrders: '/account/orders',
  accountReviews: '/account/reviews',
  forYou: '/account/for-you',
  /** The confirmation page for one order, reachable by the cart that placed it. */
  order: (number: string) => `/orders/${number}`,
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

/** Hard ceiling per line. A digital key order of 100 is a fraud signal. */
export const MAX_LINE_QTY = 10;

/** Below this, the storefront shows "only N left" instead of a plain badge. */
export const LOW_STOCK_THRESHOLD = 5;

/** Longest a message can wait before the promise on the page stops being true. */
export const CONTACT_REPLY_HOURS = 24;
