import { FulfillmentMode, type Prisma, StockMovementReason, StockReservationState } from '@da/db';

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
 * year, with the caller holding `lockOrderNumbers` for the rest of its
 * transaction. The unique index is still there as the backstop, but it is no
 * longer the mechanism — a unique violation aborts a Postgres transaction, so
 * "catch it and read again" inside one could never have worked.
 */
export async function lockOrderNumbers(tx: Tx): Promise<void> {
  // Transaction-scoped: released at commit or rollback, so a crashed request
  // cannot leave numbering locked. Held only for the few statements it takes
  // to read the last number and insert the next one.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('da:order-number'))`;
}

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
): Promise<{ consumed: number; variants: number; byVariant: Map<string, number> }> {
  const byVariant = new Map<string, number>();
  if (!input.cartId) return { consumed: 0, variants: 0, byVariant };

  const holds = await tx.stockReservation.findMany({
    where: { cartId: input.cartId, state: StockReservationState.ACTIVE },
    select: { id: true, variantId: true, qty: true },
  });
  if (holds.length === 0) return { consumed: 0, variants: 0, byVariant };

  for (const held of holds) {
    byVariant.set(held.variantId, (byVariant.get(held.variantId) ?? 0) + held.qty);
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
    byVariant,
  };
}

/**
 * Moves each product's `salesCount` by what this order sold.
 *
 * The count behind "sold N times", the best-seller rail and the default sort
 * was written once by the WordPress import and never again, so every sale
 * since was invisible to all three. It is counted when the money arrives
 * (`+1`) and given back when the order is refunded in full (`-1`); a refunded
 * licence was not sold. Guarded on the way down so a count cannot go
 * negative through a refund of an order the import never counted.
 */
export async function countSale(tx: Tx, orderId: string, direction: 1 | -1): Promise<void> {
  const lines = await tx.orderItem.findMany({
    where: { orderId },
    select: { qty: true, variant: { select: { productId: true } } },
  });

  const perProduct = new Map<string, number>();
  for (const line of lines) {
    const id = line.variant.productId;
    perProduct.set(id, (perProduct.get(id) ?? 0) + line.qty);
  }

  for (const [productId, qty] of perProduct) {
    if (direction === 1) {
      await tx.product.update({
        where: { id: productId },
        data: { salesCount: { increment: qty } },
      });
    } else {
      await tx.product.updateMany({
        where: { id: productId, salesCount: { gte: qty } },
        data: { salesCount: { decrement: qty } },
      });
    }
  }
}

/**
 * Records the sale of stock that was paid for without a live hold.
 *
 * A hold expires after its window; a shopper who pays after that still bought
 * the licence, and before this nothing came off `onHand` and no SALE row was
 * written — the counter kept offering a key that had gone. Only stocked
 * variants count here, since a made-to-order line has no shelf to take from.
 *
 * Guarded rather than trusted: `onHand` has a CHECK against going negative, and
 * a violation inside the payment transaction would fail the webhook forever.
 * Stock that is not there is left for the fulfilment side, which already sends
 * a short line to the manual queue.
 */
export async function sellUnheld(
  tx: Tx,
  input: { orderId: string; held: Map<string, number> },
): Promise<void> {
  const lines = await tx.orderItem.findMany({
    where: { orderId: input.orderId, variant: { fulfillmentMode: FulfillmentMode.FROM_STOCK } },
    select: { variantId: true, qty: true },
  });

  const wanted = new Map<string, number>();
  for (const line of lines) {
    wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.qty);
  }

  for (const [variantId, qty] of wanted) {
    const remainder = qty - (input.held.get(variantId) ?? 0);
    if (remainder <= 0) continue;

    const { count } = await tx.inventoryLevel.updateMany({
      where: { variantId, onHand: { gte: remainder } },
      data: { onHand: { decrement: remainder } },
    });
    if (count === 0) continue;

    await tx.stockMovement.create({
      data: {
        variantId,
        delta: -remainder,
        reason: StockMovementReason.SALE,
        orderId: input.orderId,
        note: 'Paid after the stock hold had expired.',
      },
    });
  }
}
