import { type CatalogFilters, catalogFiltersFrom, deviceBucket, termBucket } from '@da/contracts';
import { FulfillmentMode, Prisma } from '@da/db';
import { describe, expect, it } from 'vitest';

import type { LiveSale } from '../offers/offer-rules.js';

import {
  type FacetProduct,
  type FacetVariant,
  bandEdge,
  facetCounts,
  matchProducts,
  priceBucketFor,
  toFacetProduct,
} from './facets.js';
import type { FxTable } from './pricing.js';

/**
 * The facet rules are the product here: a count that disagrees with the grid
 * it filters to is a promise the page breaks one click later. These pin the
 * any-variant semantics, the "other groups applied" counting and the buckets.
 */

const usd = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

function variant(overrides: Partial<FacetVariant> = {}): FacetVariant {
  return {
    platform: 'WINDOWS',
    term: 'lifetime',
    devices: '1',
    priceUsd: 30,
    buyable: true,
    onSale: false,
    ...overrides,
  };
}

function product(id: string, brand: string | null, variants: FacetVariant[]): FacetProduct {
  return { id, brand: brand ? { slug: brand, label: brand.toUpperCase() } : null, variants };
}

const filters = (partial: Partial<CatalogFilters>): CatalogFilters => ({
  ...catalogFiltersFrom({}),
  ...partial,
});

const NO_FX: FxTable = {};
const display = { currency: 'USD', fx: NO_FX };

describe('bucket mapping', () => {
  it('folds licence units into three terms', () => {
    expect(termBucket('LIFETIME')).toBe('lifetime');
    expect(termBucket('YEAR')).toBe('year');
    expect(termBucket('MONTH')).toBe('month');
    // Day-counted trials are shorter than a year, which is the question asked.
    expect(termBucket('DAY')).toBe('month');
  });

  it('buckets device counts, with unlimited in the top band', () => {
    expect(deviceBucket(1)).toBe('1');
    expect(deviceBucket(2)).toBe('2-5');
    expect(deviceBucket(5)).toBe('2-5');
    expect(deviceBucket(6)).toBe('5+');
    expect(deviceBucket(0)).toBe('5+');
  });

  it('puts a price in exactly one half-open USD band', () => {
    expect(priceBucketFor(0)).toBe('0-25');
    expect(priceBucketFor(24.99)).toBe('0-25');
    expect(priceBucketFor(25)).toBe('25-50');
    expect(priceBucketFor(249.99)).toBe('100-250');
    expect(priceBucketFor(250)).toBe('250+');
    expect(priceBucketFor(4000)).toBe('250+');
  });

  it('labels band edges in the page currency, whole units, no .95 rounding', () => {
    const fx: FxTable = { SAR: { rate: usd('3.75'), decimals: 2, roundingRule: 'nearest_0_95' } };
    expect(bandEdge(25, 'SAR', fx)).toEqual({ amount: '94', currency: 'SAR' });
    expect(bandEdge(100, 'SAR', fx)).toEqual({ amount: '375', currency: 'SAR' });
    // No rate loaded: stay in dollars under a dollar label, like the prices do.
    expect(bandEdge(25, 'AED', fx)).toEqual({ amount: '25', currency: 'USD' });
  });
});

describe('toFacetProduct', () => {
  const row = {
    id: 'p1',
    brand: { slug: 'microsoft', name: 'Microsoft', translations: [{ name: 'مايكروسوفت' }] },
    variants: [
      {
        platform: 'WINDOWS' as const,
        licensePeriodUnit: 'YEAR' as const,
        deviceCount: 3,
        priceUsd: usd('40.00'),
        compareAtUsd: null,
        fulfillmentMode: FulfillmentMode.FROM_STOCK,
        inventory: { onHand: 2, reserved: 2 },
      },
      {
        platform: 'MAC' as const,
        licensePeriodUnit: 'LIFETIME' as const,
        deviceCount: 1,
        priceUsd: usd('60.00'),
        compareAtUsd: usd('80.00'),
        fulfillmentMode: FulfillmentMode.ON_DEMAND,
        inventory: null,
      },
    ],
  };

  it('buckets each variant and reads stock only for a stocked line', () => {
    const facet = toFacetProduct(row, null);
    expect(facet.brand).toEqual({ slug: 'microsoft', label: 'مايكروسوفت' });
    expect(facet.variants[0]).toMatchObject({ term: 'year', devices: '2-5', buyable: false });
    // Made to order: no shelf, always buyable.
    expect(facet.variants[1]).toMatchObject({ term: 'lifetime', buyable: true, onSale: true });
  });

  it('filters on the sale price, and a live sale counts as on sale', () => {
    const sale = { percent: 50 } as unknown as LiveSale;
    const facet = toFacetProduct(row, sale);
    expect(facet.variants[0]?.priceUsd).toBe(20);
    expect(facet.variants[0]?.onSale).toBe(true);
  });
});

