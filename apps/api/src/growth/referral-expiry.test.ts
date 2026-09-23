import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service.js';

import { EXPIRED_REASON, ReferralExpiryService } from './referral-expiry.service.js';

function fake(moved: number) {
  const tx = {
    referralRedemption: { updateMany: vi.fn().mockResolvedValue({ count: moved }) },
    promotion: { update: vi.fn().mockResolvedValue({}) },
    cart: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const client = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
    referralRedemption: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 'r1', cartId: 'c1', promotionId: 'p1', promotion: { code: 'RF-AAAA' } },
        ]),
    },
    $transaction: vi.fn((run: (t: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const service = new ReferralExpiryService({ client } as unknown as PrismaService);
  return { service, client, tx };
}

describe('ReferralExpiryService', () => {
  it('voids the row, switches the code off and frees the cart', async () => {
    const { service, client, tx } = fake(1);
    const now = new Date('2026-09-23T05:00:00Z');
    expect(await service.sweep(now)).toEqual({ expired: 1 });

    const where = (
      client.referralRedemption.findMany.mock.calls[0] as
        [{ where: { status: string; createdAt: { lte: Date } } }] | undefined
    )?.[0].where;
    if (!where) throw new Error('findMany was not called');
    expect(where.status).toBe('ISSUED');
    expect(where.createdAt.lte.toISOString()).toBe('2026-08-24T05:00:00.000Z');
    expect(tx.referralRedemption.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'ISSUED' },
      data: { status: 'VOID', voidReason: EXPIRED_REASON, cartId: null },
    });
    expect(tx.promotion.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isActive: false },
    });
    expect(tx.cart.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', couponCode: 'RF-AAAA' },
      data: { couponCode: null },
    });
  });

  it('leaves a row that moved on during the pass', async () => {
    const { service, tx } = fake(0);
    expect(await service.sweep()).toEqual({ expired: 0 });
    expect(tx.promotion.update).not.toHaveBeenCalled();
  });
});
