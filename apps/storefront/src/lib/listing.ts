/**
 * A catalogue listing's URL state: page, sort and filters.
 *
 * Every state is a real URL, built here and parsed here, so a filter reached
 * by ticking a box, by a chip's remove link or by a pasted link is the same
 * address. Repeated parameters (`brand=a&brand=b`) rather than a comma list,
 * because that is what a plain GET form submits — the page works with no
 * JavaScript at all, and a link built here then matches the form's own URL.
 *
 * The parameter names are deliberately not WooCommerce's (`min_price`,
 * `filter_…`, `orderby`): robots.txt still disallows those for the legacy
 * URLs, and a crawler refused a URL never reads the `noindex` these pages
 * carry — which is what actually keeps filtered pages out of the index.
 */
import {
  type DeviceBucket,
  DEVICE_BUCKETS,
  PRICE_BUCKETS_USD,
  type TermBucket,
  TERM_BUCKETS,
  platformSchema,
  priceBucketKey,
} from '@da/contracts';
import type { Metadata } from 'next';

import { paginatedUrl, robotsMeta } from './seo';

type Platform = (typeof platformSchema.options)[number];
type Search = Record<string, string | string[] | undefined>;

/** The sorts a listing offers. Best-selling is the store's default already. */
export const LISTING_SORTS = ['position', 'newest', 'price-asc', 'price-desc'] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export interface ListingFilters {
  brand: string[];
  platform: Platform[];
  term: TermBucket[];
  devices: DeviceBucket[];
  /** A `priceBucketKey`, or null. One band at a time: they are ranges. */
  price: string | null;
  inStock: boolean;
  onSale: boolean;
}

export interface ListingState {
  page: number;
  sort: ListingSort;
  filters: ListingFilters;
}

const PRICE_KEYS = PRICE_BUCKETS_USD.map(priceBucketKey);
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

function all(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return [...new Set(list.flatMap((entry) => entry.split(',')).map((entry) => entry.trim()))];
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function only<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((value): value is T => (allowed as readonly string[]).includes(value));
}

/** Anything unrecognised is dropped, never an error: these URLs get edited by hand. */
export function parseListing(search: Search): ListingState {
  const page = Number.parseInt(first(search.page) ?? '1', 10);
  const sort = first(search.sort);
  const price = first(search.price);
  const flag = (value: string | string[] | undefined): boolean =>
    first(value) === '1' || first(value) === 'true';

  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    sort: LISTING_SORTS.includes(sort as ListingSort) ? (sort as ListingSort) : 'position',
    filters: {
      brand: all(search.brand)
        .filter((slug) => SLUG.test(slug))
        .slice(0, 20),
      platform: only(all(search.platform), platformSchema.options),
      term: only(all(search.term), TERM_BUCKETS),
      devices: only(all(search.devices), DEVICE_BUCKETS),
      price: price && PRICE_KEYS.includes(price) ? price : null,
      inStock: flag(search.inStock),
      onSale: flag(search.onSale),
    },
  };
}

export const NO_FILTERS: ListingFilters = {
  brand: [],
  platform: [],
  term: [],
  devices: [],
  price: null,
  inStock: false,
  onSale: false,
};

/** How many selections are active — the number on the "Filters (N)" button. */
export function filterCount(filters: ListingFilters): number {
  return (
    filters.brand.length +
    filters.platform.length +
    filters.term.length +
    filters.devices.length +
    (filters.price ? 1 : 0) +
    (filters.inStock ? 1 : 0) +
    (filters.onSale ? 1 : 0)
  );
}

export function isFiltered(filters: ListingFilters): boolean {
  return filterCount(filters) > 0;
}

/** The filters as query pairs, in a fixed order so one state has one URL. */
function filterPairs(filters: ListingFilters): [string, string][] {
  return [
    ...filters.brand.map((value): [string, string] => ['brand', value]),
    ...filters.platform.map((value): [string, string] => ['platform', value]),
    ...filters.term.map((value): [string, string] => ['term', value]),
    ...filters.devices.map((value): [string, string] => ['devices', value]),
    ...(filters.price ? [['price', filters.price] as [string, string]] : []),
    ...(filters.inStock ? [['inStock', '1'] as [string, string]] : []),
    ...(filters.onSale ? [['onSale', '1'] as [string, string]] : []),
  ];
}

