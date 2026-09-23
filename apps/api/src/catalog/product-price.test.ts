import { Prisma, PublishStatus, minPublishedPrice, refreshProductPrice } from '@da/db';
import { describe, expect, it, vi } from 'vitest';

/**
 * `Product.minPriceUsd` is what a price sort orders by, so it has to agree
 * with the variants a shopper can actually buy — a draft variant's price in the
 * minimum would put a product at the top of "cheapest first" at a price its
 * page never shows.
 */
const usd = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

describe('minPublishedPrice', () => {
  it('takes the cheapest published variant', () => {
    const min = minPublishedPrice([
      { priceUsd: usd('30.00'), status: PublishStatus.PUBLISHED },
      { priceUsd: usd('12.50'), status: PublishStatus.PUBLISHED },
      { priceUsd: usd('19.99'), status: PublishStatus.PUBLISHED },
    ]);
    expect(min?.toFixed(2)).toBe('12.50');
  });

  it('ignores a cheaper draft variant', () => {
    const min = minPublishedPrice([
      { priceUsd: usd('30.00'), status: PublishStatus.PUBLISHED },
      { priceUsd: usd('1.00'), status: PublishStatus.DRAFT },
    ]);
    expect(min?.toFixed(2)).toBe('30.00');
  });

  it('is null when nothing is published, so the product sorts last', () => {
    expect(minPublishedPrice([{ priceUsd: usd('5.00'), status: PublishStatus.DRAFT }])).toBeNull();
    expect(minPublishedPrice([])).toBeNull();
  });
});

describe('refreshProductPrice', () => {
  function fakeTx(prices: string[]) {
    return {
      variant: {
        findMany: vi.fn(() => Promise.resolve(prices.map((price) => ({ priceUsd: usd(price) })))),
      },
      product: { update: vi.fn(() => Promise.resolve({})) },
    };
  }

  it('reads only published variants of the product and stores their minimum', async () => {
    const tx = fakeTx(['40.00', '25.00']);
    const stored = await refreshProductPrice(tx, 'p1');

    expect(tx.variant.findMany).toHaveBeenCalledWith({
      where: { productId: 'p1', status: PublishStatus.PUBLISHED },
      select: { priceUsd: true },
    });
    expect(stored?.toFixed(2)).toBe('25.00');
    const update = tx.product.update.mock.calls[0] as unknown as [
      { where: { id: string }; data: { minPriceUsd: Prisma.Decimal | null } },
    ];
    expect(update[0].where).toEqual({ id: 'p1' });
    expect(update[0].data.minPriceUsd?.toFixed(2)).toBe('25.00');
  });

  it('writes null rather than skipping the write when the last variant is unpublished', async () => {
    // Skipping would leave the old minimum behind, and the product would keep
    // its place in a price sort with nothing on sale.
    const tx = fakeTx([]);
    expect(await refreshProductPrice(tx, 'p2')).toBeNull();
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'p2' },
      data: { minPriceUsd: null },
    });
  });
});
