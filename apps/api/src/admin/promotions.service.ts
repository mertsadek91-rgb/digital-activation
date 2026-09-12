import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  AdminPromotion,
  AdminPromotionList,
  CreatePromotion,
  PromotionRules,
  UpdatePromotion,
} from '@da/contracts';
import { DEFAULT_PROMOTION_RULES, promotionRulesSchema } from '@da/contracts';
import { OrderStatus, Prisma } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Coupons, for the panel.
 *
 * The buying side of this has been complete since the cart was built: a code
 * is validated, its rules are enforced, the discount is computed against the
 * eligible lines only, the cap is applied, and the redemption is recorded
 * against the customer. What has never existed is any way to *create* one — so
 * the store could honour codes that nobody could issue, which made the whole
 * apparatus decorative. A store that cannot run a discount cannot run a launch
 * offer, a seasonal campaign, or an apology.
 *
 * Three decisions shape this file.
 *
 * A code is never edited and never deleted. `Promotion.code` is what sits on
 * every Order that used it and on every PromotionUsage row; changing it
 * rewrites history, and removing it makes those rows point at nothing. Turning
 * a coupon off is what `isActive` is for, and it is reversible — which is what
 * somebody actually wants at 2am when a code is being shared somewhere it
 * should not be.
 *
 * The type is not editable either. `PERCENT` with value 20 and `FIXED` with
 * value 20 are twenty percent and twenty dollars, and a screen that let one
 * become the other with a dropdown would eventually turn a 20% code into a $20
 * code on a $25 product.
 *
 * And `state` is computed rather than stored. `isActive` says only what a
 * person last toggled; whether a code works right now also depends on its
 * window and its usage cap, and a panel that prints "active" over an expired
 * coupon is telling a lie somebody will act on.
 */
/**
 * Whether a code works right now, and if not, why not.
 *
 * Computed rather than stored, because `isActive` says only what a person last
 * toggled: whether a coupon actually works also depends on its window and its
 * usage cap, and a panel printing "active" over an expired code is telling a
 * lie somebody will act on.
 *
 * The order of the checks is the whole content of this function. A coupon that
 * is switched off is off whatever its dates say. One that ran out stays
 * "exhausted" even after its window closes — calling that "expired" would send
 * somebody to look at the calendar when the answer is the limit.
 */
