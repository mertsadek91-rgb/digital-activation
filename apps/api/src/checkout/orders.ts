import { type Prisma, StockMovementReason, StockReservationState } from '@da/db';

/** A transaction handle. Everything here must run inside one. */
type Tx = Prisma.TransactionClient;

/**
 * Order numbering.
 *
 * `DA-2026-00187` — a reference a customer can read over the phone, which a
 * cuid cannot. It has to be gapless enough to look like a sequence and unique
 * without fail, and those two wants pull against each other under concurrency.
 *
 * The resolution: derive the next number from the highest existing one for the
 * year, and let the unique index arbitrate. A collision means someone else got
 * that number first, so the caller retries; that is cheaper and simpler than
 * holding a lock across order creation, and it cannot produce a duplicate
 * because the database refuses one.
 */
export async function nextOrderNumber(tx: Tx, when: Date): Promise<string> {
  const year = when.getUTCFullYear();
  const prefix = `DA-${String(year)}-`;

  const last = await tx.order.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  const previous = last ? Number.parseInt(last.number.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(previous) ? previous + 1 : 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

/**
 * Turns this order's stock holds into a sale.
 *
 * Called once, when payment succeeds. Three things happen together or not at
 * all: the hold becomes CONSUMED, on-hand comes down, and a movement row
 * records why. The ledger is the point — a counter alone cannot answer "where
 * did that key go", and that is the only question worth asking when a licence
 * is missing.
 *
 * Idempotent by construction: only ACTIVE holds are consumed, so a webhook
 * delivered twice finds nothing left to do the second time.
 */
export async function consumeHolds(
  tx: Tx,
  input: { cartId: string | null; orderId: string },
): Promise<{ consumed: number; variants: number }> {
  if (!input.cartId) return { consumed: 0, variants: 0 };

  const holds = await tx.stockReservation.findMany({
    where: { cartId: input.cartId, state: StockReservationState.ACTIVE },
    select: { id: true, variantId: true, qty: true },
  });
  if (holds.length === 0) return { consumed: 0, variants: 0 };

  for (const held of holds) {
    await tx.stockReservation.update({
      where: { id: held.id },
      data: { state: StockReservationState.CONSUMED },
    });

    await tx.inventoryLevel.update({
      where: { variantId: held.variantId },
      data: {
        onHand: { decrement: held.qty },
        // The hold is leaving `reserved` at the same moment it leaves
        // `onHand`; letting only one of them move is how a variant ends up
        // permanently unsellable.
        reserved: { decrement: held.qty },
      },
    });

    await tx.stockMovement.create({
      data: {
        variantId: held.variantId,
        delta: -held.qty,
        reason: StockMovementReason.SALE,
        orderId: input.orderId,
        note: null,
      },
    });
  }

  return {
    consumed: holds.reduce((total, held) => total + held.qty, 0),
    variants: new Set(holds.map((held) => held.variantId)).size,
  };
}
