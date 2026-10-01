import { OrderStatus, type Prisma } from '@da/db';

import { countSale } from './orders.js';
import { type OrderActor, transitionOrder } from './order-status.js';

/**
 * What a refund does to its order, whichever provider reported it.
 *
 * The order moves to REFUNDED or PARTIALLY_REFUNDED, which is enough to stop
 * anything not yet delivered: both delivery paths refuse an order that is not
 * PAID or FULFILLING. A key already sent cannot be recalled from here, so the
 * note says so and names the lines, for somebody to deactivate with the
 * supplier.
 *
 * Conditional, so the sale is given back once however many refund events
 * arrive for the same order. `skip`, because the money has gone back whatever
 * the status can say: a late partial event after the full one must not demote
 * REFUNDED, and must not fail the webhook either.
 *
 * `note: 'on_change'` writes the note only when the order moved — for a
 * provider that reports the same refund twice (the answer to our request, then
 * its webhook). Returns whether the order moved.
 */
export async function recordRefundOutcome(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    fullyRefunded: boolean;
    actor: OrderActor;
    /** e.g. "Refunded in Stripe". */
    label: string;
    /** SKUs already delivered on the order. */
    delivered: string[];
    note: 'always' | 'on_change';
  },
): Promise<boolean> {
  const extent = input.fullyRefunded ? 'full' : 'partial';
  const moved = await transitionOrder(tx, {
    orderId: input.orderId,
    to: input.fullyRefunded ? OrderStatus.REFUNDED : OrderStatus.PARTIALLY_REFUNDED,
    actor: input.actor,
    reason: `${input.label} (${extent})`,
    ifIllegal: 'skip',
  });
  if (input.fullyRefunded && moved) await countSale(tx, input.orderId, -1);
  if (input.note === 'always' || moved) {
    await tx.orderNote.create({
      data: {
        orderId: input.orderId,
        body:
          `${input.label} (${extent}).` +
          (input.delivered.length > 0
            ? ` Already delivered, deactivate with the supplier: ${input.delivered.join(', ')}.`
            : ' Nothing had been delivered.'),
        isCustomerVisible: false,
      },
    });
  }
  return moved;
}
