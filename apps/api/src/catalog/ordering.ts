import type { CatalogQuery } from '@da/contracts';
import type { Prisma } from '@da/db';

/**
 * How a listing is ordered, over Product rows (store, brand) and over
 * ProductCategory rows (a collection, which has its own `position`).
 *
 * Both lists offer the same sorts, so "newest" means the same thing on every
 * page — a store whose sorts disagree with its category sorts is one where a
 * product appears to move when it has not.
 *
 * Price sorts read `Product.minPriceUsd`, the cheapest published variant,
 * denormalised because Postgres cannot ORDER BY a MIN over a relation without
 * an aggregate join. Nulls last in both directions: a product with no
 * published variant has no price, and "most expensive first" should not open
 * on something that cannot be bought.
 *
 * Known gap, accepted: a live seasonal sale is applied when the card is drawn
 * and is not in the column. A sale takes the same percent off every variant,
 * so within one sale's scope the order is still right; across scopes a product
 * 20% off can sit a few places later than its sale price would put it. Fixing
 * that means rewriting the column whenever a sale starts or ends, which is a
 * job, not a query, and not worth it for a catalogue this size.
 */
export function productOrder(sort: CatalogQuery['sort']): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ publishedAt: 'desc' }, { slug: 'asc' }];
    case 'price-asc':
      return [{ minPriceUsd: { sort: 'asc', nulls: 'last' } }, { slug: 'asc' }];
    case 'price-desc':
      return [{ minPriceUsd: { sort: 'desc', nulls: 'last' } }, { slug: 'asc' }];
    case 'best-selling':
    default:
      return [{ salesCount: 'desc' }, { slug: 'asc' }];
  }
}

export function cardOrder(
  sort: CatalogQuery['sort'],
): Prisma.ProductCategoryOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ product: { publishedAt: 'desc' } }, { position: 'asc' }];
    case 'best-selling':
      return [{ product: { salesCount: 'desc' } }, { position: 'asc' }];
    case 'price-asc':
      return [{ product: { minPriceUsd: { sort: 'asc', nulls: 'last' } } }, { position: 'asc' }];
    case 'price-desc':
      return [{ product: { minPriceUsd: { sort: 'desc', nulls: 'last' } } }, { position: 'asc' }];
    default:
      return [{ position: 'asc' }];
  }
}
