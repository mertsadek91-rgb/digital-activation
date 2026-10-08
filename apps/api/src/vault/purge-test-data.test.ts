import { KeyAccessAction, LicenseKeyState, StockMovementReason, type PrismaClient } from '@da/db';
import { describe, expect, it } from 'vitest';

import {
  REVOKE_REASON,
  TEST_DATA_CEILING,
  parseExpected,
  purgeTestData,
  refusal,
} from './purge-test-data.js';

/**
 * The test-data purge (owner decision 2026-10-08). Both databases are fakes
 * that keep just enough state — orders, customers, keys, stock — and record
 * every write, so the tests can say what was written and in which order, and
 * that a report or a refused run wrote nothing.
 */
interface FakeKey {
  id: string;
  variantId: string;
  state: LicenseKeyState;
  revokedReason: string | null;
}

function build(options?: {
  orders?: number;
  customers?: number;
  /** Orders that arrive between the report and the transaction. */
  ordersInsideTransaction?: number;
  /** A cart in checkout holds this many of v-stock. */
  reserved?: number;
  keys?: FakeKey[];
  /** The vault step throws: the run stops after the app database. */
  vaultFails?: boolean;
}) {
  const writes: string[] = [];
  const state = {
    orders: options?.orders ?? 8,
    customers: options?.customers ?? 6,
  };
  const keys: FakeKey[] = options?.keys ?? [
    { id: 'k1', variantId: 'v-stock', state: LicenseKeyState.AVAILABLE, revokedReason: null },
    { id: 'k2', variantId: 'v-stock', state: LicenseKeyState.AVAILABLE, revokedReason: null },
    { id: 'k3', variantId: 'v-sold', state: LicenseKeyState.DELIVERED, revokedReason: null },
  ];
  const levels: Record<string, { onHand: number; reserved: number }> = {
    'v-stock': { onHand: 2, reserved: options?.reserved ?? 0 },
    'v-sold': { onHand: 0, reserved: 0 },
  };
  const live = (key: FakeKey) => key.state !== LicenseKeyState.REVOKED;

  const appTx = {
    order: {
      count: () => Promise.resolve(options?.ordersInsideTransaction ?? state.orders),
      findMany: () =>
        Promise.resolve([
          { id: 'o1', number: 'DA-2026-00001' },
          { id: 'o2', number: 'DA-DEMO-00001' },
        ]),
      deleteMany: () => {
        writes.push('orders');
        state.orders = 0;
        return Promise.resolve({ count: 8 });
      },
    },
    customer: {
      count: () => Promise.resolve(state.customers),
      findMany: () => Promise.resolve([{ id: 'c1' }]),
      deleteMany: () => {
        writes.push('customers');
        state.customers = 0;
        return Promise.resolve({ count: 6 });
      },
    },
    promotion: {
      findMany: () => Promise.resolve([{ id: 'personal-code' }]),
      updateMany: (input: { where: { id?: { in: string[] } }; data: { isActive?: boolean } }) => {
        if (input.data.isActive === false) writes.push(`retire ${String(input.where.id?.in)}`);
        return Promise.resolve({ count: 1 });
      },
      update: (input: { where: { id: string }; data: { usageCount: { decrement: number } } }) => {
        writes.push(`give back ${input.where.id} ${String(input.data.usageCount.decrement)}`);
        return Promise.resolve({});
      },
    },
    promotionUsage: {
      groupBy: () =>
        Promise.resolve([
          { promotionId: 'shared-code', _count: { _all: 1 } },
          { promotionId: 'personal-code', _count: { _all: 1 } },
        ]),
    },
    notificationLog: {
      deleteMany: (input: { where: { OR?: unknown[]; customerId?: unknown } }) => {
        writes.push(
          input.where.OR
            ? `mail log by order ${String(input.where.OR.length)}`
            : 'mail log by customer',
        );
        return Promise.resolve({ count: 1 });
      },
    },
    review: {
      findMany: () => Promise.resolve([{ productId: 'product-1' }]),
      aggregate: () => Promise.resolve({ _avg: { rating: null }, _count: { _all: 0 } }),
    },
    refund: { deleteMany: () => (writes.push('refunds'), Promise.resolve({ count: 0 })) },
    payment: { deleteMany: () => (writes.push('payments'), Promise.resolve({ count: 5 })) },
    renewalReminder: {
      deleteMany: () => (writes.push('reminders'), Promise.resolve({ count: 0 })),
    },
    product: {
      update: (input: { data: { ratingCount: number } }) => {
        writes.push(`rating ${String(input.data.ratingCount)}`);
        return Promise.resolve({});
      },
    },
    inventoryLevel: {
      findUnique: ({ where }: { where: { variantId: string } }) =>
        Promise.resolve(levels[where.variantId] ? { ...levels[where.variantId] } : null),
      update: ({ where, data }: { where: { variantId: string }; data: { onHand: number } }) => {
        const level = levels[where.variantId];
        if (!level) throw new Error('no level');
        // The database's CHECK ("reserved" <= "onHand").
        if (data.onHand < level.reserved) throw new Error('reserved <= onHand violated');
        level.onHand = data.onHand;
        writes.push(`onHand ${where.variantId} ${String(data.onHand)}`);
        return Promise.resolve({});
      },
    },
    stockMovement: {
      create: (input: { data: { delta: number; reason: StockMovementReason } }) => {
        writes.push(`movement ${String(input.data.delta)} ${input.data.reason}`);
        return Promise.resolve({});
      },
    },
  };
  const app = {
    order: { count: () => Promise.resolve(state.orders) },
    customer: { count: () => Promise.resolve(state.customers) },
    payment: { count: () => Promise.resolve(5) },
    refund: { count: () => Promise.resolve(0) },
    orderItem: { count: () => Promise.resolve(18) },
    review: { count: () => Promise.resolve(6) },
    $transaction: (run: (client: typeof appTx) => Promise<unknown>) => run(appTx),
  } as unknown as PrismaClient;

  const accessLog: { licenseKeyId: string; action: KeyAccessAction }[] = [];
  const vaultTx = {
    keyAccessLog: {
      createMany: ({ data }: { data: { licenseKeyId: string; action: KeyAccessAction }[] }) => {
        if (options?.vaultFails) throw new Error('vault unreachable');
        accessLog.push(...data);
        writes.push(`access log ${String(data.length)}`);
        return Promise.resolve({ count: data.length });
      },
    },
    licenseKey: {
      updateMany: ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: { revokedReason: string };
      }) => {
        let count = 0;
        for (const key of keys) {
          if (where.id.in.includes(key.id) && live(key)) {
            key.state = LicenseKeyState.REVOKED;
            key.revokedReason = data.revokedReason;
            count += 1;
          }
        }
        writes.push(`revoke ${String(count)}`);
        return Promise.resolve({ count });
      },
    },
  };
  const vault = {
    licenseKey: {
      findMany: ({ where }: { where: { state?: unknown; revokedReason?: string } }) => {
        if (where.revokedReason) {
          const variants = [
            ...new Set(
              keys.filter((k) => k.revokedReason === where.revokedReason).map((k) => k.variantId),
            ),
          ];
          return Promise.resolve(variants.map((variantId) => ({ variantId })));
        }
        return Promise.resolve(keys.filter(live).map((k) => ({ id: k.id, state: k.state })));
      },
      groupBy: () => {
        const counts = new Map<string, number>();
        for (const key of keys) {
          if (key.state === LicenseKeyState.AVAILABLE) {
            counts.set(key.variantId, (counts.get(key.variantId) ?? 0) + 1);
          }
        }
        return Promise.resolve([...counts].map(([variantId, _count]) => ({ variantId, _count })));
      },
    },
    $transaction: (run: (client: typeof vaultTx) => Promise<unknown>) => run(vaultTx),
  } as unknown as PrismaClient;

  return { app, vault, writes, keys, levels, accessLog };
}

