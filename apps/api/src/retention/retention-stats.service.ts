import { Injectable } from '@nestjs/common';

import type { CartRecoveryStats, RenewalStats } from '@da/contracts';
import { OrderStatus, Prisma } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

import { LADDER_STAGES, storeTimeZone } from './rules.js';

/**
 * What the two retention automations did, for the marketing screens.
 *
 * Counts only, from the rows the sweeps write — `NotificationLog` for what
 * left, `RenewalReminder` and `CartRecoveryEvent` for what was due and held
 * out — joined to paid orders for what came back. Treated and held-out groups
 * are reported side by side, because "recovered revenue" on its own credits
 * the email with every customer who would have come back anyway.
 *
 * Computed in memory over the window. At this store's volume that is a few
 * hundred rows, and a query per figure would be harder to read than the code.
 */
const WINDOW_DAYS = 30;

const PAID_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];

@Injectable()
export class RetentionStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async renewals(now: Date = new Date()): Promise<RenewalStats> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

    const logs = await this.prisma.client.notificationLog.findMany({
      where: { template: 'renewal.reminder', sentAt: { gte: since } },
      select: { payload: true, deliveredAt: true },
    });
    const byOffset = new Map<number, { sent: number; failed: number }>();
    let withCode = 0;
    for (const log of logs) {
      const payload = (log.payload ?? {}) as Record<string, unknown>;
      const offset = typeof payload.offsetDays === 'number' ? payload.offsetDays : 0;
      const entry = byOffset.get(offset) ?? { sent: 0, failed: 0 };
      if (log.deliveredAt) entry.sent += 1;
      else entry.failed += 1;
      byOffset.set(offset, entry);
      if (log.deliveredAt && payload.withCode === true) withCode += 1;
    }

    const reminders = await this.prisma.client.renewalReminder.findMany({
      where: { createdAt: { gte: since } },
      select: {
        email: true,
        customerId: true,
        productId: true,
        orderId: true,
        heldOut: true,
        sentAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // One unit per customer and product: several lines and several reminders
    // for the same licence are one renewal decision.
    const units = new Map<
      string,
      {
        email: string;
        customerId: string | null;
        productId: string;
        orderId: string;
        heldOut: boolean;
        treated: boolean;
        firstAt: Date;
      }
    >();
    for (const row of reminders) {
      const key = `${row.email.toLowerCase()}|${row.productId}`;
      const unit = units.get(key) ?? {
        email: row.email,
        customerId: row.customerId,
        productId: row.productId,
        orderId: row.orderId,
        heldOut: false,
        treated: false,
        firstAt: row.createdAt,
      };
      if (row.heldOut) unit.heldOut = true;
      if (row.sentAt) unit.treated = true;
      units.set(key, unit);
    }

    const lift = { treated: 0, treatedConverted: 0, heldOut: 0, heldOutConverted: 0 };
    const renewedOrders = new Set<string>();
    let revenue = new Prisma.Decimal(0);

    for (const unit of units.values()) {
      if (!unit.treated && !unit.heldOut) continue;
      const orders = await this.prisma.client.order.findMany({
        where: {
          id: { not: unit.orderId },
          status: { in: PAID_STATUSES },
          paidAt: { gte: unit.firstAt },
          OR: [
            ...(unit.customerId ? [{ customerId: unit.customerId }] : []),
            { email: { equals: unit.email, mode: 'insensitive' as const } },
          ],
          items: { some: { variant: { productId: unit.productId } } },
        },
        select: {
          id: true,
          items: {
            where: { variant: { productId: unit.productId } },
            select: { lineTotalUsd: true },
          },
        },
      });
      const converted = orders.length > 0;
      if (unit.treated) {
        lift.treated += 1;
        if (converted) lift.treatedConverted += 1;
        for (const order of orders) {
          if (renewedOrders.has(order.id)) continue;
          renewedOrders.add(order.id);
          for (const item of order.items) revenue = revenue.plus(item.lineTotalUsd);
        }
      } else {
        lift.heldOut += 1;
        if (converted) lift.heldOutConverted += 1;
      }
    }

    return {
      windowDays: WINDOW_DAYS,
      sentByOffset: [...byOffset.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([offsetDays, entry]) => ({ offsetDays, ...entry })),
      withCode,
      renewedOrders: renewedOrders.size,
      renewedRevenueUsd: revenue.toFixed(2),
      lift,
    };
  }

  async cartRecovery(now: Date = new Date()): Promise<CartRecoveryStats> {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);

    const events = await this.prisma.client.cartRecoveryEvent.findMany({
      where: { sentAt: { gte: since } },
      select: {
        cartId: true,
        stage: true,
        heldOut: true,
        clickedAt: true,
        promotionId: true,
        sentAt: true,
      },
      orderBy: { sentAt: 'asc' },
    });

    const sentByStage = LADDER_STAGES.map((stage) => {
      const rows = events.filter((event) => event.stage === stage);
      return {
        stage,
        sent: rows.filter((event) => !event.heldOut).length,
        heldOut: rows.filter((event) => event.heldOut).length,
        clicked: rows.filter((event) => !event.heldOut && event.clickedAt).length,
        withCode: rows.filter((event) => !event.heldOut && event.promotionId).length,
      };
    });

    // A cart is held out or treated as a whole: the holdout is by cart id.
    const carts = new Map<string, { heldOut: boolean; firstAt: Date }>();
    for (const event of events) {
      if (!carts.has(event.cartId)) {
        carts.set(event.cartId, { heldOut: event.heldOut, firstAt: event.sentAt });
      }
    }

    const paid = carts.size
      ? await this.prisma.client.order.findMany({
          where: { cartId: { in: [...carts.keys()] }, status: { in: PAID_STATUSES } },
          select: { cartId: true, paidAt: true },
        })
      : [];

    const lift = { treated: 0, treatedConverted: 0, heldOut: 0, heldOutConverted: 0 };
    for (const [cartId, cart] of carts) {
      const converted = paid.some(
        (order) => order.cartId === cartId && order.paidAt !== null && order.paidAt >= cart.firstAt,
      );
      if (cart.heldOut) {
        lift.heldOut += 1;
        if (converted) lift.heldOutConverted += 1;
      } else {
        lift.treated += 1;
        if (converted) lift.treatedConverted += 1;
      }
    }

    // Recovered: paid in the window from a cart that had been sent an email
    // (`markPaid` marks those RECOVERED rather than CLOSED).
    const recovered = await this.prisma.client.order.findMany({
      where: {
        status: { in: PAID_STATUSES },
        paidAt: { gte: since },
        cart: { stage: 'RECOVERED' },
      },
      select: { totalUsd: true },
    });

    return {
      windowDays: WINDOW_DAYS,
      timeZone: storeTimeZone(),
      sentByStage,
      recoveredOrders: recovered.length,
      recoveredRevenueUsd: recovered
        .reduce((sum, order) => sum.plus(order.totalUsd), new Prisma.Decimal(0))
        .toFixed(2),
      lift,
    };
  }
}
