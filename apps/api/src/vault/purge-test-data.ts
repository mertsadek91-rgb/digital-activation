import {
  ActorType,
  KeyAccessAction,
  LicenseKeyState,
  Prisma,
  ReviewStatus,
  StockMovementReason,
  type PrismaClient,
} from '@da/db';

/**
 * Clears the test data off the one environment before it takes real orders
 * (owner decision 2026-10-08: every order, customer, review and licence key
 * on staging is a test). Run through `purge-test-data-cli.ts`, and before
 * launch stock is imported: every key that is not already revoked is revoked.
 *
 * What it does, in this order:
 *
 *  1. In one app-database transaction, after counting again inside it:
 *     - retires every coupon that belonged to a person — issued to a
 *       customer, single-use, or a referral friend code. Their owner is about
 *       to be deleted, and `issuedTo` is SetNull: left active they would work
 *       for anybody holding the code;
 *     - gives the other coupons back their usages;
 *     - deletes the email log of those orders and customers. Order numbers
 *       count on from the highest one left, so the first real order is
 *       DA-…-00001 again, and the log is matched by order number: kept, it
 *       would skip a real customer's emails as "already sent" and show test
 *       emails on a real order;
 *     - deletes refunds and payments (Restrict on purpose: a real payment
 *       must never go with its order), then the orders — lines, notes, status
 *       history, invoices, coupon usages, review invites and reviews cascade —
 *       and the renewal reminders, which hold plain ids, not relations;
 *     - recomputes the rating of every product that lost a review;
 *     - deletes every customer (sessions, addresses and the rest cascade).
 *  2. In the vault: revokes every licence key that is not already revoked,
 *     with a REVOKE access-log row per key, written first. The vault role has
 *     no DELETE grant, by design, so a key is retired, not erased: REVOKED is
 *     never assigned, sent or shown to a customer again. A test key must not
 *     go back to stock — it could be sold to a real customer.
 *  3. Recounts onHand for every variant with a key this tool revoked, from the
 *     vault — as the fulfilment service's own recount does, and never below
 *     what a cart in checkout holds (`reserved <= onHand` is a constraint).
 *     Chosen from the vault, not from this run, so a run that stopped after
 *     step 2 is finished by the next one.
 *
 * A step that fails leaves the steps before it done and the ones after it
 * untouched; running again picks up what is left (with the counts of the new
 * report).
 *
 * Guards: it refuses to write unless told the exact counts the report shows
 * (so it cannot be run blind, or after real orders arrived), counts again
 * inside the transaction, and refuses outright above TEST_DATA_CEILING
 * orders or customers — a store with that much is trading.
 */

export const TEST_DATA_CEILING = 50;

export const REVOKE_REASON = 'test data purge before launch (owner decision 2026-10-08)';

/** Generous: the database is remote, and every statement is a round trip. */
const TRANSACTION = { timeout: 120_000, maxWait: 10_000 } as const;

export interface PurgeCounts {
  orders: number;
  customers: number;
  keys: number;
}

export interface PurgeReport extends PurgeCounts {
  payments: number;
  refunds: number;
  orderLines: number;
  reviews: number;
  /** Keys to revoke, by state: AVAILABLE ones are stock somebody imported. */
  keysByState: Partial<Record<LicenseKeyState, number>>;
  /** Variants whose onHand was recounted, old → new. Empty in a report. */
  stock: Record<string, { from: number; to: number }>;
  applied: boolean;
}

/** Why a write is refused, or null when it may go ahead. */
export function refusal(found: PurgeCounts, expected: PurgeCounts | null): string | null {
  if (found.orders > TEST_DATA_CEILING || found.customers > TEST_DATA_CEILING) {
    return `More than ${String(TEST_DATA_CEILING)} orders or customers: this database is trading, not testing. Nothing was written.`;
  }
  if (!expected) {
    return 'Writing needs the counts from the report: --expect-orders N --expect-customers N --expect-keys N.';
  }
  const mismatched = (Object.keys(found) as (keyof PurgeCounts)[]).filter(
    (key) => found[key] !== expected[key],
  );
  if (mismatched.length > 0) {
    return `The database changed since the report (${mismatched
      .map((key) => `${key}: expected ${String(expected[key])}, found ${String(found[key])}`)
      .join('; ')}). Nothing was written; run the report again.`;
  }
  return null;
}

