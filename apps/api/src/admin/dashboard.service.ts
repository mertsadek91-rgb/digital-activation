import { Injectable } from '@nestjs/common';

import {
  CONTACT_REPLY_HOURS,
  QUEUE_OVERDUE_GRACE_SECONDS,
  type AdminDashboard,
  type DashboardAttention,
  type DashboardPoint,
  type DashboardWindow,
} from '@da/contracts';
import {
  ContactStatus,
  FulfillmentMode,
  Locale,
  OrderStatus,
  type Prisma,
  PublishStatus,
  ReviewStatus,
} from '@da/db';

import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { dayKeys, storeDay } from './dashboard-days.js';
import { panelLocale } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Thirty days shown, and thirty behind them to compare against. */
const SHOWN_DAYS = 30;
const SPAN_DAYS = SHOWN_DAYS * 2;

const DAY_MS = 86_400_000;

/**
 * Orders that took money. The definition every figure on this page uses.
 *
 * `paidAt` rather than a status list, because the statuses move on: a paid
 * order becomes FULFILLING, then FULFILLED, then COMPLETED, and an hour of
 * revenue would vanish from a chart as somebody worked the queue. Cancelled
 * and failed are excluded even where a `paidAt` survives on them — that is a
 * payment that was reversed before it was ever a sale.
 */
const PAID: Prisma.OrderWhereInput = {
  paidAt: { not: null },
  status: { notIn: [OrderStatus.CANCELLED, OrderStatus.FAILED] },
};

