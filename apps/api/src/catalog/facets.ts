import {
  type CatalogFacets,
  type CatalogFilters,
  type DeviceBucket,
  DEVICE_BUCKETS,
  PRICE_BUCKETS_USD,
  priceBucketKey,
  type TermBucket,
  TERM_BUCKETS,
  deviceBucket,
  platformSchema,
  termBucket,
} from '@da/contracts';
import { FulfillmentMode, type Platform, type LicensePeriodUnit, type Prisma } from '@da/db';

import type { LiveSale } from '../offers/offer-rules.js';
import { salePriced } from '../offers/sales.service.js';

import type { FxTable } from './pricing.js';

/**
 * Listing filters and their counts, computed in memory.
 *
 * The whole catalogue is about ninety products with two or three variants
 * each, so a listing loads its candidates — every published product in scope,
 * with just the variant columns a filter reads — and filters and counts them
 * here. That is one indexed query of a few hundred narrow rows, cheaper than
 * the eight GROUP BY queries standard faceting would take in SQL, and it keeps
 * every rule (the sale price, "buyable", the buckets) in one language and one
 * file that a test can pin.
 *
 * Where it stops being right: somewhere past a few thousand products, or as
 * soon as listings need text relevance and filters together. At that point
 * this moves to Meilisearch facets (the env var already exists) or to SQL with
 * `minPriceUsd`-style denormalised columns per filter; the contract the
 * storefront sees — `CatalogFacets` and the query params — does not change.
 */

/** What a filter needs to know about one variant, already bucketed. */
export interface FacetVariant {
  platform: Platform;
  term: TermBucket;
  devices: DeviceBucket;
  /** After any live sale: the price the card would show, in USD. */
  priceUsd: number;
  /** Buyable now — a stocked line with stock left, or any made-to-order one. */
  buyable: boolean;
  /** A live sale on the product, or a genuine strike-through on this variant. */
  onSale: boolean;
}

export interface FacetProduct {
  id: string;
  brand: { slug: string; label: string } | null;
  variants: FacetVariant[];
}

/** The rows `toFacetProduct` reads. Kept narrow: this is loaded for every product in scope. */
export interface FacetSourceRow {
  id: string;
  brand: { slug: string; name: string; translations: { name: string }[] } | null;
  variants: {
    platform: Platform;
    licensePeriodUnit: LicensePeriodUnit;
    deviceCount: number;
    priceUsd: Prisma.Decimal;
    compareAtUsd: Prisma.Decimal | null;
    fulfillmentMode: FulfillmentMode;
    inventory: { onHand: number; reserved: number } | null;
  }[];
}

export function toFacetProduct(row: FacetSourceRow, sale: LiveSale | null): FacetProduct {
  return {
    id: row.id,
    brand: row.brand
      ? { slug: row.brand.slug, label: row.brand.translations[0]?.name ?? row.brand.name }
      : null,
    variants: row.variants.map((variant) => {
      const priced = salePriced(variant, sale);
      const stocked = variant.fulfillmentMode === FulfillmentMode.FROM_STOCK;
      const sellable = Math.max(
        0,
        (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0),
      );
      return {
        platform: variant.platform,
        term: termBucket(variant.licensePeriodUnit),
        devices: deviceBucket(variant.deviceCount),
        priceUsd: priced.priceUsd.toNumber(),
        buyable: stocked ? sellable > 0 : true,
        // `salePriced` turns the pre-sale price into the compare-at, so one
        // test covers both a seasonal sale and a variant's own strike-through.
        onSale: priced.compareAtUsd !== null && priced.compareAtUsd.greaterThan(priced.priceUsd),
      };
    }),
  };
}

/** The groups a filter can belong to. Counting a group ignores its own selection. */
type Group = 'brand' | 'platform' | 'term' | 'devices' | 'price' | 'inStock' | 'onSale';

function priceActive(filters: CatalogFilters): boolean {
  return filters.minUsd !== null || filters.maxUsd !== null;
}

function variantFiltersActive(filters: CatalogFilters, skip: Group | null): boolean {
  return (
    (skip !== 'platform' && filters.platform.length > 0) ||
    (skip !== 'term' && filters.term.length > 0) ||
    (skip !== 'devices' && filters.devices.length > 0) ||
    (skip !== 'price' && priceActive(filters)) ||
    (skip !== 'inStock' && filters.inStock) ||
    (skip !== 'onSale' && filters.onSale)
  );
}

export function variantMatches(
  variant: FacetVariant,
  filters: CatalogFilters,
  skip: Group | null = null,
): boolean {
  if (skip !== 'platform' && filters.platform.length > 0) {
    if (!filters.platform.includes(variant.platform)) return false;
  }
  if (skip !== 'term' && filters.term.length > 0 && !filters.term.includes(variant.term)) {
    return false;
  }
  if (skip !== 'devices' && filters.devices.length > 0) {
    if (!filters.devices.includes(variant.devices)) return false;
  }
  if (skip !== 'price') {
    if (filters.minUsd !== null && variant.priceUsd < filters.minUsd) return false;
    if (filters.maxUsd !== null && variant.priceUsd >= filters.maxUsd) return false;
  }
  if (skip !== 'inStock' && filters.inStock && !variant.buyable) return false;
  if (skip !== 'onSale' && filters.onSale && !variant.onSale) return false;
  return true;
}

