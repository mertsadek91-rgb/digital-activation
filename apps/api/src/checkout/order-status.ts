import { ConflictException } from '@nestjs/common';

import { type OrderEventActor, OrderStatus, type Prisma } from '@da/db';

import { say } from '../common/panel-locale.js';

/** A transaction handle. The status write and its event must share one. */
type Tx = Prisma.TransactionClient;

export interface OrderActor {
  type: OrderEventActor;
  /** A staff id for STAFF; the provider's reference for PROVIDER. */
  id?: string | null | undefined;
}

/**
 * Every status an order may move to from each status it can be in.
 *
 * Written out rather than implied by whichever code path happens to run,
 * because the paths that move an order are many (two webhooks, three sweeps,
 * the delivery pipeline, four panel actions) and the guarantees they rely on
 * are shared: a refunded order is never delivered again, a cancelled draft is
 * never paid, a fully refunded order is never demoted to "partially" by a
 * late event. Each of those used to be one `update` away from being broken.
 *
 * Derived from the code, not from a diagram:
 *  - PENDING_PAYMENT: `markPaid` (PAID, or PAYMENT_REVIEW when a rule holds
 *    it), the draft expiry sweep (CANCELLED). FAILED is in the enum and kept
 *    reachable for a provider that reports a terminal failure.
 *  - PAYMENT_REVIEW: releasing the hold (PAID); a refund from the panel or
 *    Stripe (REFUNDED, or PARTIALLY_REFUNDED); CANCELLED for a held order
 *    somebody decides not to take.
 *  - PAID / FULFILLING / FULFILLED: the delivery pipeline derives FULFILLING
 *    and FULFILLED from the lines; refunds go either way.
 *  - COMPLETED is refundable (the panel lists it), and nothing walks back
 *    from it to FULFILLED — a re-delivery on a completed order leaves it be.
 *  - PARTIALLY_REFUNDED can only become REFUNDED.
 *  - REFUNDED, CANCELLED and FAILED are terminal.
 *
 * Moving to the status an order is already in is not a transition at all:
 * it is a no-op and writes nothing, which is what a replayed webhook needs.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.PENDING_PAYMENT]: [
    OrderStatus.PAID,
    OrderStatus.PAYMENT_REVIEW,
    OrderStatus.CANCELLED,
    OrderStatus.FAILED,
  ],
  [OrderStatus.PAYMENT_REVIEW]: [
    OrderStatus.PAID,
    OrderStatus.REFUNDED,
    OrderStatus.PARTIALLY_REFUNDED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PAID]: [
    OrderStatus.FULFILLING,
    OrderStatus.FULFILLED,
    OrderStatus.REFUNDED,
    OrderStatus.PARTIALLY_REFUNDED,
  ],
  [OrderStatus.FULFILLING]: [
    OrderStatus.FULFILLED,
    OrderStatus.REFUNDED,
    OrderStatus.PARTIALLY_REFUNDED,
  ],
  [OrderStatus.FULFILLED]: [
    OrderStatus.COMPLETED,
    OrderStatus.REFUNDED,
    OrderStatus.PARTIALLY_REFUNDED,
  ],
  [OrderStatus.COMPLETED]: [OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED],
  [OrderStatus.PARTIALLY_REFUNDED]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.FAILED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

function refuse(from: OrderStatus, to: OrderStatus): never {
  throw new ConflictException(
    say(`لا يمكن نقل الطلب من ${from} إلى ${to}.`, `An order cannot move from ${from} to ${to}.`),
  );
}

/**
 * Writes the history row for a status change the caller has already made.
 *
 * For `markPaid`, whose compare-and-set carries more than the status (the
 * paid time, the risk level) and is the idempotence guarantee for payment
 * webhooks; it stays the caller's, and this runs only once it has succeeded.
 */
export async function recordOrderTransition(
  tx: Tx,
  input: {
    orderId: string;
    from: OrderStatus;
    to: OrderStatus;
    actor: OrderActor;
    reason?: string | null | undefined;
  },
): Promise<void> {
  if (input.from === input.to) return;
  if (!canTransition(input.from, input.to)) refuse(input.from, input.to);
  await tx.orderStatusEvent.create({
    data: {
      orderId: input.orderId,
      from: input.from,
      to: input.to,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      reason: input.reason ?? null,
    },
  });
}

/**
 * Moves an order, if the move is allowed, and records who moved it.
 *
 * The write is a compare-and-set on `from` (read first when not given), so two
 * callers racing on one order move it once and the loser gets `false` — the
 * same guarantee the ad-hoc `updateMany`s this replaced each gave on their
 * own. Returns true only when this call changed the status.
 *
 * `ifIllegal: 'skip'` is for facts reported from outside: a Stripe refund
 * has happened whether or not the order's status can reflect it, and
 * throwing there would roll back the refund row and make Stripe retry an
 * event that can never succeed. The panel's own actions keep the default and
 * refuse.
 */
export async function transitionOrder(
  tx: Tx,
  input: {
    orderId: string;
    from?: OrderStatus;
    to: OrderStatus;
    actor: OrderActor;
    reason?: string | null | undefined;
    /** Written alongside the status, e.g. `fulfilledAt`. */
    data?: Omit<Prisma.OrderUpdateManyMutationInput, 'status'>;
    ifIllegal?: 'throw' | 'skip';
  },
): Promise<boolean> {
  const from =
    input.from ??
    (
      await tx.order.findUniqueOrThrow({
        where: { id: input.orderId },
        select: { status: true },
      })
    ).status;
  if (from === input.to) return false;
  if (!canTransition(from, input.to)) {
    if (input.ifIllegal === 'skip') return false;
    refuse(from, input.to);
  }

  const moved = await tx.order.updateMany({
    where: { id: input.orderId, status: from },
    data: { ...input.data, status: input.to },
  });
  if (moved.count !== 1) return false;

  await recordOrderTransition(tx, {
    orderId: input.orderId,
    from,
    to: input.to,
    actor: input.actor,
    reason: input.reason,
  });
  return true;
}
