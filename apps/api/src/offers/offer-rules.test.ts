import { describe, expect, it } from 'vitest';

import type { SeasonalSale } from '@da/contracts';
import { Prisma } from '@da/db';

import { applySale, displayPrice } from '../catalog/pricing.js';

import {
  bestDiscount,
  liveSales,
  nextTier,
  pairDiscount,
  saleFor,
  tierFor,
  volumeDiscountUsd,
  withDescendants,
} from './offer-rules.js';

const usd = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

/**
 * The rules that decide money in the basket offers. Each case is a way the
 * store could give away a discount it did not mean to, or charge a price it
 * did not show.
 */

// --- volume tiers ------------------------------------------------------------

const TIERS = [
  { minItems: 3, percent: 10 },
  { minItems: 2, percent: 5 },
  { minItems: 5, percent: 15 },
];

describe('tierFor', () => {
  it('gives nothing below the first threshold', () => {
    expect(tierFor(TIERS, 1)).toBeNull();
  });

  it('takes the highest threshold met, whatever order the tiers were saved in', () => {
    expect(tierFor(TIERS, 2)).toEqual({ minItems: 2, percent: 5 });
    expect(tierFor(TIERS, 4)).toEqual({ minItems: 3, percent: 10 });
    expect(tierFor(TIERS, 9)).toEqual({ minItems: 5, percent: 15 });
  });

  it('ignores a zero-percent tier', () => {
    expect(tierFor([{ minItems: 2, percent: 0 }], 2)).toBeNull();
  });
});

describe('nextTier', () => {
  it('names the nearest better tier and how many licences away it is', () => {
    expect(nextTier(TIERS, 1)).toEqual({ minItems: 2, percent: 5, itemsToGo: 1 });
    expect(nextTier(TIERS, 3)).toEqual({ minItems: 5, percent: 15, itemsToGo: 2 });
  });

  it('is null at the top tier', () => {
    expect(nextTier(TIERS, 5)).toBeNull();
  });

  it('never dangles a later tier that gives less', () => {
    expect(
      nextTier(
        [
          { minItems: 2, percent: 10 },
          { minItems: 4, percent: 5 },
        ],
        2,
      ),
    ).toBeNull();
  });
});

describe('volumeDiscountUsd', () => {
  it('takes the percent off the subtotal, to the cent', () => {
    expect(volumeDiscountUsd(usd('33.33'), { minItems: 3, percent: 10 }).toFixed(2)).toBe('3.33');
    expect(volumeDiscountUsd(usd('33.33'), null).toFixed(2)).toBe('0.00');
  });
});

// --- pairs -------------------------------------------------------------------

const PAIRS = [
  { productId: 'windows', suggestProductIds: ['antivirus', 'office'], discountPercent: 10 },
  { productId: 'office', suggestProductIds: ['antivirus'], discountPercent: 20 },
];

describe('pairDiscount', () => {
  it('discounts the suggested product beside its anchor, not the anchor', () => {
    const result = pairDiscount(
      [
        { productId: 'windows', qty: 1, unitPriceUsd: usd('100') },
        { productId: 'antivirus', qty: 1, unitPriceUsd: usd('30') },
      ],
      PAIRS,
    );
    expect(result.discountUsd.toFixed(2)).toBe('3.00');
    expect(result.percent).toBe(10);
    expect(result.matched).toBe(true);
  });

  it('gives nothing for the suggestion on its own', () => {
    const result = pairDiscount(
      [{ productId: 'antivirus', qty: 2, unitPriceUsd: usd('30') }],
      PAIRS,
    );
    expect(result.discountUsd.toFixed(2)).toBe('0.00');
    expect(result.matched).toBe(false);
  });

  it('discounts as many as there are anchors, not every copy', () => {
    const result = pairDiscount(
      [
        { productId: 'windows', qty: 1, unitPriceUsd: usd('100') },
        { productId: 'antivirus', qty: 5, unitPriceUsd: usd('30') },
      ],
      PAIRS,
    );
    expect(result.discountUsd.toFixed(2)).toBe('3.00');
  });

  it('discounts a line once, at the best percent any anchor gives', () => {
    const result = pairDiscount(
      [
        { productId: 'windows', qty: 1, unitPriceUsd: usd('100') },
        { productId: 'office', qty: 1, unitPriceUsd: usd('50') },
        { productId: 'antivirus', qty: 1, unitPriceUsd: usd('30') },
      ],
      PAIRS,
    );
    // office beside windows: 10% of 50 = 5; antivirus: best of 10% / 20% = 6.
    expect(result.discountUsd.toFixed(2)).toBe('11.00');
    expect(result.percent).toBe(20);
  });

  it('counts a pair as matched even when it carries no discount', () => {
    const result = pairDiscount(
      [
        { productId: 'a', qty: 1, unitPriceUsd: usd('10') },
        { productId: 'b', qty: 1, unitPriceUsd: usd('10') },
      ],
      [{ productId: 'a', suggestProductIds: ['b'], discountPercent: 0 }],
    );
    expect(result.discountUsd.toFixed(2)).toBe('0.00');
    expect(result.matched).toBe(true);
  });
});

// --- one discount per cart ------------------------------------------------------

describe('bestDiscount', () => {
  it('takes the single largest, never a sum', () => {
    const best = bestDiscount([
      { kind: 'coupon', amountUsd: usd('5') },
      { kind: 'volume', amountUsd: usd('8') },
      { kind: 'pair', amountUsd: usd('3') },
    ]);
    expect(best).toEqual({ kind: 'volume', amountUsd: usd('8') });
  });

  it('gives a tie to the coupon the shopper chose', () => {
    const best = bestDiscount([
      { kind: 'volume', amountUsd: usd('5') },
      { kind: 'coupon', amountUsd: usd('5') },
    ]);
    expect(best?.kind).toBe('coupon');
  });

  it('is null when nothing is worth anything', () => {
    expect(
      bestDiscount([
        { kind: 'coupon', amountUsd: usd('0') },
        { kind: 'volume', amountUsd: usd('0') },
      ]),
    ).toBeNull();
  });
});

