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
  type CatalogCollection,
  type CatalogProductWithRelated,
  type CatalogStore,
  type ContentPage,
  type Home,
  type ProductReviews,
  type RedirectTarget,
  catalogCollectionSchema,
  catalogProductWithRelatedSchema,
  catalogStoreSchema,
  type SearchResults,
  searchResultsSchema,
  contentPageSchema,
  productReviewsSchema,
  redirectTargetSchema,
  homeSchema,
} from '@da/contracts';
import { z } from 'zod';

import { indexingPolicy } from './seo';

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
}

function buildUrl(pathname: string, options: FetchOptions): string {
  const url = new URL(`/v1${pathname}`, API_URL);
  url.searchParams.set('locale', options.locale);
  url.searchParams.set('currency', options.currency ?? 'USD');
  if (options.page) url.searchParams.set('page', String(options.page));
  if (options.perPage) url.searchParams.set('perPage', String(options.perPage));
  if (options.sort) url.searchParams.set('sort', options.sort);
  if (options.q !== undefined) url.searchParams.set('q', options.q);

  const token = process.env.PREVIEW_TOKEN;
  if (token && !indexingPolicy(process.env.NEXT_PUBLIC_SITE_URL).index) {
    url.searchParams.set('preview', token);
  }

  return url.toString();
}

async function request<T>(
  pathname: string,
  options: FetchOptions,
  schema: z.ZodType<T>,
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetch(buildUrl(pathname, options), {
      next: { revalidate: options.revalidate ?? 300 },
      headers: { accept: 'application/json' },
    });
  } catch {
    // A page that cannot reach the API should render its own error, not a
    // stack trace, so the caller decides.
    return null;
  }

  if (response.status === 404) return null;
  if (!response.ok) return null;

  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        `API response for ${pathname} did not match its contract:`,
        parsed.error.issues.slice(0, 5),
      );
    }
    return null;
  }
  return parsed.data;
}

export function getHome(options: FetchOptions): Promise<Home | null> {
  return request('/catalog/home', options, homeSchema);
}

export function getStore(options: FetchOptions): Promise<CatalogStore | null> {
  return request('/catalog/store', options, catalogStoreSchema);
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

export function getCollection(
  slug: string,
  options: FetchOptions,
): Promise<CatalogCollection | null> {
  return request(
    `/catalog/collections/${encodeURIComponent(slug)}`,
    options,
    catalogCollectionSchema,
  );
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

export function getProduct(
  slug: string,
  options: FetchOptions,
): Promise<CatalogProductWithRelated | null> {
  return request(
    `/catalog/products/${encodeURIComponent(slug)}`,
    options,
    catalogProductWithRelatedSchema,
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