/**
 * The variants of a product that satisfy every variant-level filter at once,
 * or null when no variant-level filter applies — "no constraint", which is
 * different from "none match": a published product with no variant to filter
 * on still belongs in an unfiltered listing.
 */
function passingVariants(
  product: FacetProduct,
  filters: CatalogFilters,
  skip: Group | null,
): FacetVariant[] | null {
  if (!variantFiltersActive(filters, skip)) return null;
  return product.variants.filter((variant) => variantMatches(variant, filters, skip));
}

export function productMatches(
  product: FacetProduct,
  filters: CatalogFilters,
  skip: Group | null = null,
): boolean {
  if (skip !== 'brand' && filters.brand.length > 0) {
    if (!product.brand || !filters.brand.includes(product.brand.slug)) return false;
  }
  // Any-variant semantics: one variant has to satisfy all of the filters
  // together. "Windows" and "lifetime" matched by two different variants is
  // a product that sells neither a lifetime Windows licence nor the page the
  // shopper asked for.
  const passing = passingVariants(product, filters, skip);
  return passing === null || passing.length > 0;
}

export function matchProducts(
  products: readonly FacetProduct[],
  filters: CatalogFilters,
): FacetProduct[] {
  return products.filter((product) => productMatches(product, filters));
}

/**
 * Per-option product counts, each computed with the other groups applied.
 *
 * For a variant-level option the question is "is there a variant that passes
 * every other filter *and* is this option", counted once per product — so a
 * product with a Windows and a Mac variant counts once under each platform.
 */
function countVariantOption<T>(
  products: readonly FacetProduct[],
  filters: CatalogFilters,
  group: Group,
  valueOf: (variant: FacetVariant) => T | null,
): Map<T, number> {
  const counts = new Map<T, number>();
  for (const product of products) {
    if (!productMatches(product, filters, group)) continue;
    const pool = passingVariants(product, filters, group) ?? product.variants;
    const seen = new Set<T>();
    for (const variant of pool) {
      const value = valueOf(variant);
      if (value !== null) seen.add(value);
    }
    for (const value of seen) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/** Which USD band a price falls in, by `priceBucketKey`. Half-open bands. */
export function priceBucketFor(priceUsd: number): string | null {
  const bucket = PRICE_BUCKETS_USD.find(
    (entry) => priceUsd >= entry.min && (entry.max === null || priceUsd < entry.max),
  );
  return bucket ? priceBucketKey(bucket) : null;
}

/**
 * A band edge in the page's currency: the same rate the prices use, rounded to
 * a whole unit and without the psychological `.95` rounding a price gets —
 * "under 94" reads as a band, "under 93.95" reads as a price.
 */
export function bandEdge(
  usd: number,
  currency: string,
  fx: FxTable,
): { amount: string; currency: string } {
  const entry = currency === 'USD' ? undefined : fx[currency];
  if (!entry) return { amount: String(Math.round(usd)), currency: 'USD' };
  return { amount: String(Math.round(entry.rate.toNumber() * usd)), currency };
}

export function facetCounts(
  products: readonly FacetProduct[],
  filters: CatalogFilters,
  display: { currency: string; fx: FxTable },
  options: { brands: boolean } = { brands: true },
): CatalogFacets {
  const brandCounts = new Map<string, { label: string; count: number }>();
  if (options.brands) {
    // Every brand in scope gets a row, at zero when the other filters leave it
    // nothing — the same rule as every other group, and what lets a selected
    // brand be unticked after a second filter has emptied it.
    for (const product of products) {
      if (!product.brand) continue;
      const entry = brandCounts.get(product.brand.slug) ?? { label: product.brand.label, count: 0 };
      if (productMatches(product, filters, 'brand')) entry.count += 1;
      brandCounts.set(product.brand.slug, entry);
    }
  }

  const platforms = countVariantOption(products, filters, 'platform', (v) => v.platform);
  const terms = countVariantOption(products, filters, 'term', (v) => v.term);
  const devices = countVariantOption(products, filters, 'devices', (v) => v.devices);
  const prices = countVariantOption(products, filters, 'price', (v) => priceBucketFor(v.priceUsd));
  const inStock = countVariantOption(products, filters, 'inStock', (v) =>
    v.buyable ? true : null,
  );
  const onSale = countVariantOption(products, filters, 'onSale', (v) => (v.onSale ? true : null));

  return {
    brand: [...brandCounts.entries()]
      .map(([value, entry]) => ({ value, label: entry.label, count: entry.count }))
      // Biggest shelf first, then alphabetical so equal counts do not shuffle.
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    platform: platformSchema.options.map((value) => ({ value, count: platforms.get(value) ?? 0 })),
    term: TERM_BUCKETS.map((value) => ({ value, count: terms.get(value) ?? 0 })),
    devices: DEVICE_BUCKETS.map((value) => ({ value, count: devices.get(value) ?? 0 })),
    price: PRICE_BUCKETS_USD.map((bucket) => {
      const key = priceBucketKey(bucket);
      const min = bandEdge(bucket.min, display.currency, display.fx);
      const max = bucket.max === null ? null : bandEdge(bucket.max, display.currency, display.fx);
      return {
        key,
        minUsd: bucket.min,
        maxUsd: bucket.max,
        min: min.amount,
        max: max?.amount ?? null,
        currency: min.currency,
        count: prices.get(key) ?? 0,
      };
    }),
    inStock: inStock.get(true) ?? 0,
    onSale: onSale.get(true) ?? 0,
  };
}
