/**
 * Catalog API client.
 *
 * Responses are parsed against the same zod schemas the API built them from, so
 * a shape change fails here with a readable path instead of surfacing as
 * `undefined` three components deep.
 *
 * The preview token is attached only when the site is not indexable. That ties
 * draft visibility to the indexing policy rather than to a separate switch: a
 * staging host shows work in progress, production shows published products, and
 * neither state needs remembering.
 */
import {
  type CatalogBrand,
  type CatalogCollection,
  type CatalogProductWithRelated,
  type CatalogStore,
  type ArticleWithProducts,
  type BlogIndex,
  type ContentPage,
  type Home,
  type ProductReviews,
  type PublicMarketing,
  type RedirectTarget,
  catalogBrandSchema,
  catalogCollectionSchema,
  catalogProductWithRelatedSchema,
  catalogStoreSchema,
  type SearchResults,
  searchResultsSchema,
  articleWithProductsSchema,
  blogIndexSchema,
  contentPageSchema,
  productReviewsSchema,
  publicMarketingSchema,
  redirectTargetSchema,
  homeSchema,
} from '@da/contracts';
import { z } from 'zod';

import { indexingPolicy } from './seo';
import { CURRENCY_COOKIE, DEFAULT_CURRENCY, validCurrency } from './currency';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const collectionSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  headline: z.string().nullable(),
  productCount: z.number().int(),
  children: z.number().int(),
});
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

interface FetchOptions {
  locale: string;
  currency?: string;
  page?: number;
  perPage?: number;
  /** Seconds; the catalog changes rarely, so pages are cached and revalidated. */
  revalidate?: number;
  /** One of the sorts the API implements. Anything else is ignored by it. */
  sort?: string;
  /** What was searched for. Only the search endpoint reads it. */
  q?: string;
  /**
   * Listing filters, already in the API's form (`apiFilters` in
   * `lib/listing`). Part of the URL, so each filtered state is cached on its
   * own like every other response.
   */
  filters?: Record<string, string>;
}

/**
 * The visitor's currency cookie, on the server.
 *
 * Reading it makes the page render per request rather than from the full-page
 * cache; the API responses are still cached per URL (the currency is in the
 * URL), so the cost is the render, not the round trip. Outside a request —
 * a build, a sitemap route — there is no cookie and the answer is dollars.
 */
async function serverCurrency(): Promise<string> {
  try {
    const { cookies } = await import('next/headers');
    return validCurrency((await cookies()).get(CURRENCY_COOKIE)?.value);
  } catch {
    return DEFAULT_CURRENCY;
  }
}

function buildUrl(pathname: string, options: FetchOptions & { currency: string }): string {
  const url = new URL(`/v1${pathname}`, API_URL);
  url.searchParams.set('locale', options.locale);
  url.searchParams.set('currency', options.currency);
  if (options.page) url.searchParams.set('page', String(options.page));
  if (options.perPage) url.searchParams.set('perPage', String(options.perPage));
  if (options.sort) url.searchParams.set('sort', options.sort);
  if (options.q !== undefined) url.searchParams.set('q', options.q);
  for (const [key, value] of Object.entries(options.filters ?? {}))
    url.searchParams.set(key, value);

  const token = process.env.PREVIEW_TOKEN;
  if (token && !indexingPolicy(process.env.NEXT_PUBLIC_SITE_URL).index) {
    url.searchParams.set('preview', token);
  }

  return url.toString();
}

/**
 * The API could not answer — unreachable, a 5xx, or a body that does not
 * match its contract. Distinct from "there is no such thing", which is `null`.
 */
export class ApiUnavailableError extends Error {
  constructor(pathname: string, reason: string) {
    super(`API unavailable for ${pathname}: ${reason}`);
    this.name = 'ApiUnavailableError';
  }
}

/**
 * How a failure is reported.
 *
 * `quiet` returns null for everything, which is right for the parts of a page
 * that can do without their data — the header's menu, a reviews section.
 *
 * `strict` is for the pages whose whole content is the response: a product, a
 * collection, the store. For those, null means "not found" and they answer
 * 404, so folding an outage into null told Google that every product had been
 * deleted for as long as the API was down, and sent the visitor to a page
 * saying the link was wrong. Strict throws instead, and the throw lands on
 * `error.tsx`, which says the store failed and offers to try again. Any 4xx
 * is still "not found": it is the API refusing this request, not failing.
 */
type Failure = 'quiet' | 'strict';

