import { Prisma, PublishStatus } from '../generated/prisma/client.js';

/**
 * `Product.minPriceUsd`, kept honest.
 *
 * The column exists so the storefront can sort by price in SQL; it is only
 * worth having while it agrees with the variants. So there is one way to write
 * it — recompute from the rows, never patch it from whatever the caller just
 * changed — and every path that changes a variant's price or status calls this
 * afterwards, inside the same transaction where there is one. A caller that
 * computed "the new minimum" from its own edit would be wrong the first time a
 * cheaper sibling was unpublished in another request.
 *
 * Structural rather than `PrismaClient` so it takes a transaction client, the
 * plain client or a test double alike.
 */
export interface ProductPriceWriter {
  variant: {
    findMany(args: {
      where: { productId: string; status: PublishStatus };
      select: { priceUsd: true };
    }): Promise<{ priceUsd: Prisma.Decimal }[]>;
  };
  product: {
    update(args: {
      where: { id: string };
      data: { minPriceUsd: Prisma.Decimal | null };
    }): Promise<unknown>;
  };
}

/**
 * The cheapest of a set of prices, or null for none.
 *
 * Only published variants count: a draft variant has a price nobody can pay,
 * and letting it into the minimum would sort a product by a number its page
 * never shows.
 */
export function minPublishedPrice(
  variants: readonly { priceUsd: Prisma.Decimal; status: PublishStatus }[],
): Prisma.Decimal | null {
  let min: Prisma.Decimal | null = null;
  for (const variant of variants) {
    if (variant.status !== PublishStatus.PUBLISHED) continue;
    if (min === null || variant.priceUsd.lessThan(min)) min = variant.priceUsd;
  }
  return min;
}

/** Recomputes and stores one product's `minPriceUsd`. Returns what it stored. */
export async function refreshProductPrice(
  tx: ProductPriceWriter,
  productId: string,
): Promise<Prisma.Decimal | null> {
  const rows = await tx.variant.findMany({
    where: { productId, status: PublishStatus.PUBLISHED },
    select: { priceUsd: true },
  });
  const min = minPublishedPrice(
    rows.map((row) => ({ priceUsd: row.priceUsd, status: PublishStatus.PUBLISHED })),
  );
  await tx.product.update({ where: { id: productId }, data: { minPriceUsd: min } });
  return min;
}