/**
 * A listing URL. Changing the filters or the sort goes back to page 1 unless a
 * page is given: page 3 of a different result set is a page that may not exist.
 */
export function listingHref(
  path: string,
  state: ListingState,
  next: { page?: number; sort?: ListingSort; filters?: ListingFilters } = {},
): string {
  const changesSet = next.filters !== undefined || next.sort !== undefined;
  const filters = next.filters ?? state.filters;
  const sort = next.sort ?? state.sort;
  const page = next.page ?? (changesSet ? 1 : state.page);

  const query = new URLSearchParams(filterPairs(filters));
  if (sort !== 'position') query.set('sort', sort);
  if (page > 1) query.set('page', String(page));
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ''}`;
}

/**
 * The filters as the API reads them.
 *
 * Lists are comma-joined here because this is a server-to-server URL that
 * nobody reads. The price band becomes its USD edges: the API filters in
 * dollars, the band is only a name for a pair of them.
 */
export function apiFilters(filters: ListingFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.brand.length > 0) params.brand = filters.brand.join(',');
  if (filters.platform.length > 0) params.platform = filters.platform.join(',');
  if (filters.term.length > 0) params.term = filters.term.join(',');
  if (filters.devices.length > 0) params.devices = filters.devices.join(',');
  const band = PRICE_BUCKETS_USD.find((bucket) => priceBucketKey(bucket) === filters.price);
  if (band) {
    params.minUsd = String(band.min);
    if (band.max !== null) params.maxUsd = String(band.max);
  }
  if (filters.inStock) params.inStock = 'true';
  if (filters.onSale) params.onSale = 'true';
  return params;
}

/** One selection removed, for a chip's "×" link. */
export function without(
  filters: ListingFilters,
  group: keyof ListingFilters,
  value?: string,
): ListingFilters {
  switch (group) {
    case 'price':
      return { ...filters, price: null };
    case 'inStock':
    case 'onSale':
      return { ...filters, [group]: false };
    default:
      return {
        ...filters,
        [group]: (filters[group] as string[]).filter((entry) => entry !== value),
      };
  }
}

/**
 * Canonical and robots for a listing.
 *
 * Unfiltered and unsorted: page N is canonical to itself, as before — the
 * products only on page 3 keep their crawl path. Sorted: canonical to the
 * unsorted page N, since a re-ordering is the same products, but still
 * indexable-with-canonical so the signal consolidates rather than vanishes.
 * Filtered: `noindex, follow`, canonical to the bare unfiltered page. Eight
 * filter groups over ninety products is thousands of near-duplicate URLs; the
 * pages still pass links to the products on them, they just do not compete
 * with the category page for its own query.
 */
export function listingSeo(
  state: ListingState,
  urls: { canonical: string; languages: { hrefLang: string; href: string }[] },
): Pick<Metadata, 'robots' | 'alternates'> {
  const base = robotsMeta(process.env.NEXT_PUBLIC_SITE_URL);
  const filtered = isFiltered(state.filters);
  const page = filtered ? 1 : state.page;

  return {
    robots:
      filtered && base.index
        ? { index: false, follow: true, googleBot: { index: false, follow: true } }
        : base,
    alternates: {
      canonical: paginatedUrl(urls.canonical, page),
      languages: Object.fromEntries(
        urls.languages.map((link) => [link.hrefLang, paginatedUrl(link.href, page)]),
      ),
    },
  };
}

/** A facet option is worth a row when it would find something, or is selected. */
export function visibleOptions<T extends { count: number }>(
  options: readonly T[],
  selected: (option: T) => boolean,
): T[] {
  return options.filter((option) => option.count > 0 || selected(option));
}