async function request<T>(
  pathname: string,
  options: FetchOptions,
  schema: z.ZodType<T>,
  failure: Failure = 'quiet',
): Promise<T | null> {
  const fail = (reason: string): null => {
    if (failure === 'strict') throw new ApiUnavailableError(pathname, reason);
    return null;
  };

  let response: Response;
  try {
    const currency = options.currency ?? (await serverCurrency());
    response = await fetch(buildUrl(pathname, { ...options, currency }), {
      next: { revalidate: options.revalidate ?? 300 },
      headers: { accept: 'application/json' },
    });
  } catch {
    // A page that cannot reach the API should render its own error, not a
    // stack trace, so the caller decides.
    return fail('unreachable');
  }

  if (response.status === 404) return null;
  if (response.status >= 500) return fail(`status ${String(response.status)}`);
  if (!response.ok) return null;

  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        `API response for ${pathname} did not match its contract:`,
        parsed.error.issues.slice(0, 5),
      );
    }
    return fail('response did not match its contract');
  }
  return parsed.data;
}

export function getHome(options: FetchOptions): Promise<Home | null> {
  return request('/catalog/home', options, homeSchema);
}

/** Throws `ApiUnavailableError` when the API fails; see `Failure`. */
export function getStore(options: FetchOptions): Promise<CatalogStore | null> {
  return request('/catalog/store', options, catalogStoreSchema, 'strict');
}

/**
 * Search.
 *
 * Not cached, unlike everything else here. A results page is per-visitor by
 * definition — the query is the page — and a shared cache keyed on a URL with
 * arbitrary text in it fills with entries nobody asks for twice.
 */
export function searchProducts(
  options: FetchOptions & { q: string },
): Promise<SearchResults | null> {
  return request('/catalog/search', { ...options, revalidate: 0 }, searchResultsSchema);
}

export function getCollections(options: FetchOptions): Promise<CollectionSummary[] | null> {
  return request('/catalog/collections', options, z.array(collectionSummarySchema));
}

/** Null only when there is no such collection; throws when the API fails. */
export function getCollection(
  slug: string,
  options: FetchOptions,
): Promise<CatalogCollection | null> {
  return request(
    `/catalog/collections/${encodeURIComponent(slug)}`,
    options,
    catalogCollectionSchema,
    'strict',
  );
}

export function getBrand(slug: string, options: FetchOptions): Promise<CatalogBrand | null> {
  return request(`/catalog/brands/${encodeURIComponent(slug)}`, options, catalogBrandSchema);
}

/**
 * Where a legacy URL goes now.
 *
 * Never cached: this is asked on what would otherwise be a 404, the answer
 * changes when somebody edits the map, and the API counts the hit — a cached
 * redirect is a hit nobody records.
 */
export function getRedirect(pathname: string): Promise<RedirectTarget | null> {
  return request(
    `/content/redirects?path=${encodeURIComponent(pathname)}`,
    {
      locale: 'ar',
      revalidate: 0,
    },
    redirectTargetSchema,
  );
}

/**
 * Tells the API a path answered 404.
 *
 * Fire and forget, and deliberately not awaited into the render: a visitor
 * looking at a 404 page must not wait for the store's own bookkeeping, and a
 * failure to record one is not worth a second error.
 */
export function reportNotFound(pathname: string, referer?: string): void {
  void fetch(new URL('/v1/content/not-found', API_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: pathname, ...(referer ? { referer } : {}) }),
    cache: 'no-store',
  }).catch(() => undefined);
}

export function getPage(slug: string, options: FetchOptions): Promise<ContentPage | null> {
  return request(`/content/pages/${encodeURIComponent(slug)}`, options, contentPageSchema);
}

export function getPosts(options: FetchOptions): Promise<BlogIndex | null> {
  return request('/content/posts', options, blogIndexSchema);
}

export function getPost(slug: string, options: FetchOptions): Promise<ArticleWithProducts | null> {
  return request(`/content/posts/${encodeURIComponent(slug)}`, options, articleWithProductsSchema);
}

/** Null only when there is no such product; throws when the API fails. */
export function getProduct(
  slug: string,
  options: FetchOptions,
): Promise<CatalogProductWithRelated | null> {
  return request(
    `/catalog/products/${encodeURIComponent(slug)}`,
    options,
    catalogProductWithRelatedSchema,
    'strict',
  );
}

/**
 * Published reviews for a product, with the aggregate over the same rows.
 *
 * Revalidated faster than the product itself. A review that has just been
 * approved is the one piece of this page somebody is waiting to see appear,
 * and five minutes of a stale product description costs nothing by comparison.
 */
export function getProductReviews(
  slug: string,
  options: FetchOptions,
): Promise<ProductReviews | null> {
  return request(
    `/reviews/products/${encodeURIComponent(slug)}`,
    { ...options, revalidate: options.revalidate ?? 60 },
    productReviewsSchema,
  );
}

/**
 * The marketing features' storefront-visible settings (disabled ones are null).
 *
 * Quiet on failure: every consumer is decoration around the page — a trust
 * block, a registration line — and a page must not fail because the panel's
 * settings could not be read. A minute's revalidation, so a change made on the
 * panel is on the site before whoever made it has finished checking.
 */
export function getMarketingPublic(options: FetchOptions): Promise<PublicMarketing | null> {
  return request(
    '/marketing/public',
    { ...options, revalidate: options.revalidate ?? 60 },
    publicMarketingSchema,
  );
}
