import { LicenseKeyState, StockMovementReason, type PrismaClient } from '@da/db';
import { describe, expect, it } from 'vitest';

import {
  REVOKE_REASON,
  TEST_DATA_CEILING,
  parseExpected,
  purgeTestData,
  refusal,
} from './purge-test-data.js';

/**
 * The test-data purge (owner decision 2026-10-08). The two databases are
 * fakes that record every write, so the tests can say what was written, in
 * which order, and — for a report or a refused run — that nothing was.
 */
function build(options?: { orders?: number; customers?: number }) {
  const writes: string[] = [];
  const keys = [
    { id: 'k1', variantId: 'v-stock', state: LicenseKeyState.AVAILABLE },
    { id: 'k2', variantId: 'v-stock', state: LicenseKeyState.RESERVED },
    { id: 'k3', variantId: 'v-sold', state: LicenseKeyState.DELIVERED },
  ];
  const level = { onHand: 5 };
  const tx = {
    promotionUsage: {
      groupBy: () => Promise.resolve([{ promotionId: 'promo-1', _count: { _all: 1 } }]),
    },
    review: {
      findMany: () => Promise.resolve([{ productId: 'product-1' }]),
      aggregate: () => Promise.resolve({ _avg: { rating: null }, _count: { _all: 0 } }),
    },
    refund: { deleteMany: () => (writes.push('refunds'), Promise.resolve({ count: 0 })) },
    payment: { deleteMany: () => (writes.push('payments'), Promise.resolve({ count: 5 })) },
    order: { deleteMany: () => (writes.push('orders'), Promise.resolve({ count: 8 })) },
    customer: { deleteMany: () => (writes.push('customers'), Promise.resolve({ count: 6 })) },
    promotion: {
      update: (input: { data: { usageCount: { decrement: number } } }) => {
        writes.push(`promotion -${String(input.data.usageCount.decrement)}`);
        return Promise.resolve({});
      },
      updateMany: () => Promise.resolve({ count: 0 }),
    },
    product: {
      update: (input: { data: { ratingCount: number } }) => {
        writes.push(`rating ${String(input.data.ratingCount)}`);
        return Promise.resolve({});
      },
    },
    inventoryLevel: {
      findUnique: () => Promise.resolve({ ...level }),
      update: (input: { data: { onHand: number } }) => {
        writes.push(`onHand ${String(input.data.onHand)}`);
        return Promise.resolve({});
      },
    },
    stockMovement: {
      create: (input: { data: { delta: number; reason: StockMovementReason; note: string } }) => {
        writes.push(`movement ${String(input.data.delta)} ${input.data.reason}`);
        return Promise.resolve({});
      },
    },
  };
  const app = {
    order: { count: () => Promise.resolve(options?.orders ?? 8) },
    customer: { count: () => Promise.resolve(options?.customers ?? 6) },
    payment: { count: () => Promise.resolve(5) },
    refund: { count: () => Promise.resolve(0) },
    orderItem: { count: () => Promise.resolve(18) },
    review: { count: () => Promise.resolve(6) },
    $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
  } as unknown as PrismaClient;
  const revoked: { ids: string[]; reason: string }[] = [];
  const vault = {
    licenseKey: {
      findMany: () => Promise.resolve(keys),
      updateMany: (input: {
        where: { id: { in: string[] } };
        data: { state: LicenseKeyState; revokedReason: string };
      }) => {
        writes.push(`revoke ${String(input.where.id.in.length)}`);
        revoked.push({ ids: input.where.id.in, reason: input.data.revokedReason });
        return Promise.resolve({ count: input.where.id.in.length });
      },
    },
  } as unknown as PrismaClient;
  return { app, vault, writes, revoked };
}

const exact = { orders: 8, customers: 6, keys: 3 };

describe('the test-data purge', () => {
  it('reports without writing anything', async () => {
    const world = build();
    const report = await purgeTestData({ ...world, apply: false, expected: null });

    expect(report).toMatchObject({
      orders: 8,
      customers: 6,
      keys: 3,
      payments: 5,
      orderLines: 18,
      reviews: 6,
      stockTaken: { 'v-stock': 2 },
      applied: false,
    });
    expect(world.writes).toEqual([]);
  });

  it('refuses to write without the counts, or when they no longer match', async () => {
    const blind = build();
    await expect(purgeTestData({ ...blind, apply: true, expected: null })).rejects.toThrow(
      /needs the counts/,
    );
    expect(blind.writes).toEqual([]);

    const changed = build();
    await expect(
      purgeTestData({ ...changed, apply: true, expected: { ...exact, orders: 7 } }),
    ).rejects.toThrow(/orders: expected 7, found 8/);
    expect(changed.writes).toEqual([]);
  });

  it('refuses a database that is trading, whatever counts it is told', async () => {
    const big = build({ orders: TEST_DATA_CEILING + 1 });
    await expect(
      purgeTestData({ ...big, apply: true, expected: { ...exact, orders: TEST_DATA_CEILING + 1 } }),
    ).rejects.toThrow(/trading, not testing/);
    expect(big.writes).toEqual([]);
  });

  it('removes payments before orders, revokes every key and takes the stock off', async () => {
    const world = build();
    const report = await purgeTestData({ ...world, apply: true, expected: exact });

    expect(report.applied).toBe(true);
    expect(world.writes).toEqual([
      'refunds',
      'payments',
      'orders',
      'promotion -1',
      'rating 0',
      'customers',
      'revoke 3',
      'onHand 3',
      `movement -2 ${StockMovementReason.REVOKED}`,
    ]);
    // Revoked, never deleted, and with the reason on the row.
    expect(world.revoked).toEqual([{ ids: ['k1', 'k2', 'k3'], reason: REVOKE_REASON }]);
  });
});

describe('refusal', () => {
  it('lets an exact match through', () => {
    expect(refusal(exact, exact)).toBeNull();
  });
});

describe('parseExpected', () => {
  it('reads all three counts', () => {
    expect(
      parseExpected([
        '--apply',
        '--expect-orders',
        '8',
        '--expect-customers',
        '6',
        '--expect-keys',
        '3',
      ]),
    ).toEqual(exact);
  });

  it('is null when none is given, and refuses half a set or a bad number', () => {
    expect(parseExpected(['--apply'])).toBeNull();
    expect(() => parseExpected(['--expect-orders', '8'])).toThrow(/all three/);
    expect(() =>
      parseExpected(['--expect-orders', 'x', '--expect-customers', '6', '--expect-keys', '3']),
    ).toThrow(/whole number/);
  });
});