/**
 * The panel's front page.
 *
 * Every number here was already readable, one screen at a time, which is the
 * whole problem: the person who opens this panel at nine in the morning wants
 * two answers before anything else — how much came in, and what is waiting on
 * me — and getting them meant visiting five screens and knowing which five.
 *
 * Nothing on this page is a new source of truth. The queue's overdue rule is
 * the queue's, asked through the same service so the two screens cannot drift;
 * the inbox's promise is `CONTACT_REPLY_HOURS`, the same constant the inbox
 * counts against. A dashboard that recomputes what another screen already
 * decided is a dashboard that eventually contradicts it, and the contradiction
 * is always discovered by somebody who trusted the wrong one.
 *
 * The launch checks are deliberately *not* gathered in: that screen probes
 * SMTP and the vault on every load, which is right for a readiness check
 * somebody opens on purpose and wrong for a page that opens on every visit.
 * A link is enough.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  /**
   * The store's own clock.
   *
   * A day belongs to the shop, not to the machine. An order placed at one in
   * the morning Riyadh time belongs to that Riyadh day however the server is
   * configured — and bucketing on UTC would move this store's evenings into
   * the following day, which is how "yesterday" quietly stops meaning
   * yesterday.
   */
  private get timeZone(): string {
    return process.env.STORE_TIMEZONE ?? 'Asia/Riyadh';
  }

  /** `YYYY-MM-DD` as the store would write it. Tested in `dashboard-days`. */
  private storeDay(at: Date): string {
    return storeDay(at, this.timeZone);
  }

  async summary(): Promise<AdminDashboard> {
    const now = new Date();
    const today = this.storeDay(now);
    // One day of slack on each side of the sixty: a store timezone ahead of
    // UTC puts its "today" partly in the machine's tomorrow, and a window
    // computed to the hour would clip the day the page leads with.
    const since = new Date(now.getTime() - (SPAN_DAYS + 1) * DAY_MS);

    const [paid, refunds, lifetime, attention, topProducts, recentOrders] = await Promise.all([
      this.prisma.client.order.findMany({
        where: { ...PAID, paidAt: { not: null, gte: since } },
        select: { paidAt: true, totalUsd: true },
      }),
      this.prisma.client.refund.findMany({
        where: { createdAt: { gte: new Date(now.getTime() - SHOWN_DAYS * DAY_MS) } },
        select: { amountUsd: true },
      }),
      this.lifetime(),
      this.attention(),
      this.topProducts(new Date(now.getTime() - SHOWN_DAYS * DAY_MS)),
      this.recentOrders(),
    ]);

    // One pass into calendar buckets, which every window below then reads.
    // Querying each span separately would ask the database the same question
    // six times and still risk two of the answers disagreeing at a midnight.
    const byDay = new Map<string, { revenue: number; orders: number }>();
    for (const order of paid) {
      if (!order.paidAt) continue;
      const day = this.storeDay(order.paidAt);
      const bucket = byDay.get(day) ?? { revenue: 0, orders: 0 };
      bucket.revenue += Number(order.totalUsd);
      bucket.orders += 1;
      byDay.set(day, bucket);
    }

    const keys = dayKeys(today, SPAN_DAYS);
    const shown = keys.slice(SPAN_DAYS - SHOWN_DAYS);

    const daily: DashboardPoint[] = shown.map((date) => {
      const bucket = byDay.get(date);
      return {
        date,
        revenueUsd: (bucket?.revenue ?? 0).toFixed(2),
        orders: bucket?.orders ?? 0,
      };
    });

    const window = (days: number): DashboardWindow => {
      const current = keys.slice(keys.length - days);
      const previous = keys.slice(keys.length - days * 2, keys.length - days);
      const sum = (span: string[]) =>
        span.reduce(
          (total, date) => {
            const bucket = byDay.get(date);
            return {
              revenue: total.revenue + (bucket?.revenue ?? 0),
              orders: total.orders + (bucket?.orders ?? 0),
            };
          },
          { revenue: 0, orders: 0 },
        );

      const nowSpan = sum(current);
      const thenSpan = sum(previous);
      return {
        revenueUsd: nowSpan.revenue.toFixed(2),
        orders: nowSpan.orders,
        previousRevenueUsd: thenSpan.revenue.toFixed(2),
        previousOrders: thenSpan.orders,
      };
    };

    const last30 = window(SHOWN_DAYS);
    const orders30 = last30.orders;

    return {
      generatedAt: now.toISOString(),
      timeZone: this.timeZone,
      today: window(1),
      last7: window(7),
      last30,
      // Null rather than zero with nothing sold: an average of no orders is
      // not "$0.00 per order", it is a question that has no answer yet.
      averageOrderUsd: orders30 === 0 ? null : (Number(last30.revenueUsd) / orders30).toFixed(2),
      refundedUsd: refunds.reduce((total, row) => total + Number(row.amountUsd), 0).toFixed(2),
      daily,
      attention,
      topProducts,
      recentOrders,
      lifetime,
    };
  }

  private async lifetime(): Promise<AdminDashboard['lifetime']> {
    const [orders, revenue, customers] = await Promise.all([
      this.prisma.client.order.count({ where: PAID }),
      this.prisma.client.order.aggregate({ where: PAID, _sum: { totalUsd: true } }),
      this.prisma.client.customer.count(),
    ]);

    return {
      orders,
      revenueUsd: Number(revenue._sum?.totalUsd ?? 0).toFixed(2),
      customers,
    };
  }

  /**
   * What is waiting on a person, in the order it should be dealt with.
   *
   * The queue's rows are asked of the queue's own service and judged by the
   * queue's own rule — `deliverySlaSeconds` is per-line and per-product, so a
   * six-hour promise is not late at two hours while a fifteen-minute one is.
   * Copying that rule here would have meant two screens disagreeing about
   * which customer is owed an apology.
   *
   * Rows with nothing in them are dropped rather than shown as zero. A list of
   * eight zeroes is a list nobody reads, and the whole value of this block is
   * that a non-empty row means something.
   */
  private async attention(): Promise<DashboardAttention[]> {
    const overdueBefore = new Date(Date.now() - CONTACT_REPLY_HOURS * 3600 * 1000);

    const [queue, paymentReview, awaitingPayment, messages, messagesOverdue, reviews, stocked] =
      await Promise.all([
        this.fulfillment.queue({ limit: 500, includeDone: false }),
        this.prisma.client.order.count({ where: { status: OrderStatus.PAYMENT_REVIEW } }),
        this.prisma.client.order.count({ where: { status: OrderStatus.PENDING_PAYMENT } }),
        this.prisma.client.contactMessage.count({ where: { status: ContactStatus.NEW } }),
        this.prisma.client.contactMessage.count({
          where: { status: ContactStatus.NEW, createdAt: { lt: overdueBefore } },
        }),
        this.prisma.client.review.count({ where: { status: ReviewStatus.PENDING } }),
        this.prisma.client.variant.findMany({
          where: {
            status: PublishStatus.PUBLISHED,
            product: { status: PublishStatus.PUBLISHED },
            fulfillmentMode: FulfillmentMode.FROM_STOCK,
          },
          select: { inventory: { select: { onHand: true, reserved: true } } },
        }),
      ]);

    const now = Date.now();
    const overdueLines = queue.filter((row) => {
      const paidAt = row.paidAt ?? row.placedAt;
      const waitingSeconds = Math.max(0, Math.floor((now - paidAt.getTime()) / 1000));
      return waitingSeconds > row.deliverySlaSeconds + QUEUE_OVERDUE_GRACE_SECONDS;
    }).length;

    const outOfStock = stocked.filter(
      (variant) => (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0) <= 0,
    ).length;

    const rows: DashboardAttention[] = [
      { key: 'queueOverdue', count: overdueLines, severity: 'urgent', fix: '/queue' },
      {
        key: 'queueWaiting',
        count: queue.length - overdueLines,
        severity: 'due',
        fix: '/queue',
      },
      // Money the store is holding without having delivered anything, and
      // without the customer being at fault: a human has to look at each one.
      { key: 'paymentReview', count: paymentReview, severity: 'urgent', fix: '/orders' },
      { key: 'messagesOverdue', count: messagesOverdue, severity: 'urgent', fix: '/messages' },
      { key: 'awaitingPayment', count: awaitingPayment, severity: 'due', fix: '/orders' },
      { key: 'messages', count: messages - messagesOverdue, severity: 'due', fix: '/messages' },
      { key: 'outOfStock', count: outOfStock, severity: 'due', fix: '/vault' },
      // Last and idle: an unread review costs the store a little conversion,
      // not a customer standing at a counter.
      { key: 'reviews', count: reviews, severity: 'idle', fix: '/reviews' },
    ];

    return rows.filter((row) => row.count > 0);
  }

  /**
   * What sold, over the shown window.
   *
   * Grouped by variant rather than by product: this catalog's variants are the
   * thing that is bought — a one-year single-device Windows 11 Pro is a
   * different decision from a lifetime five-device one, and rolling them
   * together would hide which of the two the store actually sells.
   *
   * The name is read in the reader's language and falls back to the snapshot
   * on the order line, which is the name as it was sold. A missing English
   * translation then shows the Arabic name rather than a blank row.
   */
  private async topProducts(since: Date): Promise<AdminDashboard['topProducts']> {
    const locale = panelLocale() === 'en' ? Locale.EN : Locale.AR;

    const items = await this.prisma.client.orderItem.findMany({
      where: { order: { ...PAID, paidAt: { not: null, gte: since } } },
      select: {
        qty: true,
        lineTotalUsd: true,
        productNameSnapshot: true,
        skuSnapshot: true,
        variant: {
          select: {
            sku: true,
            product: {
              select: {
                slug: true,
                translations: { where: { locale }, select: { name: true } },
              },
            },
          },
        },
      },
    });

    const bySku = new Map<
      string,
      { sku: string; slug: string; name: string; qty: number; revenue: number }
    >();

    for (const item of items) {
      const sku = item.variant?.sku ?? item.skuSnapshot;
      const row = bySku.get(sku) ?? {
        sku,
        slug: item.variant?.product.slug ?? '',
        name: item.variant?.product.translations[0]?.name ?? item.productNameSnapshot,
        qty: 0,
        revenue: 0,
      };
      row.qty += item.qty;
      row.revenue += Number(item.lineTotalUsd);
      bySku.set(sku, row);
    }

    return [...bySku.values()]
      .sort((left, right) => right.revenue - left.revenue)
      .slice(0, 6)
      .map((row) => ({
        sku: row.sku,
        slug: row.slug,
        name: row.name,
        qty: row.qty,
        revenueUsd: row.revenue.toFixed(2),
      }));
  }

  /**
   * The newest orders, paid or not.
   *
   * Not filtered to paid: an order sitting in PENDING_PAYMENT is exactly the
   * one somebody wants to see from here, and a list that showed only the money
   * that arrived would be silent about the money that did not.
   */
  private async recentOrders(): Promise<AdminDashboard['recentOrders']> {
    const orders = await this.prisma.client.order.findMany({
      orderBy: { placedAt: 'desc' },
      take: 8,
      select: {
        number: true,
        status: true,
        email: true,
        totalUsd: true,
        placedAt: true,
        items: { select: { fulfillmentState: true } },
      },
    });

    return orders.map((order) => ({
      number: order.number,
      status: order.status,
      email: order.email,
      totalUsd: order.totalUsd.toFixed(2),
      placedAt: order.placedAt.toISOString(),
      waitingLines: order.items.filter(
        (item) =>
          item.fulfillmentState === 'MANUAL_QUEUE' || item.fulfillmentState === 'AUTO_ASSIGNED',
      ).length,
    }));
  }
}
