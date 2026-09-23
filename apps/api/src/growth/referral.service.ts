import crypto from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { type AdminReferralList, type MyReferral, promotionRulesSchema } from '@da/contracts';
import {
  Locale,
  PaymentState,
  Prisma,
  PromotionType,
  ReferralRedemptionStatus as Status,
} from '@da/db';

import { say } from '../common/panel-locale.js';
import { MailService } from '../mail/mail.service.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import {
  REFERRAL_FRIEND_PREFIX,
  REFERRAL_REWARD_PREFIX,
  isSelfReferral,
  randomCode,
  referralClearance,
  referralFlags,
} from './rules.js';
import { codeEmail } from './templates.js';

/** The daily sweep's advisory lock; the 7612051xx range belongs to growth. */
const SWEEP_LOCK = 761_205_101;
/** A friend code outlives the visit by this long; the cart cookie lasts 30 days too. */
const FRIEND_CODE_DAYS = 30;
/** How long a reward code stays usable. */
const REWARD_CODE_DAYS = 90;
const PER_PASS = 200;

/**
 * Give-X-get-X referrals.
 *
 * The flow, and where each fraud control sits:
 *
 *  1. A signed-in customer has one stable code (`/r/<code>`).
 *  2. A visitor who follows it gets an httpOnly cookie — refused if the visitor
 *     is signed in as the referrer.
 *  3. When their cart first holds something, and has no other discount on it,
 *     a single-use, first-order-only friend code is minted and attached. One
 *     discount per cart, as everywhere else in the store.
 *  4. Checkout and `markPaid` refuse it to the referrer (same customer, or the
 *     same mailbox by `canonicalEmail`) and to anyone with an earlier paid
 *     order — see `customerCouponRefusal`.
 *  5. The daily sweep records the paid order, waits `clearAfterDays`, and only
 *     then mints the referrer's reward: a single-use code issued to them. A
 *     refund, cancellation or dispute before then voids the referral. Rows
 *     with fraud flags wait for a person instead of paying automatically.
 */