describe('matchProducts', () => {
  const catalog = [
    // Windows is yearly, lifetime is Mac: no single variant is both.
    product('split', 'adobe', [
      variant({ platform: 'WINDOWS', term: 'year' }),
      variant({ platform: 'MAC', term: 'lifetime' }),
    ]),
    product('both', 'microsoft', [variant({ platform: 'WINDOWS', term: 'lifetime' })]),
    product('bare', null, []),
  ];

  it('returns everything, variant-less products included, when nothing is set', () => {
    expect(matchProducts(catalog, filters({})).map((p) => p.id)).toEqual(['split', 'both', 'bare']);
  });

  it('needs one variant to satisfy every variant filter at once', () => {
    const found = matchProducts(catalog, filters({ platform: ['WINDOWS'], term: ['lifetime'] }));
    expect(found.map((p) => p.id)).toEqual(['both']);
  });

  it('ORs within a group and ANDs across groups', () => {
    expect(
      matchProducts(catalog, filters({ platform: ['WINDOWS', 'MAC'] })).map((p) => p.id),
    ).toEqual(['split', 'both']);
    expect(
      matchProducts(catalog, filters({ brand: ['adobe'], term: ['lifetime'] })).map((p) => p.id),
    ).toEqual(['split']);
  });

  it('treats the price range as min inclusive, max exclusive', () => {
    const priced = [
      product('a', null, [variant({ priceUsd: 25 })]),
      product('b', null, [variant({ priceUsd: 50 })]),
    ];
    expect(matchProducts(priced, filters({ minUsd: 25, maxUsd: 50 })).map((p) => p.id)).toEqual([
      'a',
    ]);
  });
});

describe('facetCounts', () => {
  const catalog = [
    product('p1', 'adobe', [
      variant({ platform: 'WINDOWS', priceUsd: 10, buyable: false }),
      variant({ platform: 'MAC', priceUsd: 60 }),
    ]),
    product('p2', 'adobe', [variant({ platform: 'WINDOWS', priceUsd: 30, onSale: true })]),
    product('p3', 'norton', [variant({ platform: 'MAC', priceUsd: 300, term: 'year' })]),
  ];

  it('counts products, not variants', () => {
    const counts = facetCounts(catalog, filters({}), display);
    expect(counts.platform.find((o) => o.value === 'WINDOWS')?.count).toBe(2);
    expect(counts.platform.find((o) => o.value === 'MAC')?.count).toBe(2);
    expect(counts.brand).toEqual([
      { value: 'adobe', label: 'ADOBE', count: 2 },
      { value: 'norton', label: 'NORTON', count: 1 },
    ]);
  });

  it("ignores a group's own selection and applies the others", () => {
    const counts = facetCounts(
      catalog,
      filters({ platform: ['WINDOWS'], brand: ['adobe'] }),
      display,
    );
    // Platform counts keep the brand filter but not the platform one, so
    // ticking MAC shows what it would add.
    expect(counts.platform.find((o) => o.value === 'MAC')?.count).toBe(1);
    expect(counts.platform.find((o) => o.value === 'WINDOWS')?.count).toBe(2);
    // Brand counts keep the platform filter: Norton sells no Windows line.
    expect(counts.brand.find((o) => o.value === 'norton')?.count).toBe(0);
    expect(counts.brand.find((o) => o.value === 'adobe')?.count).toBe(2);
  });

  it('counts an option only through a variant that passes the other filters', () => {
    // In stock only: p1's Windows line is sold out, so p1 reaches the price
    // facet through its $60 Mac line alone.
    const counts = facetCounts(catalog, filters({ inStock: true }), display);
    expect(counts.price.find((o) => o.key === '0-25')?.count).toBe(0);
    expect(counts.price.find((o) => o.key === '50-100')?.count).toBe(1);
    expect(counts.price.find((o) => o.key === '25-50')?.count).toBe(1);
    expect(counts.price.find((o) => o.key === '250+')?.count).toBe(1);
  });

  it('counts the two switches with the other filters applied', () => {
    const counts = facetCounts(catalog, filters({ platform: ['MAC'] }), display);
    expect(counts.inStock).toBe(2);
    // p2 is the only one on sale, and it has no Mac line.
    expect(counts.onSale).toBe(0);
  });

  it('keeps a selected brand at zero so it can be unticked', () => {
    const counts = facetCounts(
      catalog,
      filters({ brand: ['norton'], platform: ['WINDOWS'] }),
      display,
    );
    expect(counts.brand.find((o) => o.value === 'norton')).toEqual({
      value: 'norton',
      label: 'NORTON',
      count: 0,
    });
  });

  it('omits the brand facet where it is asked to', () => {
    expect(facetCounts(catalog, filters({}), display, { brands: false }).brand).toEqual([]);
  });

  it('lists every band, labelled in the page currency', () => {
    const fx: FxTable = { AED: { rate: usd('3.6725'), decimals: 2, roundingRule: 'none' } };
    const counts = facetCounts(catalog, filters({}), { currency: 'AED', fx });
    expect(counts.price.map((o) => o.key)).toEqual(['0-25', '25-50', '50-100', '100-250', '250+']);
    expect(counts.price[1]).toMatchObject({
      minUsd: 25,
      maxUsd: 50,
      min: '92',
      max: '184',
      currency: 'AED',
    });
    expect(counts.price[4]).toMatchObject({ maxUsd: null, max: null });
  });
});
