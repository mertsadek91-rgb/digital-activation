import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminOrderDetail, AdminOrderList, AdminOrderRow } from '@da/contracts';
import {
  FulfillmentState,
  Locale,
  OrderEventActor,
  OrderStatus,
  PaymentState,
  type Prisma,
  RiskLevel,
} from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { CheckoutService } from '../checkout/checkout.service.js';
import { recordOrderTransition } from '../checkout/order-status.js';
import { CSV_BOM, csvRow } from '../common/csv.js';
import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Orders, for the panel.
 *
 * The screen this feeds is the one a shop cannot be run without, and it was
 * the last one missing. Two things in particular could not be done at all
 * until now.
 *
 * A bank transfer or a crypto payment lands in somebody's account and nowhere
 * near this system. The storefront tells the customer to send the money and
 * says a person will check — and there was no way for that person to say the
 * money arrived, which meant the only working payment path was a Stripe
 * account that does not exist yet. Confirming one here runs exactly what the
 * Stripe webhook runs: the same `markPaid`, the same fulfilment, the same
 * idempotency. A second confirmation of the same reference changes nothing.
 *
 * And an order note is where a support conversation about an order belongs.
 * The legacy store used order notes as its *delivery mechanism*, which is why
 * its backup is a file full of customer licence keys — so notes here are for
 * what was agreed, never for what was delivered.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly fulfillment: FulfillmentService,
    private readonly audit: AuditService,
  ) {}

  private readonly include = {
    customer: { select: { firstName: true, lastName: true } },
    payments: true,
    items: { select: { id: true, fulfillmentState: true } },
  } satisfies Prisma.OrderInclude;

  async list(input: {
    status?: string;
    q?: string;
    limit: number;
    page: number;
  }): Promise<AdminOrderList> {
    const status = this.statusFilter(input.status);
    const search: Prisma.OrderWhereInput = input.q
      ? {
          OR: [
            { number: { contains: input.q, mode: 'insensitive' } },
            { email: { contains: input.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const orders = await this.prisma.client.order.findMany({
      where: { AND: [status, search] },
      // Newest first: an order list is read from the top, and the thing that
      // just happened is the thing somebody is looking for.
      orderBy: [{ placedAt: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      // One more than a page, so "is there a next page" costs no count query.
      take: input.limit + 1,
      include: this.include,
    });
    const hasMore = orders.length > input.limit;

    return {
      rows: orders.slice(0, input.limit).map((order) => this.toRow(order)),
      page: input.page,
      hasMore,
      counts: {
        all: await this.prisma.client.order.count(),
        awaitingPayment: await this.prisma.client.order.count({
          where: { status: OrderStatus.PENDING_PAYMENT },
        }),
        paid: await this.prisma.client.order.count({
          where: { status: { in: [OrderStatus.PAID, OrderStatus.FULFILLING] } },
        }),
        inReview: await this.prisma.client.order.count({
          where: { status: OrderStatus.PAYMENT_REVIEW },
        }),
      },
    };
  }

  async detail(number: string): Promise<AdminOrderDetail> {
    const order = await this.prisma.client.order.findUnique({
      where: { number },
      include: {
        ...this.include,
        items: true,
        notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
        statusEvents: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order)
      throw new NotFoundException(
        say(`لا يوجد طلب بالرقم ${number}`, `No order numbered ${number}`),
      );

    // Staff are named rather than shown as ids. The event carries no foreign
    // key (so deleting an account does not rewrite history), hence the lookup.
    const staffIds = [
      ...new Set(
        order.statusEvents
          .filter((event) => event.actorType === OrderEventActor.STAFF && event.actorId)
          .map((event) => event.actorId as string),
      ),
    ];
    const staff =
      staffIds.length > 0
        ? await this.prisma.client.staffUser.findMany({
            where: { id: { in: staffIds } },
            select: { id: true, name: true },
          })
        : [];
    const staffName = new Map(staff.map((member) => [member.id, member.name]));

    return {
      ...this.toRow(order),
      history: order.statusEvents.map((event) => ({
        id: event.id,
        from: event.from,
        to: event.to,
        actorType: event.actorType,
        actor:
          event.actorType === OrderEventActor.STAFF
            ? (staffName.get(event.actorId ?? '') ?? event.actorId)
            : event.actorId,
        reason: event.reason,
        createdAt: event.createdAt.toISOString(),
      })),
      activationEmail: order.activationEmail,
      couponCode: order.couponCode,
      locale: order.locale === Locale.EN ? 'en' : 'ar',
      lines: order.items.map((item) => ({
        orderItemId: item.id,
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        qty: item.qty,
        lineTotal: item.lineTotalUsd.toFixed(2),
        fulfillmentState: item.fulfillmentState,
        deliveredAt: item.deliveredAt?.toISOString() ?? null,
      })),
      notes: order.notes.map((note) => ({
        id: note.id,
        body: note.body,
        author: note.author?.name ?? null,
        isCustomerVisible: note.isCustomerVisible,
        createdAt: note.createdAt.toISOString(),
      })),
      emails: await this.emailsFor(order.number),
    };
  }

  /**
   * Every message this order caused.
   *
   * Matched on the order number inside the payload rather than on a foreign
   * key, because `NotificationLog` deliberately has none to an order: it is a
   * log of what was sent to an address, and some of what it holds was sent to
   * somebody who is not a customer row at all. The same path `alreadySent`
   * matches on.
   *
   * Nothing here can carry a licence: the payload is template variables, and a
   * key has never been one of them.
   */
  private async emailsFor(number: string): Promise<AdminOrderDetail['emails']> {
    const rows = await this.prisma.client.notificationLog.findMany({
      where: { payload: { path: ['orderNumber'], equals: number } },
      orderBy: { sentAt: 'desc' },
      take: 50,
      select: {
        template: true,
        toAddress: true,
        sentAt: true,
        deliveredAt: true,
        bouncedAt: true,
        error: true,
      },
    });

    return rows.map((row) => ({
      template: row.template,
      to: row.toAddress,
      sentAt: row.sentAt.toISOString(),
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      bouncedAt: row.bouncedAt?.toISOString() ?? null,
      error: row.error,
    }));
  }

  /**
   * Sends a licence email again, at a member of staff's request.
   *
   * The single most common thing a customer writes in about, and until now it
   * was unanswerable from this panel: the customer's own page could resend and
   * nobody here could, so the workaround was to read the key out of the vault
   * by hand and paste it into a reply. That puts a plaintext licence in a chat
   * window, which is the one outcome this whole system is built to avoid.
   *
   * The address is not a parameter. `resendLicence` reads it from the order,
   * so this cannot be used to send somebody else's licence somewhere else —
   * and the vault records a RESEND against the member of staff who asked.
   */
  async resendLicence(input: {
    number: string;
    orderItemId: string;
    staffId: string;
    /** The session's last TOTP challenge, in unix seconds. The vault reads it. */
    totpAt: number;
    context: { ip?: string | undefined; userAgent?: string | undefined };
  }): Promise<{ to: string }> {
    const item = await this.prisma.client.orderItem.findFirst({
      // Scoped to the order in the URL: a line id alone would let any order
      // number in the path stand in front of any line in the database.
      where: { id: input.orderItemId, order: { number: input.number } },
      select: { id: true },
    });
    if (!item)
      throw new NotFoundException(
        say('لا يوجد هذا البند في هذا الطلب.', 'That line is not on this order.'),
      );

    const result = await this.fulfillment.resendLicence({
      orderItemId: item.id,
      actor: {
        staffId: input.staffId,
        totpAt: input.totpAt,
        ip: input.context.ip,
        userAgent: input.context.userAgent,
      },
    });

    await this.audit.record({
      actorId: input.staffId,
      entity: 'Order',
      entityId: input.number,
      action: 'licence.resent',
      // The address is on the order and already in this row's entity; naming
      // it again here is what makes the audit answer "sent where" on its own.
      after: { orderItemId: item.id, to: result.to },
      ip: input.context.ip,
      userAgent: input.context.userAgent,
    });

    return result;
  }

  /**
   * Confirms money that arrived outside the store, and releases the order.
   *
   * Runs the same path as the Stripe webhook rather than a parallel one: the
   * payment row, the stock holds, the customer aggregates and the fulfilment
   * trigger are all one piece of logic, and a second copy of it here would be
   * a second place for them to drift apart.
   */
  async confirmPayment(input: {
    number: string;
    provider: 'BANK_TRANSFER' | 'CRYPTO';
    reference: string;
    staffId: string;
    context: { ip?: string | undefined; userAgent?: string | undefined };
  }): Promise<{ status: string; alreadyApplied: boolean }> {
    const order = await this.prisma.client.order.findUnique({
      where: { number: input.number },
      select: { status: true, totalUsd: true, currency: true },
    });
    if (!order)
      throw new NotFoundException(
        say(`لا يوجد طلب بالرقم ${input.number}`, `No order numbered ${input.number}`),
      );

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        say(
          `هذا الطلب في حالة ${order.status}، فلا ينتظر تأكيد دفع. راجِع سجلّ المدفوعات.`,
          `This order is ${order.status}, so it is not awaiting a payment confirmation. Check the payments log.`,
        ),
      );
    }

    const applied = await this.checkout.markPaid({
      orderNumber: input.number,
      provider: input.provider,
      providerRef: input.reference,
      // What the customer was charged is what the order says; a manual
      // confirmation is not the place to type an amount, because a typo there
      // is a discrepancy nobody finds until the books are closed.
      amountCharged: order.totalUsd.toFixed(2),
      chargedCurrency: 'USD',
      actor: { type: OrderEventActor.STAFF, id: input.staffId },
    });

    if (!applied.alreadyApplied) {
      await this.fulfillment.onOrderPaid(input.number);
    }

    await this.audit.record({
      actorId: input.staffId,
      entity: 'Order',
      entityId: input.number,
      action: 'payment.confirmed',
      after: { provider: input.provider, reference: input.reference, status: applied.status },
      ip: input.context.ip,
      userAgent: input.context.userAgent,
    });

    return { status: applied.status, alreadyApplied: applied.alreadyApplied };
  }

  /**
   * Lifts a hold and lets fulfilment run.
   *
   * Two kinds of hold, one action. An order in PAYMENT_REVIEW has been paid
   * and was stopped by a rule — a risk verdict, an amount that did not match,
   * a coupon that ran out. An order already PAID can still be blocked by its
   * risk level, which is what an open card dispute does. Either way the money
   * is in and the key is not out, and a person has looked and decided.
   *
   * The risk level comes down to MEDIUM rather than LOW, so the order still
   * reads as one that was reviewed. The status change is conditional, so two
   * people clicking at once release it once.
   */
  async releaseHold(input: {
    number: string;
    reason: string;
    staffId: string;
    context: { ip?: string | undefined; userAgent?: string | undefined };
  }): Promise<{ status: string }> {
    const order = await this.prisma.client.order.findUnique({
      where: { number: input.number },
      select: { id: true, status: true, riskLevel: true },
    });
    if (!order)
      throw new NotFoundException(
        say(`لا يوجد طلب بالرقم ${input.number}`, `No order numbered ${input.number}`),
      );

    const inReview = order.status === OrderStatus.PAYMENT_REVIEW;
    const blocked =
      (order.status === OrderStatus.PAID || order.status === OrderStatus.FULFILLING) &&
      (order.riskLevel === RiskLevel.HIGH || order.riskLevel === RiskLevel.BLOCKED);
    if (!inReview && !blocked) {
      throw new BadRequestException(
        say(
          `هذا الطلب في حالة ${order.status} وليس موقوفاً، فلا يوجد ما يُرفع.`,
          `This order is ${order.status} and not on hold, so there is nothing to release.`,
        ),
      );
    }

    // The compare-and-set covers the risk level as well as the status, which
    // `transitionOrder`'s does not, so it stays here and the history row is
    // written beside it in the same transaction.
    const moved = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.order.updateMany({
        where: { id: order.id, status: order.status, riskLevel: order.riskLevel },
        data: {
          riskLevel: RiskLevel.MEDIUM,
          ...(inReview ? { status: OrderStatus.PAID } : {}),
        },
      });
      if (result.count === 1 && inReview) {
        await recordOrderTransition(tx, {
          orderId: order.id,
          from: order.status,
          to: OrderStatus.PAID,
          actor: { type: OrderEventActor.STAFF, id: input.staffId },
          reason: `Hold released: ${input.reason}`,
        });
      }
      return result;
    });
    if (moved.count !== 1) {
      throw new BadRequestException(
        say('تغيّر هذا الطلب للتو. حدّث الصفحة.', 'This order just changed. Refresh the page.'),
      );
    }

    await this.prisma.client.orderNote.create({
      data: {
        orderId: order.id,
        body: `Hold released: ${input.reason}`,
        isCustomerVisible: false,
        authorId: input.staffId,
      },
    });
    await this.audit.record({
      actorId: input.staffId,
      entity: 'Order',
      entityId: input.number,
      action: 'order.hold-released',
      before: { status: order.status, riskLevel: order.riskLevel },
      after: {
        status: inReview ? OrderStatus.PAID : order.status,
        riskLevel: RiskLevel.MEDIUM,
      },
      ip: input.context.ip,
      userAgent: input.context.userAgent,
    });

    if (inReview) await this.fulfillment.onOrderPaid(input.number);

    const after = await this.prisma.client.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    return { status: after.status };
  }

  async refund(input: {
    number: string;
    reason: string;
    staffId: string;
    context: { ip?: string | undefined; userAgent?: string | undefined };
  }): Promise<{ status: string; via: 'stripe' | 'recorded' }> {
    const result = await this.checkout.refundOrder(input);
    await this.audit.record({
      actorId: input.staffId,
      entity: 'Order',
      entityId: input.number,
      action: 'order.refunded',
      after: { via: result.via, status: result.status },
      ip: input.context.ip,
      userAgent: input.context.userAgent,
    });
    return result;
  }

  /**
   * Adds a note to an order.
   *
   * A note is never a delivery. The legacy store pasted licence keys into
   * order notes, which is why its own backup is a file of customer licences —
   * so this records what was agreed, and the key stays in the vault.
   */
  async addNote(input: {
    number: string;
    body: string;
    isCustomerVisible: boolean;
    staffId: string;
  }): Promise<{ id: string }> {
    const order = await this.prisma.client.order.findUnique({
      where: { number: input.number },
      select: { id: true },
    });
    if (!order)
      throw new NotFoundException(
        say(`لا يوجد طلب بالرقم ${input.number}`, `No order numbered ${input.number}`),
      );

    const note = await this.prisma.client.orderNote.create({
      data: {
        orderId: order.id,
        body: input.body,
        isCustomerVisible: input.isCustomerVisible,
        authorId: input.staffId,
      },
    });
    return { id: note.id };
  }

  /**
   * Orders as CSV, for the accountant and for Excel.
   *
   * Batched on the id cursor so a year of orders never sits in memory whole.
   * What is in it is what a set of books needs — number, dates, status, who,
   * where, the money in both currencies, the coupon, the lines by SKU — and
   * what is not is deliberate: no licence key, no vault id, no IP, no note.
   * A spreadsheet is copied, mailed and left on laptops; nothing in this one
   * activates anything.
   *
   * `status` takes the list's filter keys (`paid`, `in-review`…) or a raw
   * status name, so the button can pass whatever the screen is showing.
   */
  async *exportCsv(input: {
    from: Date | null;
    to: Date | null;
    status?: string;
  }): AsyncGenerator<string> {
    yield CSV_BOM;
    yield csvRow([
      'number',
      'placed_at',
      'paid_at',
      'status',
      'email',
      'country',
      'currency',
      'subtotal_usd',
      'discount_usd',
      'total_usd',
      'charged_amount',
      'charged_currency',
      'coupon',
      'items',
    ]);

    const status =
      input.status && (Object.values(OrderStatus) as string[]).includes(input.status)
        ? { status: input.status as OrderStatus }
        : this.statusFilter(input.status);
    const placed =
      input.from || input.to
        ? {
            placedAt: {
              ...(input.from ? { gte: input.from } : {}),
              ...(input.to ? { lte: input.to } : {}),
            },
          }
        : {};

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.client.order.findMany({
        where: { AND: [status, placed] },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          number: true,
          placedAt: true,
          paidAt: true,
          status: true,
          email: true,
          billingCountry: true,
          currency: true,
          subtotalUsd: true,
          discountUsd: true,
          totalUsd: true,
          couponCode: true,
          items: { select: { skuSnapshot: true, qty: true } },
          payments: {
            // A refunded payment was still charged; the status column says
            // it went back.
            where: { state: { in: [PaymentState.SUCCEEDED, PaymentState.REFUNDED] } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { amountCharged: true, chargedCurrency: true },
          },
        },
      });
      if (batch.length === 0) return;
      let chunk = '';
      for (const order of batch) {
        const payment = order.payments[0];
        chunk += csvRow([
          order.number,
          order.placedAt,
          order.paidAt,
          order.status,
          order.email,
          order.billingCountry,
          order.currency,
          order.subtotalUsd.toFixed(2),
          order.discountUsd.toFixed(2),
          order.totalUsd.toFixed(2),
          payment?.amountCharged.toString() ?? null,
          payment?.chargedCurrency ?? null,
          order.couponCode,
          order.items.map((item) => `${item.skuSnapshot} x ${String(item.qty)}`).join('; '),
        ]);
      }
      yield chunk;
      cursor = batch[batch.length - 1]?.id;
      if (batch.length < 500) return;
    }
  }

  private statusFilter(status?: string): Prisma.OrderWhereInput {
    switch (status) {
      case 'awaiting-payment':
        return { status: OrderStatus.PENDING_PAYMENT };
      case 'in-review':
        return { status: OrderStatus.PAYMENT_REVIEW };
      case 'paid':
        return { status: { in: [OrderStatus.PAID, OrderStatus.FULFILLING] } };
      case 'done':
        return { status: { in: [OrderStatus.FULFILLED, OrderStatus.COMPLETED] } };
      default:
        return {};
    }
  }

  private toRow(
    order: Prisma.OrderGetPayload<{ include: OrdersService['include'] }>,
  ): AdminOrderRow {
    const name = [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ');

    return {
      number: order.number,
      status: order.status,
      email: order.email,
      customerName: name.length > 0 ? name : null,
      currency: order.currency,
      total: order.totalUsd.toFixed(2),
      totalUsd: order.totalUsd.toFixed(2),
      itemCount: order.items.length,
      waitingLines: order.items.filter(
        (item) =>
          item.fulfillmentState !== FulfillmentState.DELIVERED &&
          item.fulfillmentState !== FulfillmentState.FAILED,
      ).length,
      riskLevel: order.riskLevel,
      placedAt: order.placedAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
      payments: order.payments.map((payment) => ({
        provider: payment.provider,
        state: payment.state,
        reference: payment.providerRef,
        // Three places for the currencies counted in thousandths.
        amount: payment.amountCharged.toFixed(
          ['BHD', 'JOD', 'KWD', 'OMR', 'TND'].includes(payment.chargedCurrency) ? 3 : 2,
        ),
        currency: payment.chargedCurrency,
        createdAt: payment.createdAt.toISOString(),
      })),
    };
  }
}