@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: MarketingSettingsService,
  ) {}

  private get storefront(): string {
    return process.env.STOREFRONT_URL ?? 'http://localhost:3000';
  }

  // --- the referrer --------------------------------------------------------

  async mine(customerId: string): Promise<MyReferral> {
    const settings = await this.settings.get('referral');
    const base = {
      enabled: settings.enabled,
      friendPercent: settings.friendPercent,
      referrerRewardUsd: settings.referrerRewardUsd,
      clearAfterDays: settings.clearAfterDays,
      licenceNumber: settings.licenceNumber,
    };
    if (!settings.enabled) return { ...base, code: null, pending: 0, rewarded: 0 };

    const referral = await this.ensureCode(customerId);
    const [pending, rewarded] = await Promise.all([
      this.prisma.client.referralRedemption.count({
        where: { referralId: referral.id, status: Status.PENDING },
      }),
      this.prisma.client.referralRedemption.count({
        where: { referralId: referral.id, status: Status.REWARDED },
      }),
    ]);
    return { ...base, code: referral.code, pending, rewarded };
  }

  /** Stable: made once, on first look, and never rotated under a shared link. */
  private async ensureCode(customerId: string): Promise<{ id: string; code: string }> {
    const existing = await this.prisma.client.referral.findUnique({
      where: { customerId },
      select: { id: true, code: true },
    });
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.client.referral.create({
          data: { customerId, code: randomCode(8, crypto.randomBytes) },
          select: { id: true, code: true },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        // Either the code collided or a second tab created the row first.
        const raced = await this.prisma.client.referral.findUnique({
          where: { customerId },
          select: { id: true, code: true },
        });
        if (raced) return raced;
      }
    }
    throw new Error('Could not allocate a referral code.');
  }

  // --- the friend ----------------------------------------------------------

  /**
   * A visitor followed a link. True when the cookie should be set.
   *
   * Refused for an unknown code, when the programme is off, and for the
   * referrer's own signed-in session — the cheapest self-referral to stop.
   */
  async visit(code: string, visitorCustomerId: string | null): Promise<boolean> {
    const settings = await this.settings.get('referral');
    if (!settings.enabled) return false;
    const referral = await this.prisma.client.referral.findUnique({
      where: { code },
      select: { customerId: true },
    });
    if (!referral) return false;
    return referral.customerId !== visitorCustomerId;
  }

  /**
   * Attaches a friend code to a cart, when it has items and no discount yet.
   *
   * Returns true when the cart changed. Called after add-to-cart and on a
   * visit with a cart already open; the minted code is reused for the same
   * cart, so repeated calls do not mint more.
   */
  async attachToCart(
    cartToken: string | undefined,
    code: string | undefined,
    ip: string | undefined,
  ): Promise<boolean> {
    if (!cartToken || !code) return false;
    const settings = await this.settings.get('referral');
    if (!settings.enabled || settings.friendPercent <= 0) return false;

    const cart = await this.prisma.client.cart.findUnique({
      where: { token: cartToken },
      select: {
        id: true,
        couponCode: true,
        email: true,
        customerId: true,
        _count: { select: { items: true } },
      },
    });
    if (!cart || cart.couponCode || cart._count.items === 0) return false;

    const referral = await this.prisma.client.referral.findUnique({
      where: { code },
      select: { id: true, code: true, customerId: true, customer: { select: { email: true } } },
    });
    if (!referral) return false;
    if (
      cart.email &&
      isSelfReferral(
        { customerId: referral.customerId, email: referral.customer.email },
        { customerId: cart.customerId, email: cart.email },
      )
    ) {
      return false;
    }

    const already = await this.prisma.client.referralRedemption.findUnique({
      where: { cartId: cart.id },
      select: { promotion: { select: { code: true, isActive: true, usageCount: true } } },
    });
    let promotionCode = already?.promotion.code ?? null;
    if (already && (!already.promotion.isActive || already.promotion.usageCount > 0)) return false;

    if (!promotionCode) {
      promotionCode = `${REFERRAL_FRIEND_PREFIX}${randomCode(8, crypto.randomBytes)}`;
      try {
        await this.prisma.client.$transaction(async (tx) => {
          const promotion = await tx.promotion.create({
            data: {
              code: promotionCode ?? '',
              type: PromotionType.PERCENT,
              value: new Prisma.Decimal(settings.friendPercent),
              name: `Referral ${referral.code}: friend ${String(settings.friendPercent)}%`,
              description: settings.licenceNumber
                ? `Discount licence ${settings.licenceNumber}`
                : null,
              rules: promotionRulesSchema.parse({ firstOrderOnly: true }),
              endsAt: new Date(Date.now() + FRIEND_CODE_DAYS * 86_400_000),
              usageLimit: 1,
              perCustomerLimit: 1,
              singleUse: true,
            },
          });
          await tx.referralRedemption.create({
            data: {
              referralId: referral.id,
              promotionId: promotion.id,
              cartId: cart.id,
              ip: ip ?? null,
            },
          });
        });
      } catch (error) {
        // Two add-to-cart calls at once: the other one minted for this cart.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          return false;
        }
        throw error;
      }
    }

    const updated = await this.prisma.client.cart.updateMany({
      where: { id: cart.id, couponCode: null },
      data: { couponCode: promotionCode },
    });
    return updated.count === 1;
  }

  // --- the sweep -----------------------------------------------------------

  /**
   * Daily: records paid friend orders, then pays or voids the ones whose
   * refund window has passed. Guarded by an advisory lock so replicas take
   * turns rather than paying twice.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'referral-sweep' })
  async sweep(
    now: Date = new Date(),
  ): Promise<{ recorded: number; rewarded: number; voided: number }> {
    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${SWEEP_LOCK}) as locked`;
    if (!lock?.locked) return { recorded: 0, rewarded: 0, voided: 0 };
    try {
      const recorded = await this.recordPaid();
      const { rewarded, voided } = await this.clear(now);
      if (recorded + rewarded + voided > 0) {
        this.logger.log(
          `Referrals: ${String(recorded)} recorded, ${String(rewarded)} rewarded, ${String(voided)} voided.`,
        );
      }
      return { recorded, rewarded, voided };
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${SWEEP_LOCK})`;
    }
  }

  /** ISSUED rows whose friend code was used on a paid order become PENDING. */
  private async recordPaid(): Promise<number> {
    const rows = await this.prisma.client.referralRedemption.findMany({
      where: { status: Status.ISSUED, promotion: { usages: { some: {} } } },
      take: PER_PASS,
      select: {
        id: true,
        referralId: true,
        ip: true,
        referral: {
          select: {
            customerId: true,
            customer: {
              select: { email: true, sessions: { select: { ip: true }, take: 20 } },
            },
          },
        },
        promotion: {
          select: {
            usages: {
              take: 1,
              select: {
                discountUsd: true,
                customerId: true,
                order: { select: { id: true, email: true, paidAt: true, ip: true } },
              },
            },
          },
        },
      },
    });

    let recorded = 0;
    for (const row of rows) {
      const usage = row.promotion.usages[0];
      if (!usage) continue;
      const order = usage.order;
      const referrer = { customerId: row.referral.customerId, email: row.referral.customer.email };
      const friend = { customerId: usage.customerId, email: order.email };

      // Checkout refuses this already; a row that got through anyway (the
      // code typed by hand into another cart) is voided, not paid.
      if (isSelfReferral(referrer, friend)) {
        await this.prisma.client.referralRedemption.update({
          where: { id: row.id },
          data: {
            status: Status.VOID,
            voidReason: 'SELF_REFERRAL',
            orderId: order.id,
            friendEmail: order.email,
          },
        });
        continue;
      }

      const flags = referralFlags({
        referrerIps: row.referral.customer.sessions
          .map((session) => session.ip)
          .filter((ip): ip is string => Boolean(ip)),
        friendIp: order.ip ?? row.ip,
        referrerEmail: referrer.email,
        friendEmail: order.email,
      });
      await this.prisma.client.$transaction([
        this.prisma.client.referralRedemption.update({
          where: { id: row.id },
          data: {
            status: Status.PENDING,
            orderId: order.id,
            friendEmail: order.email,
            friendCustomerId: usage.customerId,
            friendDiscountUsd: usage.discountUsd,
            paidAt: order.paidAt,
            flags,
          },
        }),
        this.prisma.client.referral.update({
          where: { id: row.referralId },
          data: { uses: { increment: 1 } },
        }),
      ]);
      recorded += 1;
    }
    return recorded;
  }

  private async clear(now: Date): Promise<{ rewarded: number; voided: number }> {
    const settings = await this.settings.get('referral');
    const rows = await this.prisma.client.referralRedemption.findMany({
      // Flagged rows wait for a person (`approve`), which clears the flags.
      where: { status: Status.PENDING, flags: { isEmpty: true } },
      take: PER_PASS,
      orderBy: { paidAt: 'asc' },
      select: {
        id: true,
        referral: {
          select: {
            customerId: true,
            customer: { select: { email: true, locale: true } },
          },
        },
        order: {
          select: {
            status: true,
            paidAt: true,
            riskLevel: true,
            _count: {
              select: {
                payments: {
                  where: { OR: [{ state: PaymentState.REFUNDED }, { refunds: { some: {} } }] },
                },
              },
            },
          },
        },
      },
    });

    let rewarded = 0;
    let voided = 0;
    for (const row of rows) {
      if (!row.order) {
        await this.void(row.id, 'ORDER_DELETED');
        voided += 1;
        continue;
      }
      const verdict = referralClearance({
        status: row.order.status,
        paidAt: row.order.paidAt,
        riskLevel: row.order.riskLevel,
        refundedPayments: row.order._count.payments,
        clearAfterDays: settings.clearAfterDays,
        now,
      });
      if (verdict.action === 'WAIT') continue;
      if (verdict.action === 'VOID') {
        await this.void(row.id, verdict.reason);
        voided += 1;
        continue;
      }
      await this.reward(row.id, row.referral, settings.referrerRewardUsd);
      rewarded += 1;
    }
    return { rewarded, voided };
  }

  private async void(id: string, reason: string): Promise<void> {
    await this.prisma.client.referralRedemption.updateMany({
      where: { id, status: { in: [Status.ISSUED, Status.PENDING] } },
      data: { status: Status.VOID, voidReason: reason },
    });
  }

  /** Mints the referrer's single-use code and marks the row, once. */
  private async reward(
    id: string,
    referrer: { customerId: string; customer: { email: string; locale: Locale } },
    rewardUsd: number,
  ): Promise<void> {
    const code =
      rewardUsd > 0 ? `${REFERRAL_REWARD_PREFIX}${randomCode(8, crypto.randomBytes)}` : null;
    const expiresAt = new Date(Date.now() + REWARD_CODE_DAYS * 86_400_000);

    const done = await this.prisma.client.$transaction(async (tx) => {
      // Compare-and-set first, so a second sweep cannot mint a second code.
      const moved = await tx.referralRedemption.updateMany({
        where: { id, status: Status.PENDING },
        data: {
          status: Status.REWARDED,
          rewardUsd: new Prisma.Decimal(rewardUsd),
          rewardedAt: new Date(),
        },
      });
      if (moved.count !== 1) return false;
      if (!code) return true;
      const promotion = await tx.promotion.create({
        data: {
          code,
          type: PromotionType.FIXED,
          value: new Prisma.Decimal(rewardUsd),
          name: `Referral reward $${rewardUsd.toFixed(2)}`,
          rules: promotionRulesSchema.parse({}),
          endsAt: expiresAt,
          usageLimit: 1,
          perCustomerLimit: 1,
          singleUse: true,
          issuedToId: referrer.customerId,
        },
      });
      await tx.referralRedemption.update({
        where: { id },
        data: { rewardPromotionId: promotion.id },
      });
      return true;
    });
    if (!done || !code) return;

    const locale = referrer.customer.locale === Locale.EN ? 'en' : 'ar';
    const settings = await this.settings.get('referral');
    // Transactional: the referrer joined the programme to earn this, and the
    // email carries what they earned, not an offer.
    await this.mail.send({
      to: referrer.customer.email,
      template: 'referral.reward',
      locale,
      customerId: referrer.customerId,
      rendered: codeEmail({
        locale,
        kind: 'referral-reward',
        code,
        amount: `$${rewardUsd.toFixed(2)}`,
        expiresAt,
        licenceNumber: settings.licenceNumber,
        storeUrl: `${this.storefront}${locale === 'en' ? '/en' : ''}/store`,
      }),
      payload: { redemptionId: id },
    });
  }

  // --- the panel -----------------------------------------------------------

  async adminList(): Promise<AdminReferralList> {
    const [rows, grouped, referrers, sums, flagged] = await Promise.all([
      this.prisma.client.referralRedemption.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          referral: { select: { code: true, customer: { select: { email: true } } } },
          order: { select: { number: true, status: true } },
        },
      }),
      this.prisma.client.referralRedemption.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.client.referral.count(),
      this.prisma.client.referralRedemption.aggregate({
        where: { status: { in: [Status.PENDING, Status.REWARDED] } },
        _sum: { friendDiscountUsd: true, rewardUsd: true },
      }),
      this.prisma.client.referralRedemption.count({
        where: { status: Status.PENDING, NOT: { flags: { isEmpty: true } } },
      }),
    ]);
    const count = (status: Status): number =>
      grouped.find((entry) => entry.status === status)?._count._all ?? 0;

    return {
      rows: rows.map((row) => ({
        id: row.id,
        status: row.status,
        referrerEmail: row.referral.customer.email,
        code: row.referral.code,
        friendEmail: row.friendEmail,
        orderNumber: row.order?.number ?? null,
        orderStatus: row.order?.status ?? null,
        friendDiscountUsd: row.friendDiscountUsd?.toFixed(2) ?? null,
        rewardUsd: row.rewardUsd?.toFixed(2) ?? null,
        paidAt: row.paidAt?.toISOString() ?? null,
        rewardedAt: row.rewardedAt?.toISOString() ?? null,
        voidReason: row.voidReason,
        flags: row.flags,
        createdAt: row.createdAt.toISOString(),
      })),
      totals: {
        referrers,
        issued: count(Status.ISSUED),
        pending: count(Status.PENDING),
        rewarded: count(Status.REWARDED),
        void: count(Status.VOID),
        flagged,
        friendDiscountUsd: (sums._sum.friendDiscountUsd ?? new Prisma.Decimal(0)).toFixed(2),
        rewardUsd: (sums._sum.rewardUsd ?? new Prisma.Decimal(0)).toFixed(2),
      },
    };
  }

  /**
   * A person looked at a flagged row and trusts it: the flags go, and the next
   * sweep pays it once its window has passed. Kept in the audit trail by the
   * controller.
   */
  async approve(id: string): Promise<{ id: string; status: string }> {
    const updated = await this.prisma.client.referralRedemption.updateMany({
      where: { id, status: Status.PENDING },
      data: { flags: [] },
    });
    if (updated.count !== 1) {
      throw new NotFoundException(
        say('لا توجد إحالة معلّقة بهذا المعرّف.', 'No pending referral with that id.'),
      );
    }
    return { id, status: Status.PENDING };
  }

  async reject(id: string): Promise<{ id: string; status: string }> {
    const updated = await this.prisma.client.referralRedemption.updateMany({
      where: { id, status: { in: [Status.ISSUED, Status.PENDING] } },
      data: { status: Status.VOID, voidReason: 'REJECTED_BY_STAFF' },
    });
    if (updated.count !== 1) {
      throw new NotFoundException(
        say('لا توجد إحالة مفتوحة بهذا المعرّف.', 'No open referral with that id.'),
      );
    }
    return { id, status: Status.VOID };
  }
}