// --- seasonal sales -----------------------------------------------------------

const NOW = new Date('2026-03-20T12:00:00Z');

// Literal rather than parsed: in a worktree `@da/contracts` resolves at run
// time to another checkout's build, and these tests need only the shape.
const sale = (overrides: Partial<SeasonalSale>): SeasonalSale => ({
  id: 'ramadan',
  name: { ar: 'رمضان', en: 'Ramadan' },
  startsAt: '2026-03-01T00:00:00Z',
  endsAt: '2026-03-30T00:00:00Z',
  percent: 20,
  productIds: [],
  categoryIds: [],
  licenceNumber: '',
  showCountdown: false,
  ...overrides,
});

const CATEGORIES = [
  { id: 'microsoft', parentId: null },
  { id: 'office', parentId: 'microsoft' },
  { id: 'office-365', parentId: 'office' },
  { id: 'security', parentId: null },
];

describe('liveSales', () => {
  it('is empty while the feature is off, whatever is scheduled', () => {
    expect(liveSales({ enabled: false, sales: [sale({})] }, NOW, CATEGORIES)).toEqual([]);
  });

  it('opens at startsAt and closes at endsAt, exclusive', () => {
    const settings = { enabled: true, sales: [sale({})] };
    expect(liveSales(settings, new Date('2026-02-28T23:59:59Z'), CATEGORIES)).toHaveLength(0);
    expect(liveSales(settings, new Date('2026-03-01T00:00:00Z'), CATEGORIES)).toHaveLength(1);
    expect(liveSales(settings, new Date('2026-03-29T23:59:59Z'), CATEGORIES)).toHaveLength(1);
    expect(liveSales(settings, new Date('2026-03-30T00:00:00Z'), CATEGORIES)).toHaveLength(0);
  });

  it('drops a zero-percent sale', () => {
    expect(liveSales({ enabled: true, sales: [sale({ percent: 0 })] }, NOW, CATEGORIES)).toEqual(
      [],
    );
  });
});

describe('saleFor', () => {
  const live = (sales: SeasonalSale[]) => liveSales({ enabled: true, sales }, NOW, CATEGORIES);

  it('covers the whole catalogue when it names no products and no categories', () => {
    expect(saleFor(live([sale({})]), { id: 'p1', categoryIds: [] })?.id).toBe('ramadan');
  });

  it('covers a named product and nothing else', () => {
    const sales = live([sale({ productIds: ['p1'] })]);
    expect(saleFor(sales, { id: 'p1', categoryIds: [] })).not.toBeNull();
    expect(saleFor(sales, { id: 'p2', categoryIds: ['security'] })).toBeNull();
  });

  it('reaches products on the categories below a named one', () => {
    const sales = live([sale({ categoryIds: ['microsoft'] })]);
    expect(saleFor(sales, { id: 'p1', categoryIds: ['office-365'] })).not.toBeNull();
    expect(saleFor(sales, { id: 'p2', categoryIds: ['security'] })).toBeNull();
  });

  it('prices by the deepest overlapping sale, and the longer one on a tie', () => {
    const sales = live([
      sale({ id: 'short', percent: 10 }),
      sale({ id: 'deep', percent: 25, productIds: ['p1'] }),
      sale({ id: 'long', percent: 10, endsAt: '2026-04-10T00:00:00Z' }),
    ]);
    expect(saleFor(sales, { id: 'p1', categoryIds: [] })?.id).toBe('deep');
    expect(saleFor(sales, { id: 'p2', categoryIds: [] })?.id).toBe('long');
  });
});

describe('withDescendants', () => {
  it('survives a cycle in hand-edited data', () => {
    const looped = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    expect([...withDescendants(['a'], looped)].sort()).toEqual(['a', 'b']);
  });
});

// --- applying a sale to a price ------------------------------------------------

describe('applySale', () => {
  it('lowers the price and makes the real current price the compare-at', () => {
    const priced = applySale(usd('49.99'), null, 20);
    expect(priced.priceUsd.toFixed(2)).toBe('39.99');
    expect(priced.compareAtUsd?.toFixed(2)).toBe('49.99');
  });

  it('sets aside an older compare-at rather than showing a "was" that is not true', () => {
    const priced = applySale(usd('40.00'), usd('80.00'), 25);
    expect(priced.compareAtUsd?.toFixed(2)).toBe('40.00');
  });

  it('leaves the price alone with no sale', () => {
    const priced = applySale(usd('40.00'), usd('50.00'), null);
    expect(priced.priceUsd.toFixed(2)).toBe('40.00');
    expect(priced.compareAtUsd?.toFixed(2)).toBe('50.00');
  });

  it('shows the same amount the JSON-LD would carry, with an honest percent badge', () => {
    const priced = applySale(usd('10.00'), null, 20);
    const display = displayPrice(priced.priceUsd, priced.compareAtUsd, 'USD', {});
    expect(display).toEqual({
      amount: '8.00',
      currency: 'USD',
      compareAt: '10.00',
      discountPercent: 20,
    });
  });

  it('is not a sale when the percent rounds to nothing', () => {
    const priced = applySale(usd('0.01'), null, 10);
    expect(priced.priceUsd.toFixed(2)).toBe('0.01');
    expect(priced.compareAtUsd).toBeNull();
  });
});
