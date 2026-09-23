import { describe, expect, it } from 'vitest';

import { cardOrder, productOrder } from './ordering.js';

/**
 * The price sorts are the ones that used to be missing, and the rule most
 * likely to regress is "nulls last": Postgres puts NULL first on a descending
 * sort by default, which would open "most expensive first" on products that
 * have no published variant and cannot be bought.
 */
describe('productOrder', () => {
  it('sorts by the denormalised minimum price, nulls last, both ways', () => {
    expect(productOrder('price-asc')).toEqual([
      { minPriceUsd: { sort: 'asc', nulls: 'last' } },
      { slug: 'asc' },
    ]);
    expect(productOrder('price-desc')).toEqual([
      { minPriceUsd: { sort: 'desc', nulls: 'last' } },
      { slug: 'asc' },
    ]);
  });

  it('keeps a stable tie-break so pages do not overlap', () => {
    for (const sort of ['position', 'newest', 'best-selling', 'price-asc', 'price-desc'] as const) {
      expect(productOrder(sort).at(-1)).toEqual({ slug: 'asc' });
    }
  });
});

describe('cardOrder', () => {
  it('orders a collection by the product price, nulls last, then shelf position', () => {
    expect(cardOrder('price-asc')).toEqual([
      { product: { minPriceUsd: { sort: 'asc', nulls: 'last' } } },
      { position: 'asc' },
    ]);
    expect(cardOrder('price-desc')).toEqual([
      { product: { minPriceUsd: { sort: 'desc', nulls: 'last' } } },
      { position: 'asc' },
    ]);
  });

  it("keeps the shelf's own order as the default", () => {
    expect(cardOrder('position')).toEqual([{ position: 'asc' }]);
  });
});