export function promotionState(promotion: {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usageCount: number;
  now?: Date;
}): AdminPromotion['state'] {
  if (!promotion.isActive) return 'OFF';
  if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
    return 'EXHAUSTED';
  }
  const now = promotion.now ?? new Date();
  if (promotion.startsAt && promotion.startsAt > now) return 'SCHEDULED';
  if (promotion.endsAt && promotion.endsAt < now) return 'EXPIRED';
  return 'LIVE';
}

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filter?: string): Promise<AdminPromotionList> {
    const promotions = await this.prisma.client.promotion.findMany({
      // Newest first: the code somebody is looking for is almost always the one
      // they just made, or the one they are about to turn off.
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { usages: true } } },
    });

    // What each code actually did, in one grouped query rather than one per
    // row. Only orders that were paid for count — a discount on an abandoned
    // order is not a discount given.
    const totals = await this.prisma.client.order.groupBy({
      by: ['promotionId'],
      where: {
        promotionId: { not: null },
        status: {
          in: [
            OrderStatus.PAID,
            OrderStatus.FULFILLING,
            OrderStatus.FULFILLED,
            OrderStatus.COMPLETED,
          ],
        },
      },
      _sum: { discountUsd: true, totalUsd: true },
    });
    const byId = new Map(totals.map((row) => [row.promotionId, row._sum]));

    const rows = promotions.map((promotion) =>
      this.toRow(promotion, promotion._count.usages, byId.get(promotion.id)),
    );

    const counts = {
      all: rows.length,
      live: rows.filter((row) => row.state === 'LIVE').length,
      scheduled: rows.filter((row) => row.state === 'SCHEDULED').length,
      finished: rows.filter((row) => row.state === 'EXPIRED' || row.state === 'EXHAUSTED').length,
    };

    return { rows: filter ? rows.filter((row) => this.matches(row, filter)) : rows, counts };
  }

  private matches(row: AdminPromotion, filter: string): boolean {
    if (filter === 'live') return row.state === 'LIVE';
    if (filter === 'scheduled') return row.state === 'SCHEDULED';
    if (filter === 'finished') return row.state === 'EXPIRED' || row.state === 'EXHAUSTED';
    if (filter === 'off') return row.state === 'OFF';
    return true;
  }

  async create(input: {
    body: CreatePromotion;
    staffId: string;
    context: { ip?: string | undefined; userAgent?: string | undefined };
  }): Promise<AdminPromotion> {
    const { body } = input;

    if (body.code) {
      const clash = await this.prisma.client.promotion.findUnique({
        where: { code: body.code },
        select: { id: true },
      });
      // Named rather than silently reused: two campaigns sharing one code means
      // the second one's numbers are the first one's numbers.
      if (clash) throw new BadRequestException(`الكود ${body.code} مستخدم بالفعل.`);
    }

    const promotion = await this.prisma.client.promotion.create({
      data: {
        code: body.code ?? null,
        name: body.name,
        description: body.description ?? null,
        type: body.type,
        scope: body.scope,
        value: new Prisma.Decimal(body.value),
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        usageLimit: body.usageLimit ?? null,
        perCustomerLimit: body.perCustomerLimit,
        isActive: body.isActive,
        rules: body.rules,
      },
      include: { _count: { select: { usages: true } } },
    });

    await this.audit.record({
      actorId: input.staffId,
      entity: 'Promotion',
      entityId: promotion.id,
      action: 'promotion.created',
      // The whole definition, because "who created the 90% code" is the
      // question this table exists to answer.
      after: {
        code: promotion.code,
        type: promotion.type,
        value: promotion.value.toFixed(2),
        usageLimit: promotion.usageLimit,
      },
      ip: input.context.ip,
      userAgent: input.context.userAgent,
    });

    return this.toRow(promotion, 0, undefined);
  }

  async update(input: {
    id: string;
    body: UpdatePromotion;
    staffId: string;
    context: { ip?: string | undefined; userAgent?: string | undefined };
  }): Promise<AdminPromotion> {
    const { body } = input;

    const existing = await this.prisma.client.promotion.findUnique({
      where: { id: input.id },
      select: { id: true, isActive: true, value: true, endsAt: true },
    });
    if (!existing) throw new NotFoundException('لا يوجد عرض بهذا المعرّف.');

    const promotion = await this.prisma.client.promotion.update({
      where: { id: input.id },
      data: {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.value === undefined ? {} : { value: new Prisma.Decimal(body.value) }),
        ...(body.startsAt === undefined
          ? {}
          : { startsAt: body.startsAt === null ? null : new Date(body.startsAt) }),
        ...(body.endsAt === undefined
          ? {}
          : { endsAt: body.endsAt === null ? null : new Date(body.endsAt) }),
        ...(body.usageLimit === undefined ? {} : { usageLimit: body.usageLimit }),
        ...(body.perCustomerLimit === undefined ? {} : { perCustomerLimit: body.perCustomerLimit }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        ...(body.rules === undefined ? {} : { rules: body.rules }),
      },
      include: { _count: { select: { usages: true } } },
    });

    await this.audit.record({
      actorId: input.staffId,
      entity: 'Promotion',
      entityId: promotion.id,
      action: 'promotion.updated',
      before: { isActive: existing.isActive, value: existing.value.toFixed(2) },
      after: { isActive: promotion.isActive, value: promotion.value.toFixed(2) },
      ip: input.context.ip,
      userAgent: input.context.userAgent,
    });

    return this.toRow(promotion, promotion._count.usages, undefined);
  }

  private rulesOf(value: Prisma.JsonValue): PromotionRules {
    const parsed = promotionRulesSchema.safeParse(value ?? {});
    return parsed.success ? parsed.data : DEFAULT_PROMOTION_RULES;
  }

  private toRow(
    promotion: Prisma.PromotionGetPayload<{ include: { _count: { select: { usages: true } } } }>,
    redeemed: number,
    totals: { discountUsd: Prisma.Decimal | null; totalUsd: Prisma.Decimal | null } | undefined,
  ): AdminPromotion {
    return {
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      description: promotion.description,
      type: promotion.type,
      scope: promotion.scope,
      value: promotion.value.toFixed(2),
      isActive: promotion.isActive,
      startsAt: promotion.startsAt?.toISOString() ?? null,
      endsAt: promotion.endsAt?.toISOString() ?? null,
      usageLimit: promotion.usageLimit,
      usageCount: promotion.usageCount,
      perCustomerLimit: promotion.perCustomerLimit,
      singleUse: promotion.singleUse,
      rules: this.rulesOf(promotion.rules),
      redeemed,
      discountedUsd: (totals?.discountUsd ?? new Prisma.Decimal(0)).toFixed(2),
      revenueUsd: (totals?.totalUsd ?? new Prisma.Decimal(0)).toFixed(2),
      state: promotionState(promotion),
      createdAt: promotion.createdAt.toISOString(),
    };
  }
}
