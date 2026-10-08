import {
  LicenseKeyState,
  Prisma,
  ReviewStatus,
  StockMovementReason,
  type PrismaClient,
} from '@da/db';

/**
 * Clears the test data off the one environment before it takes real orders
 * (owner decision 2026-10-08: every order, customer, review and licence key
 * on staging is a test). Run through `purge-test-data-cli.ts`.
 *
 * What it does, in this order:
 *
 *  1. In one app-database transaction: deletes every order with what hangs
 *     off it — refunds and payments first (they are Restrict on purpose: a
 *     real payment must never go with its order), then the orders, whose
 *     lines, notes, status history, invoices, coupon usages, review invites,
 *     reviews and renewal reminders cascade — gives each coupon back its
 *     usages, recomputes the rating of every product that lost a review, and
 *     deletes every customer (sessions, addresses and the rest cascade).
 *  2. In the vault: revokes every licence key that is not already revoked.
 *     The vault role has no DELETE grant, by design, so a key is retired, not
 *     erased: REVOKED is never sold, sent or revealed again, and the row and
 *     its access log stay as the record. A test key must not go back to
 *     stock — it could be sold to a real customer.
 *  3. In the app database: takes the revoked AVAILABLE/RESERVED keys off each
 *     variant's onHand, with a REVOKED stock movement, so the product pages
 *     stop offering stock that is gone.
 *
 * A step that fails leaves the steps before it done and the ones after it
 * untouched; running again picks up what is left (the counts it expects are
 * then the new report's).
 *
 * Guards: it refuses to write unless told the exact counts the report shows
 * (so it cannot be run blind, or after real orders arrived), and refuses
 * outright above TEST_DATA_CEILING orders or customers — a store with that
 * much is trading, and this is not the tool for it.
 */

export const TEST_DATA_CEILING = 50;

export const REVOKE_REASON = 'test data purge before launch (owner decision 2026-10-08)';

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
  /** Variant ids whose onHand drops, and by how much. */
  stockTaken: Record<string, number>;
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

/** Keys that count in a variant's onHand. */
const STOCK_STATES: readonly LicenseKeyState[] = [
  LicenseKeyState.AVAILABLE,
  LicenseKeyState.RESERVED,
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
      select: { id: true, variantId: true, state: true },
    }),
  ]);

  const stockTaken: Record<string, number> = {};
  for (const key of keys) {
    if (STOCK_STATES.includes(key.state)) {
      stockTaken[key.variantId] = (stockTaken[key.variantId] ?? 0) + 1;
    }
  }

  const report: PurgeReport = {
    orders,
    customers,
    keys: keys.length,
    payments,
    refunds,
    orderLines,
    reviews,
    stockTaken,
    applied: false,
  };
  if (!input.apply) return report;

  const refused = refusal({ orders, customers, keys: keys.length }, input.expected);
  if (refused) throw new Error(refused);

  // 1. The app database, all or nothing.
  await app.$transaction(
    async (tx) => {
      const usages = await tx.promotionUsage.groupBy({
        by: ['promotionId'],
        _count: { _all: true },
      });
      const reviewed = await tx.review.findMany({
        select: { productId: true },
        distinct: ['productId'],
      });

      await tx.refund.deleteMany({});
      await tx.payment.deleteMany({});
      await tx.order.deleteMany({});

      for (const usage of usages) {
        await tx.promotion.update({
          where: { id: usage.promotionId },
          data: { usageCount: { decrement: usage._count._all } },
        });
      }
      // Never below zero, whatever the counter said before.
      await tx.promotion.updateMany({
        where: { usageCount: { lt: 0 } },
        data: { usageCount: 0 },
      });

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
            ratingAvg: new Prisma.Decimal(
              count > 0 ? (rating._avg.rating ?? 0).toFixed(2) : '0.00',
            ),
          },
        });
      }

      await tx.customer.deleteMany({});
    },
    { timeout: 120_000 },
  );

  // 2. The vault: retire, never erase.
  if (keys.length > 0) {
    await vault.licenseKey.updateMany({
      where: { id: { in: keys.map((key) => key.id) }, state: { in: LIVE_KEY_STATES } },
      data: { state: LicenseKeyState.REVOKED, revokedAt: new Date(), revokedReason: REVOKE_REASON },
    });
  }

  // 3. Stock that is gone stops being offered.
  const variants = Object.entries(stockTaken);
  if (variants.length > 0) {
    await app.$transaction(async (tx) => {
      for (const [variantId, taken] of variants) {
        const level = await tx.inventoryLevel.findUnique({
          where: { variantId },
          select: { onHand: true },
        });
        if (!level) continue;
        const onHand = Math.max(0, level.onHand - taken);
        await tx.inventoryLevel.update({ where: { variantId }, data: { onHand } });
        await tx.stockMovement.create({
          data: {
            variantId,
            delta: onHand - level.onHand,
            reason: StockMovementReason.REVOKED,
            note: REVOKE_REASON,
          },
        });
      }
    });
  }

  report.applied = true;
  return report;
}
