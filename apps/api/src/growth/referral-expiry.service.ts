import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OrderStatus, ReferralRedemptionStatus as Status } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

/** Its own advisory lock, in growth's 7612052xx range beside the referral sweep's. */
const LOCK_KEY = 761_205_201;
/** The friend code's own lifetime (`endsAt`); past it the code cannot be used anyway. */
const EXPIRE_AFTER_DAYS = 30;
const PER_PASS = 200;
/** Recorded in `voidReason`, beside the sweep's REFUNDED / REJECTED_BY_STAFF. */
export const EXPIRED_REASON = 'EXPIRED';

/**
 * Closes friend codes nobody used.
 *
 * A friend code is minted the moment a referred visitor's cart holds
 * something, so most of them belong to carts that were never bought. Each
 * one is a live single-use promotion that stays in the panel's list, counts
 * as "issued" in the referral figures for ever, and holds its cart: the cart
 * keeps the dead code in `couponCode`, and the unique `cartId` on the
 * redemption stops that cart ever getting a fresh one.
 *
 * So after thirty days — the code's own `endsAt`, and the cart cookie's
 * lifetime — the row is voided with reason EXPIRED, the promotion is switched
 * off, and the cart is let go of both. VOID rather than a new EXPIRED status:
 * the enum already means "this referral will not pay out", and a reason
 * column already says why, so a migration would buy a label and nothing else.
 *
 * Never touched: a row whose code was used (the referral sweep moves those to
 * PENDING), and one whose code sits on an order that could still be paid.
 */
@Injectable()
export class ReferralExpiryService {
  private readonly logger = new Logger(ReferralExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // An hour after the referral sweep, so a code used yesterday is recorded as
  // paid before this could look at it.
  @Cron(CronExpression.EVERY_DAY_AT_5AM, { name: 'referral-expiry' })
  async sweep(now: Date = new Date()): Promise<{ expired: number }> {
    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!lock?.locked) return { expired: 0 };

    try {
      return await this.run(now);
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  private async run(now: Date): Promise<{ expired: number }> {
    const cutoff = new Date(now.getTime() - EXPIRE_AFTER_DAYS * 86_400_000);
    const rows = await this.prisma.client.referralRedemption.findMany({
      where: {
        status: Status.ISSUED,
        createdAt: { lte: cutoff },
        promotion: {
          usages: { none: {} },
          orders: {
            none: { status: { in: [OrderStatus.PENDING_PAYMENT, OrderStatus.PAYMENT_REVIEW] } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: PER_PASS,
      select: { id: true, cartId: true, promotionId: true, promotion: { select: { code: true } } },
    });

    let expired = 0;
    for (const row of rows) {
      const done = await this.prisma.client.$transaction(async (tx) => {
        // Conditional on ISSUED, so a code recorded as paid during the pass
        // is left to the referral sweep.
        const moved = await tx.referralRedemption.updateMany({
          where: { id: row.id, status: Status.ISSUED },
          data: { status: Status.VOID, voidReason: EXPIRED_REASON, cartId: null },
        });
        if (moved.count !== 1) return false;
        await tx.promotion.update({ where: { id: row.promotionId }, data: { isActive: false } });
        if (row.cartId) {
          await tx.cart.updateMany({
            where: { id: row.cartId, couponCode: row.promotion.code },
            data: { couponCode: null },
          });
        }
        return true;
      });
      if (done) expired += 1;
    }

    if (expired > 0) this.logger.log(`Expired ${String(expired)} unused referral friend code(s).`);
    return { expired };
  }
}
