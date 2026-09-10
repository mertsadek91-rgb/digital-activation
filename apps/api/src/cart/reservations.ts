import { type Prisma, StockReservationState } from '@da/db';

/**
 * Stock holds.
 *
 * These are single-use licence keys. Two shoppers paying for the last one is
 * not an inventory discrepancy to reconcile later — it is a refund, an apology
 * and a customer who does not come back. So the cart holds stock rather than
 * hoping, and this file is where that hold is made correct.
 *
 * Three rules, each earning its cost:
 *
 *  1. Every read-then-write takes `SELECT … FOR UPDATE` on the inventory row
 *     first. Without it two concurrent adds both see one key left and both
 *     succeed; the check constraint would then reject the second write, which
 *     turns a race into a 500 instead of an honest "only one left".
 *
 *  2. `InventoryLevel.reserved` is recomputed from the reservation rows rather
 *     than incremented. It is a cache of a sum, and a cache that is added to
 *     drifts — after an expiry sweep, a cancelled order, a crashed request.
 *     Recomputing is self-healing and, on a catalog this size, free.
 *
 *  3. Expired reservations are swept before anything is counted, so a lapsed
 *     hold never keeps a sellable key off the shelf.
 */

/** A Prisma client or a transaction handle — the lock needs the transaction. */
export type Tx = Prisma.TransactionClient;

export interface Hold {
  granted: number;
  requested: number;
  availableAfter: number;
}

/**
 * Releases holds whose time is up, for one variant.
 *
 * Called inside the same transaction as the count that follows it, so nothing
 * can expire between the sweep and the decision.
 */
export async function sweepExpired(tx: Tx, variantId: string): Promise<number> {
  const { count } = await tx.stockReservation.updateMany({
    where: {
      variantId,
      state: StockReservationState.ACTIVE,
      expiresAt: { lte: new Date() },
    },
    data: { state: StockReservationState.EXPIRED },
  });
  return count;
}

/** Sums the active holds on a variant. The truth behind `reserved`. */
async function activeReserved(tx: Tx, variantId: string): Promise<number> {
  const result = await tx.stockReservation.aggregate({
    where: { variantId, state: StockReservationState.ACTIVE },
    _sum: { qty: true },
  });
  return result._sum.qty ?? 0;
}

/**
 * Locks the inventory row for the rest of the transaction.
 *
 * Returns on-hand. A variant with no inventory row has no stock rather than
 * infinite stock — the difference matters, because the second reading would
 * let every unstocked product be bought.
 */
async function lockInventory(tx: Tx, variantId: string): Promise<number | null> {
  const rows = await tx.$queryRaw<{ onHand: number }[]>`
    SELECT "onHand" FROM "public"."InventoryLevel"
    WHERE "variantId" = ${variantId}
    FOR UPDATE
  `;
  return rows[0]?.onHand ?? null;
}

/** Writes `reserved` back from the reservation rows. */
async function syncReserved(tx: Tx, variantId: string): Promise<number> {
  const reserved = await activeReserved(tx, variantId);
  await tx.inventoryLevel.updateMany({ where: { variantId }, data: { reserved } });
  return reserved;
}

/**
 * Moves this cart's hold on one variant to `qty`, granting what stock allows.
 *
 * Returns what was actually granted, which may be less than asked. The caller
 * is expected to say so rather than pretend: a cart that quietly trims a line
 * is worse than one that explains why it could not.
 *
 * `qty` of 0 releases the hold entirely.
 */
export async function hold(
  tx: Tx,
  input: { variantId: string; cartId: string; qty: number; ttlMinutes: number },
): Promise<Hold> {
  const { variantId, cartId, qty, ttlMinutes } = input;

  const onHand = await lockInventory(tx, variantId);
  await sweepExpired(tx, variantId);

  // This cart's own hold does not compete with itself: raising a line from 1
  // to 2 must see the 1 it already holds as available, not as taken.
  const mine = await tx.stockReservation.findFirst({
    where: { variantId, cartId, state: StockReservationState.ACTIVE },
  });
  const reservedByOthers = (await activeReserved(tx, variantId)) - (mine?.qty ?? 0);
  const ceiling = Math.max(0, (onHand ?? 0) - reservedByOthers);
  const granted = Math.min(qty, ceiling);

  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  if (granted === 0) {
    if (mine) {
      await tx.stockReservation.update({
        where: { id: mine.id },
        data: { state: StockReservationState.RELEASED },
      });
    }
  } else if (mine) {
    await tx.stockReservation.update({
      where: { id: mine.id },
      data: { qty: granted, expiresAt },
    });
  } else {
    await tx.stockReservation.create({
      data: { variantId, cartId, qty: granted, expiresAt },
    });
  }

  const reserved = await syncReserved(tx, variantId);

  return {
    granted,
    requested: qty,
    availableAfter: Math.max(0, (onHand ?? 0) - reserved),
  };
}

/**
 * Pushes this cart's holds further out.
 *
 * Any write to the cart renews them, so somebody still shopping never has a
 * hold lapse under them — the clock is there to release abandoned carts, not to
 * hurry a customer who is still choosing.
 */
export async function renew(tx: Tx, cartId: string, ttlMinutes: number): Promise<Date> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
  await tx.stockReservation.updateMany({
    where: { cartId, state: StockReservationState.ACTIVE },
    data: { expiresAt },
  });
  return expiresAt;
}

/**
 * Releases every hold a cart has, and re-syncs the variants it touched.
 *
 * Used when a cart is emptied or closed. Not used when an order is paid: there
 * the hold becomes a sale, which decrements on-hand instead.
 */
export async function releaseAll(tx: Tx, cartId: string): Promise<void> {
  const held = await tx.stockReservation.findMany({
    where: { cartId, state: StockReservationState.ACTIVE },
    select: { variantId: true },
  });

  await tx.stockReservation.updateMany({
    where: { cartId, state: StockReservationState.ACTIVE },
    data: { state: StockReservationState.RELEASED },
  });

  for (const variantId of new Set(held.map((row) => row.variantId))) {
    await syncReserved(tx, variantId);
  }
}