/** The --expect-* flags, or null when none is given. Throws on a bad value. */
export function parseExpected(argv: readonly string[]): PurgeCounts | null {
  const read = (flag: string): number | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const value = Number(argv[index + 1]);
    if (!Number.isInteger(value) || value < 0) throw new Error(`${flag} needs a whole number.`);
    return value;
  };
  const orders = read('--expect-orders');
  const customers = read('--expect-customers');
  const keys = read('--expect-keys');
  if (orders === undefined && customers === undefined && keys === undefined) return null;
  if (orders === undefined || customers === undefined || keys === undefined) {
    throw new Error('Give all three: --expect-orders, --expect-customers, --expect-keys.');
  }
  return { orders, customers, keys };
}

const LIVE_KEY_STATES = [
  LicenseKeyState.AVAILABLE,
  LicenseKeyState.RESERVED,
  LicenseKeyState.ASSIGNED,
  LicenseKeyState.DELIVERED,
  LicenseKeyState.EXPIRED,
];

export async function purgeTestData(input: {
  app: PrismaClient;
  vault: PrismaClient;
  apply: boolean;
  expected: PurgeCounts | null;
}): Promise<PurgeReport> {
  const { app, vault } = input;

  const [orders, customers, payments, refunds, orderLines, reviews, keys] = await Promise.all([
    app.order.count(),
    app.customer.count(),
    app.payment.count(),
    app.refund.count(),
    app.orderItem.count(),
    // Every review hangs off an order line (orderItemId is required).
    app.review.count(),
    vault.licenseKey.findMany({
      where: { state: { in: LIVE_KEY_STATES } },
      select: { id: true, state: true },
    }),
  ]);

  const keysByState: PurgeReport['keysByState'] = {};
  for (const key of keys) keysByState[key.state] = (keysByState[key.state] ?? 0) + 1;

  const report: PurgeReport = {
    orders,
    customers,
    keys: keys.length,
    payments,
    refunds,
    orderLines,
    reviews,
    keysByState,
    stock: {},
    applied: false,
  };
  if (!input.apply) return report;

  const refused = refusal({ orders, customers, keys: keys.length }, input.expected);
  if (refused) throw new Error(refused);
  const expected = input.expected as PurgeCounts;

  // 1. The app database, all or nothing.
  await app.$transaction(async (tx) => {
    // Counted again in here: what is deleted is what was agreed to.
    const [ordersNow, customersNow] = await Promise.all([tx.order.count(), tx.customer.count()]);
    if (ordersNow !== expected.orders || customersNow !== expected.customers) {
      throw new Error(
        `The database changed while the purge started (orders ${String(ordersNow)}, customers ${String(customersNow)}). Nothing was written; run the report again.`,
      );
    }

    const numbers = (await tx.order.findMany({ select: { number: true } })).map((o) => o.number);
    const customerIds = (await tx.customer.findMany({ select: { id: true } })).map((c) => c.id);

    // Personal coupons stop working before their owners go.
    const personal = await tx.promotion.findMany({
      where: {
        OR: [
          { issuedToId: { not: null } },
          { singleUse: true },
          { referralRedemption: { isNot: null } },
        ],
      },
      select: { id: true },
    });
    const retired = new Set(personal.map((promotion) => promotion.id));
    if (retired.size > 0) {
      await tx.promotion.updateMany({
        where: { id: { in: [...retired] } },
        data: { isActive: false },
      });
    }

    // Shared coupons get back the uses the test orders took.
    const usages = await tx.promotionUsage.groupBy({ by: ['promotionId'], _count: { _all: true } });
    for (const usage of usages) {
      if (retired.has(usage.promotionId)) continue;
      await tx.promotion.update({
        where: { id: usage.promotionId },
        data: { usageCount: { decrement: usage._count._all } },
      });
    }
    // Never below zero: a capped checkout can leave a usage row uncounted.
    await tx.promotion.updateMany({ where: { usageCount: { lt: 0 } }, data: { usageCount: 0 } });

    // The email log of these orders and people (see the module comment).
    if (numbers.length > 0) {
      await tx.notificationLog.deleteMany({
        where: {
          OR: numbers.map((number) => ({ payload: { path: ['orderNumber'], equals: number } })),
        },
      });
    }
    if (customerIds.length > 0) {
      await tx.notificationLog.deleteMany({ where: { customerId: { in: customerIds } } });
    }

    const reviewed = await tx.review.findMany({
      select: { productId: true },
      distinct: ['productId'],
    });

    await tx.refund.deleteMany({});
    await tx.payment.deleteMany({});
    await tx.order.deleteMany({});
    await tx.renewalReminder.deleteMany({});

    for (const { productId } of reviewed) {
      const rating = await tx.review.aggregate({
        where: { productId, status: ReviewStatus.APPROVED },
        _avg: { rating: true },
        _count: { _all: true },
      });
      const count = rating._count._all;
      await tx.product.update({
        where: { id: productId },
        data: {
          ratingCount: count,
          ratingAvg: new Prisma.Decimal(count > 0 ? (rating._avg.rating ?? 0).toFixed(2) : '0.00'),
        },
      });
    }

    await tx.customer.deleteMany({});
  }, TRANSACTION);

  // 2. The vault: retire, never erase; the access log first.
  if (keys.length > 0) {
    const ids = keys.map((key) => key.id);
    await vault.$transaction(async (tx) => {
      await tx.keyAccessLog.createMany({
        data: ids.map((licenseKeyId) => ({
          licenseKeyId,
          action: KeyAccessAction.REVOKE,
          actorType: ActorType.SYSTEM,
        })),
      });
      await tx.licenseKey.updateMany({
        where: { id: { in: ids }, state: { in: LIVE_KEY_STATES } },
        data: {
          state: LicenseKeyState.REVOKED,
          revokedAt: new Date(),
          revokedReason: REVOKE_REASON,
        },
      });
    }, TRANSACTION);
  }

  // 3. onHand from the vault, for every variant this tool has touched.
  const touched = await vault.licenseKey.findMany({
    where: { revokedReason: REVOKE_REASON },
    select: { variantId: true },
    distinct: ['variantId'],
  });
  const variantIds = touched.map((row) => row.variantId);
  if (variantIds.length > 0) {
    const available = await vault.licenseKey.groupBy({
      by: ['variantId'],
      where: {
        variantId: { in: variantIds },
        state: LicenseKeyState.AVAILABLE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      _count: true,
    });
    const truth = new Map(available.map((row) => [row.variantId, row._count]));

    await app.$transaction(async (tx) => {
      for (const variantId of variantIds) {
        const level = await tx.inventoryLevel.findUnique({
          where: { variantId },
          select: { onHand: true, reserved: true },
        });
        if (!level) continue;
        // Never below what a cart in checkout is already holding.
        const next = Math.max(truth.get(variantId) ?? 0, level.reserved);
        if (next === level.onHand) continue;
        await tx.inventoryLevel.update({ where: { variantId }, data: { onHand: next } });
        await tx.stockMovement.create({
          data: {
            variantId,
            delta: next - level.onHand,
            reason: StockMovementReason.REVOKED,
            note: REVOKE_REASON,
          },
        });
        report.stock[variantId] = { from: level.onHand, to: next };
      }
    }, TRANSACTION);
  }

  report.applied = true;
  return report;
}
