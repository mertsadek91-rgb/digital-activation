import { describe, expect, it, vi } from 'vitest';

import { OrderStatus } from '@da/db';

import {
  ORDER_TRANSITIONS,
  canTransition,
  recordOrderTransition,
  transitionOrder,
} from './order-status.js';

const S = OrderStatus;

/**
 * Guards the order state machine.
 *
 * Each case is a promise some other part of the store leans on: delivery
 * refuses anything not PAID or FULFILLING, so a refunded order that could
 * walk back to PAID would deliver a key for money that has gone back.
 */
describe('ORDER_TRANSITIONS', () => {
  it('covers every status', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual(Object.values(S).sort());
  });

  it('lets payment land, be held, or the draft expire', () => {
    expect(canTransition(S.PENDING_PAYMENT, S.PAID)).toBe(true);
    expect(canTransition(S.PENDING_PAYMENT, S.PAYMENT_REVIEW)).toBe(true);
    expect(canTransition(S.PENDING_PAYMENT, S.CANCELLED)).toBe(true);
    expect(canTransition(S.PENDING_PAYMENT, S.FAILED)).toBe(true);
  });

  it('never delivers an unpaid order', () => {
    expect(canTransition(S.PENDING_PAYMENT, S.FULFILLING)).toBe(false);
    expect(canTransition(S.PENDING_PAYMENT, S.FULFILLED)).toBe(false);
    expect(canTransition(S.PAYMENT_REVIEW, S.FULFILLED)).toBe(false);
  });

  it('releases a held order only to PAID, or refunds or cancels it', () => {
    expect(ORDER_TRANSITIONS[S.PAYMENT_REVIEW]).toEqual(
      expect.arrayContaining([S.PAID, S.REFUNDED, S.CANCELLED]),
    );
  });

  it('refunds from every state the panel calls refundable', () => {
    for (const from of [
      S.PAID,
      S.PAYMENT_REVIEW,
      S.FULFILLING,
      S.FULFILLED,
      S.COMPLETED,
      S.PARTIALLY_REFUNDED,
    ]) {
      expect(canTransition(from, S.REFUNDED)).toBe(true);
    }
  });

  it('never demotes a full refund to a partial one', () => {
    expect(canTransition(S.REFUNDED, S.PARTIALLY_REFUNDED)).toBe(false);
    expect(canTransition(S.PARTIALLY_REFUNDED, S.REFUNDED)).toBe(true);
  });

  it('keeps terminal states terminal', () => {
    for (const from of [S.REFUNDED, S.CANCELLED, S.FAILED]) {
      expect(ORDER_TRANSITIONS[from]).toEqual([]);
    }
  });

  it('does not walk a completed order back to fulfilled', () => {
    expect(canTransition(S.COMPLETED, S.FULFILLED)).toBe(false);
    expect(canTransition(S.FULFILLED, S.FULFILLING)).toBe(false);
  });

  it('does not pay a cancelled draft', () => {
    expect(canTransition(S.CANCELLED, S.PAID)).toBe(false);
  });
});

function fakeTx(status: OrderStatus, updated = 1) {
  const create = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: updated });
  const findUniqueOrThrow = vi.fn().mockResolvedValue({ status });
  const tx = {
    order: { updateMany, findUniqueOrThrow },
    orderStatusEvent: { create },
  } as unknown as Parameters<typeof transitionOrder>[0];
  return { tx, create, updateMany };
}

describe('transitionOrder', () => {
  it('moves with a compare-and-set and records the event', async () => {
    const { tx, create, updateMany } = fakeTx(S.PAID);
    const moved = await transitionOrder(tx, {
      orderId: 'o1',
      to: S.FULFILLED,
      actor: { type: 'SYSTEM' },
    });
    expect(moved).toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'o1', status: S.PAID },
      data: { status: S.FULFILLED },
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('writes nothing when the status is already the target', async () => {
    const { tx, create, updateMany } = fakeTx(S.REFUNDED);
    expect(
      await transitionOrder(tx, { orderId: 'o1', to: S.REFUNDED, actor: { type: 'PROVIDER' } }),
    ).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('writes no event when it loses the race', async () => {
    const { tx, create } = fakeTx(S.PENDING_PAYMENT, 0);
    expect(
      await transitionOrder(tx, {
        orderId: 'o1',
        from: S.PENDING_PAYMENT,
        to: S.CANCELLED,
        actor: { type: 'SYSTEM' },
      }),
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an illegal move, or skips it when asked', async () => {
    const { tx, updateMany } = fakeTx(S.REFUNDED);
    await expect(
      transitionOrder(tx, { orderId: 'o1', to: S.PARTIALLY_REFUNDED, actor: { type: 'PROVIDER' } }),
    ).rejects.toThrow();
    expect(
      await transitionOrder(tx, {
        orderId: 'o1',
        to: S.PARTIALLY_REFUNDED,
        actor: { type: 'PROVIDER' },
        ifIllegal: 'skip',
      }),
    ).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('recordOrderTransition validates without writing the order', async () => {
    const { tx, create, updateMany } = fakeTx(S.PENDING_PAYMENT);
    await recordOrderTransition(tx, {
      orderId: 'o1',
      from: S.PENDING_PAYMENT,
      to: S.PAYMENT_REVIEW,
      actor: { type: 'STAFF', id: 'staff1' },
      reason: 'risk',
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      data: {
        orderId: 'o1',
        from: S.PENDING_PAYMENT,
        to: S.PAYMENT_REVIEW,
        actorType: 'STAFF',
        actorId: 'staff1',
        reason: 'risk',
      },
    });
  });
});