const exact = { orders: 8, customers: 6, keys: 3 };

describe('the test-data purge', () => {
  it('reports without writing anything, keys broken down by state', async () => {
    const world = build();
    const report = await purgeTestData({ ...world, apply: false, expected: null });

    expect(report).toMatchObject({
      orders: 8,
      customers: 6,
      keys: 3,
      payments: 5,
      orderLines: 18,
      reviews: 6,
      keysByState: { AVAILABLE: 2, DELIVERED: 1 },
      applied: false,
    });
    expect(world.writes).toEqual([]);
  });

  it('refuses to write without the counts, or when they no longer match', async () => {
    const blind = build();
    await expect(purgeTestData({ ...blind, apply: true, expected: null })).rejects.toThrow(
      /needs the counts/,
    );
    const changed = build();
    await expect(
      purgeTestData({ ...changed, apply: true, expected: { ...exact, orders: 7 } }),
    ).rejects.toThrow(/orders: expected 7, found 8/);
    expect([...blind.writes, ...changed.writes]).toEqual([]);
  });

  it('counts again inside the transaction: an order that arrived meanwhile stops it', async () => {
    const world = build({ ordersInsideTransaction: 9 });
    await expect(purgeTestData({ ...world, apply: true, expected: exact })).rejects.toThrow(
      /changed while the purge started/,
    );
    expect(world.writes).toEqual([]);
  });

  it('refuses a database that is trading, whatever counts it is told', async () => {
    const big = build({ orders: TEST_DATA_CEILING + 1 });
    await expect(
      purgeTestData({ ...big, apply: true, expected: { ...exact, orders: TEST_DATA_CEILING + 1 } }),
    ).rejects.toThrow(/trading, not testing/);
    expect(big.writes).toEqual([]);
  });

  it('retires personal coupons, clears the mail log, deletes payments before orders, revokes and recounts', async () => {
    const world = build();
    const report = await purgeTestData({ ...world, apply: true, expected: exact });

    expect(report.applied).toBe(true);
    expect(world.writes).toEqual([
      'retire personal-code',
      // Only the shared code gets its use back; the personal one is retired.
      'give back shared-code 1',
      'mail log by order 2',
      'mail log by customer',
      'refunds',
      'payments',
      'orders',
      'reminders',
      'rating 0',
      'customers',
      'access log 3',
      'revoke 3',
      'onHand v-stock 0',
      `movement -2 ${StockMovementReason.REVOKED}`,
    ]);
    // Revoked, never deleted; the reason on the row and a REVOKE log per key.
    expect(world.keys.every((k) => k.state === LicenseKeyState.REVOKED)).toBe(true);
    expect(world.keys.every((k) => k.revokedReason === REVOKE_REASON)).toBe(true);
    expect(world.accessLog.map((row) => row.action)).toEqual([
      KeyAccessAction.REVOKE,
      KeyAccessAction.REVOKE,
      KeyAccessAction.REVOKE,
    ]);
    expect(report.stock).toEqual({ 'v-stock': { from: 2, to: 0 } });
  });

  it('never takes onHand below what a cart in checkout holds', async () => {
    const world = build({ reserved: 1 });
    await purgeTestData({ ...world, apply: true, expected: exact });
    expect(world.levels['v-stock']).toEqual({ onHand: 1, reserved: 1 });
  });

  it('finishes the recount on a second run after the first stopped before the vault', async () => {
    const world = build({ vaultFails: true });
    await expect(purgeTestData({ ...world, apply: true, expected: exact })).rejects.toThrow(
      /vault unreachable/,
    );
    expect(world.levels['v-stock']?.onHand).toBe(2);

    // The app database is empty now; the keys are still live.
    const retry = { ...world, vault: build({ keys: world.keys }).vault };
    const report = await purgeTestData({
      ...retry,
      apply: true,
      expected: { orders: 0, customers: 0, keys: 3 },
    });
    expect(report.applied).toBe(true);
    expect(world.keys.every((k) => k.state === LicenseKeyState.REVOKED)).toBe(true);
    expect(world.levels['v-stock']?.onHand).toBe(0);
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
