import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type {
  AdminFpEventList,
  AdminFpOrderPayment,
  FpPaymentStatus,
  FpWebhookResult,
  PaymentSession,
  RefundOrderResult,
} from '@da/contracts';
import {
  ActorType,
  Locale,
  OrderStatus,
  PaymentProvider,
  PaymentState,
  Prisma,
  RefundStatus,
} from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { CheckoutService } from './checkout.service.js';
import { toMinor, type WebhookEvent } from './final-processor.js';
import {
  FinalProcessorService,
  fpAdminMessage,
  fpCustomerMessage,
  fpErrorCode,
  isTransientFpCode,
} from './final-processor.service.js';
import { transitionOrder } from './order-status.js';
import { PaymentSettingsService } from './payment-settings.service.js';
import { recordRefundOutcome } from './refund-outcome.js';

/**
 * Final Processor payments: starting one, the webhook, the return page's
 * check, and refunds from the panel (contract Part A; capabilities B.1, B.4).
 *
 * Three rules shape everything here.
 *
 *  - The charge is always the order's USD total, in cents, from the order
 *    row (A.2.2–A.2.4). Nothing about money is read from a request.
 *  - An order is paid only on a verified webhook or our own `getPayment()`,
 *    and only when payment_id, order_ref, amount and currency all equal what
 *    this shop stored (A.2.5). Anything else is refused, recorded and flagged
 *    — never "paid, but held".
 *  - Nothing about the customer goes into a log line: ids and order numbers
 *    only, never an email.
 */

/** Where money has been received, for the return page. */
const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PAYMENT_REVIEW,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
  OrderStatus.REFUNDED,
];

/** The statuses the panel may refund from — the same list as `refundOrder`. */
const REFUNDABLE: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PAYMENT_REVIEW,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];

const OPEN_STATES: PaymentState[] = [PaymentState.PROCESSING, PaymentState.REQUIRES_ACTION];

/** The template `sendTransferInstructions` records: the shopper chose a bank transfer. */
const TRANSFER_TEMPLATE = 'order.transfer-instructions';

const EVENTS_PER_PAGE = 50;

/** What the processor says about a payment: a webhook's `data`, or `getPayment()`. */
interface PaymentSnapshot {
  payment_id: string;
  order_ref: string;
  status: string;
  amount_minor: string;
  currency: string;
  test_mode: boolean;
  /** Minor units already refunded, as the processor reports it. */
  refunded_minor: string;
}

/** `"2550"` → `"25.50"`. String arithmetic only. */
export function minorToUsd(minor: string): string {
  if (!/^\d+$/.test(minor)) throw new Error(`Not a minor-unit amount: ${minor}`);
  const digits = minor.replace(/^0+(?=\d)/, '').padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** The USD total of an order, in cents, as the processor is asked to charge it. */
export function usdMinor(amount: Prisma.Decimal): string {
  return toMinor(amount.toFixed(2), 'USD');
}

/** The order number as the processor accepts it: letters, digits, - and _, at most 32. */
export function fpOrderNumber(number: string): string | undefined {
  const cleaned = number.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return cleaned === '' ? undefined : cleaned;
}

function refundStatusFrom(status: string | undefined): RefundStatus {
  if (status === 'succeeded') return RefundStatus.SUCCEEDED;
  if (status === 'failed') return RefundStatus.FAILED;
  return RefundStatus.PENDING;
}

@Injectable()
export class FpPaymentsService {
  private readonly logger = new Logger(FpPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fp: FinalProcessorService,
    private readonly checkout: CheckoutService,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly fulfillment: FulfillmentService,
    private readonly audit: AuditService,
  ) {}

  // --- starting a payment (A.1, B.1) ---------------------------------------

  /**
   * Opens a Final Processor payment for a pending order and returns where to
   * send the browser.
   *
   * The caller has already established the order is the requester's and is
   * PENDING_PAYMENT. The method must be enabled in this shop *and* returned
   * by the processor right now. The amount is the order's USD total —
   * whatever currency the page was showing.
   */
  async start(number: string, method: string): Promise<PaymentSession> {
    const order = await this.prisma.client.order.findUnique({
      where: { number },
      select: { id: true, number: true, status: true, email: true, totalUsd: true, locale: true },
    });
    if (!order) throw new NotFoundException(`لا يوجد طلب بالرقم ${number}`);
    const locale = order.locale === Locale.EN ? 'en' : 'ar';
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('هذا الطلب لم يعد في انتظار الدفع.');
    }

    const siteUrl = this.fp.siteUrl;
    if (!this.fp.configured || !siteUrl) throw customerError(503, locale, 'unavailable');

    const offered = await this.paymentSettings.finalProcessorMethods(locale);
    if (!offered.some((entry) => entry.id === method)) {
      throw customerError(400, locale, 'unavailable');
    }

    const amountMinor = usdMinor(order.totalUsd);
    const path = encodeURIComponent(order.number);
    let created;
    try {
      created = await this.fp.createPayment({
        orderRef: order.id,
        orderNumber: fpOrderNumber(order.number),
        amountMinor,
        currency: 'USD',
        method,
        customerEmail: order.email,
        returnUrl: `${siteUrl}/${locale}/checkout/return/${path}`,
        cancelUrl: `${siteUrl}/${locale}/checkout`,
      });
    } catch (error) {
      const code = fpErrorCode(error);
      this.logger.warn(`Final Processor refused a payment for order ${order.number}: ${code}`);
      if (code === 'order_ref_conflict') {
        // Same order id, different amount, and the old payment still open
        // (A.6). The id cannot change, so the order does: this draft closes,
        // and the checkout drafts a new one from the same cart.
        await this.checkout.retireDraft(
          order.id,
          'Final Processor: order_ref_conflict (the order changed while a payment was open).',
        );
        throw customerError(409, locale, 'order_changed');
      }
      if (code === 'method_unavailable') {
        this.fp.invalidate();
        throw customerError(400, locale, 'unavailable');
      }
      if (isTransientFpCode(code)) throw customerError(503, locale, 'retry');
      throw customerError(503, locale, 'unavailable');
    }

    // Keyed on the processor's payment id; the call is idempotent on
    // order_ref, so a second click returns the same payment and records nothing.
    const recorded = await this.prisma.client.payment.upsert({
      where: {
        provider_providerRef: {
          provider: PaymentProvider.FINAL_PROCESSOR,
          providerRef: created.payment_id,
        },
      },
      update: {},
      create: {
        orderId: order.id,
        provider: PaymentProvider.FINAL_PROCESSOR,
        state: PaymentState.PROCESSING,
        providerRef: created.payment_id,
        amountCharged: order.totalUsd,
        chargedCurrency: 'USD',
        amountUsd: order.totalUsd,
      },
      select: { orderId: true },
    });
    if (recorded.orderId !== order.id) {
      // A payment id this shop already holds for another order. Never send
      // the customer to pay it.
      this.logger.error(
        `Final Processor returned payment ${created.payment_id} for order ${order.number}, but it belongs to another order.`,
      );
      throw customerError(503, locale, 'unavailable');
    }

    return {
      provider: 'FINAL_PROCESSOR',
      // Untouched: a parameter added here would reach the gateway (A.2.9).
      redirectUrl: created.redirect_url,
      amount: {
        amount: order.totalUsd.toFixed(2),
        currency: 'USD',
        compareAt: null,
        discountPercent: null,
      },
    };
  }

  // --- the webhook (A.2.7, A.5) --------------------------------------------

  /**
   * One verified event, processed once.
   *
   * `WebhookEvent`'s unique (provider, event id) is the idempotency record: a
   * delivery already processed changes nothing and is answered 2xx. A failure
   * is recorded and rethrown, so the answer is 5xx and the processor retries;
   * the unprocessed row makes that retry do the work. Every delivery gets a
   * row in the admin's log (B.5).
   */
  async processEvent(event: WebhookEvent): Promise<FpWebhookResult> {
    const data = event.data;
    const logged = await this.checkout.beginWebhook({
      provider: PaymentProvider.FINAL_PROCESSOR,
      eventId: event.event_id,
      type: event.type,
      payload: {
        paymentId: data.payment_id ?? null,
        orderRef: data.order_ref ?? null,
        refundId: data.refund?.refund_id ?? null,
      },
    });
    if (logged.processed) {
      await this.log(event, 'duplicate');
      return 'duplicate';
    }

    let result: FpWebhookResult;
    try {
      result = await this.apply(event);
      await this.checkout.finishWebhook(logged.id);
    } catch (error) {
      await this.checkout.finishWebhook(logged.id, error).catch(() => undefined);
      await this.log(event, 'error');
      this.logger.error(
        `Final Processor event ${event.event_id} (${event.type}) failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
      throw error;
    }
    await this.log(event, result);
    return result;
  }

  private async apply(event: WebhookEvent): Promise<FpWebhookResult> {
    const data = event.data;
    switch (event.type) {
      case 'payment.succeeded':
        return (await this.applySuccess(snapshotOf(data), 'webhook')).result;
      case 'payment.failed':
        return this.applyFailure(snapshotOf(data));
      case 'payment.refunded':
        return this.applyRefunded(event);
      case 'refund.failed':
        return this.applyRefundFailed(event);
      default:
        // Acknowledged, not acted on: a non-2xx for an event we do not handle
        // would be retried for three days.
        return 'applied';
    }
  }

  /**
   * A.2.5: the only way an order becomes paid through Final Processor.
   *
   * Every field is compared with what this shop stored before anything is
   * written. On any difference nothing is marked paid; the payment is audited,
   * logged as an error and noted on the order for staff.
   */
  private async applySuccess(
    snapshot: PaymentSnapshot,
    source: 'webhook' | 'status_check',
  ): Promise<{ result: 'applied' | 'mismatch'; status?: OrderStatus }> {
    const payment = await this.findPayment(snapshot.payment_id);
    if (!payment) {
      this.logger.error(
        `Final Processor reported payment ${snapshot.payment_id} (${source}), which this shop never opened.`,
      );
      return { result: 'mismatch' };
    }

    const problems: string[] = [];
    if (snapshot.order_ref !== payment.order.id) problems.push('order_ref');
    if (snapshot.currency !== 'USD') problems.push('currency');
    if (String(snapshot.amount_minor) !== usdMinor(payment.order.totalUsd)) {
      problems.push('amount_minor');
    }
    if (snapshot.status !== 'succeeded' && snapshot.status !== 'refunded') {
      problems.push('status');
    }
    if (problems.length > 0) {
      await this.flag(payment, 'payment.fp.mismatch', {
        paymentId: snapshot.payment_id,
        fields: problems,
        source,
      });
      return { result: 'mismatch' };
    }

    const applied = await this.checkout.markPaid({
      orderNumber: payment.order.number,
      provider: 'FINAL_PROCESSOR',
      providerRef: snapshot.payment_id,
      amountCharged: payment.order.totalUsd.toFixed(2),
      chargedCurrency: 'USD',
      amountMinor: Number(snapshot.amount_minor),
      testMode: snapshot.test_mode === true,
      // Events can arrive out of order (A.2.7): a refund landing before the
      // success must not let the success release keys for returned money.
      refunded:
        snapshot.status === 'refunded' ||
        (/^\d+$/.test(snapshot.refunded_minor) && BigInt(snapshot.refunded_minor) > 0n) ||
        payment.state === PaymentState.REFUNDED ||
        payment._count.refunds > 0,
    });

    // Money arrived for an order this shop had already closed — a draft
    // retired while its payment page was still open. It is recorded as
    // received and flagged: somebody has to refund it or honour it.
    if (applied.status === OrderStatus.CANCELLED || applied.status === OrderStatus.FAILED) {
      await this.flag(payment, 'payment.fp.closed-order', {
        paymentId: snapshot.payment_id,
        status: applied.status,
        source,
      });
      return { result: 'mismatch', status: applied.status };
    }

    // As Stripe does: fulfilment is idempotent by line state and refuses
    // anything but PAID. The webhook runs it on every delivery that gets here
    // (each event gets here once); the return page's check only when it is
    // the call that moved the order.
    if (applied.status === OrderStatus.PAID && (source === 'webhook' || !applied.alreadyApplied)) {
      await this.fulfillment.onOrderPaid(payment.order.number);
    }
    return { result: 'applied', status: applied.status };
  }

  /**
   * The payment session expired unpaid. If the order is still pending and
   * nothing else is paying for it, it is closed; the customer pays again with
   * a new order, from the same cart.
   */
  private async applyFailure(snapshot: PaymentSnapshot): Promise<FpWebhookResult> {
    const payment = await this.findPayment(snapshot.payment_id);
    if (!payment) {
      this.logger.error(
        `Final Processor reported a failure for unknown payment ${snapshot.payment_id}.`,
      );
      return 'mismatch';
    }
    if (snapshot.order_ref !== payment.order.id) {
      await this.flag(payment, 'payment.fp.mismatch', {
        paymentId: snapshot.payment_id,
        fields: ['order_ref'],
        source: 'webhook',
      });
      return 'mismatch';
    }

    await this.prisma.client.payment.updateMany({
      where: { id: payment.id, state: { in: OPEN_STATES } },
      data: {
        state: PaymentState.FAILED,
        failureCode: 'expired',
        testMode: snapshot.test_mode === true,
      },
    });

    if (payment.order.status !== OrderStatus.PENDING_PAYMENT) return 'applied';

    // Not while anything else is paying for it: another open or succeeded
    // payment, or a bank transfer the customer was sent the details for —
    // those arrive days later, against this same order.
    const [otherPayments, transfer] = await Promise.all([
      this.prisma.client.payment.count({
        where: {
          orderId: payment.order.id,
          id: { not: payment.id },
          state: { in: [...OPEN_STATES, PaymentState.SUCCEEDED] },
        },
      }),
      this.prisma.client.notificationLog.count({
        where: {
          template: TRANSFER_TEMPLATE,
          payload: { path: ['orderNumber'], equals: payment.order.number },
        },
      }),
    ]);
    if (otherPayments > 0 || transfer > 0) return 'applied';

    await this.prisma.client.$transaction(async (tx) => {
      await transitionOrder(tx, {
        orderId: payment.order.id,
        from: OrderStatus.PENDING_PAYMENT,
        to: OrderStatus.CANCELLED,
        actor: { type: 'PROVIDER', id: snapshot.payment_id },
        reason: 'Final Processor: the payment session expired unpaid',
        data: { cancelledAt: new Date() },
        ifIllegal: 'skip',
      });
    });
    return 'applied';
  }

  /**
   * A refund completed (A.5): recorded once by refund_id; a refund this shop
   * started is found by its refund_ref and only updated.
   */
  private async applyRefunded(event: WebhookEvent): Promise<FpWebhookResult> {
    const data = event.data;
    const payment = await this.findPayment(data.payment_id);
    if (!payment) {
      this.logger.error(`Final Processor reported a refund on unknown payment ${data.payment_id}.`);
      return 'mismatch';
    }
    if (data.order_ref !== payment.order.id) {
      await this.flag(payment, 'payment.fp.mismatch', {
        paymentId: data.payment_id,
        fields: ['order_ref'],
        source: 'webhook',
      });
      return 'mismatch';
    }

    const fullyRefunded = data.status === 'refunded';
    const refund = data.refund;
    await this.prisma.client.$transaction(async (tx) => {
      if (refund?.refund_id) {
        await this.upsertRefund(tx, payment.id, {
          refundId: refund.refund_id,
          refundRef: refund.refund_ref,
          amountMinor: refund.amount_minor,
          status: refundStatusFrom(refund.status ?? 'succeeded'),
          failureCode: null,
        });
      }
      await this.raiseRefunded(tx, payment.id, data.refunded_minor);
      if (fullyRefunded) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { state: PaymentState.REFUNDED },
        });
      }
      await tx.payment.update({
        where: { id: payment.id },
        data: { testMode: data.test_mode === true },
      });
      await recordRefundOutcome(tx, {
        orderId: payment.order.id,
        fullyRefunded,
        actor: { type: 'PROVIDER', id: refund?.refund_id ?? data.payment_id },
        label: 'Refunded in Final Processor',
        delivered: await this.deliveredSkus(tx, payment.order.id),
        note: 'on_change',
      });
    });
    return 'applied';
  }

  /** The gateway rejected a refund: marked failed, and staff are told. */
  private async applyRefundFailed(event: WebhookEvent): Promise<FpWebhookResult> {
    const data = event.data;
    const payment = await this.findPayment(data.payment_id);
    if (!payment || !data.refund?.refund_id) {
      this.logger.error(
        `Final Processor reported a failed refund on unknown payment ${data.payment_id}.`,
      );
      return 'mismatch';
    }
    const refund = data.refund;
    const row = await this.prisma.client.$transaction((tx) =>
      this.upsertRefund(tx, payment.id, {
        refundId: refund.refund_id,
        refundRef: refund.refund_ref,
        amountMinor: refund.amount_minor,
        status: RefundStatus.FAILED,
        failureCode: 'refund_failed',
      }),
    );
    await this.flag(payment, 'payment.fp.refund-failed', {
      paymentId: data.payment_id,
      refundId: refund.refund_id,
      refundRowId: row.id,
    });
    return 'applied';
  }

  /** Finds a refund by the processor's id or by our own reference, and brings it up to date. */
  private async upsertRefund(
    tx: Prisma.TransactionClient,
    paymentId: string,
    input: {
      refundId: string;
      refundRef: string | undefined;
      amountMinor: string;
      status: RefundStatus;
      failureCode: string | null;
    },
  ): Promise<{ id: string; created: boolean }> {
    const existing = await tx.refund.findFirst({
      where: {
        paymentId,
        OR: [
          { providerRef: input.refundId },
          ...(input.refundRef ? [{ refundRef: input.refundRef }] : []),
        ],
      },
      select: { id: true },
    });
    const amountUsd = minorToUsd(String(input.amountMinor));
    if (existing) {
      await tx.refund.update({
        where: { id: existing.id },
        data: {
          providerRef: input.refundId,
          status: input.status,
          amountUsd,
          ...(input.failureCode ? { failureCode: input.failureCode } : {}),
        },
      });
      return { id: existing.id, created: false };
    }
    // A reference only when nothing else holds it; ours are the rows' own ids.
    const refTaken = input.refundRef
      ? await tx.refund.findUnique({ where: { refundRef: input.refundRef }, select: { id: true } })
      : null;
    const created = await tx.refund.create({
      data: {
        paymentId,
        amountUsd,
        providerRef: input.refundId,
        refundRef: input.refundRef && !refTaken ? input.refundRef : null,
        status: input.status,
        failureCode: input.failureCode,
        reason: 'Refunded in Final Processor',
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  }

  /** Refunded totals only go up: refund events can arrive out of order. */
  private async raiseRefunded(
    tx: Prisma.TransactionClient,
    paymentId: string,
    refundedMinor: string | undefined,
  ): Promise<void> {
    if (refundedMinor === undefined || !/^\d+$/.test(String(refundedMinor))) return;
    const refundedUsd = new Prisma.Decimal(minorToUsd(String(refundedMinor)));
    await tx.payment.updateMany({
      where: { id: paymentId, refundedUsd: { lt: refundedUsd } },
      data: { refundedUsd },
    });
  }

  private async deliveredSkus(tx: Prisma.TransactionClient, orderId: string): Promise<string[]> {
    const items = await tx.orderItem.findMany({
      where: { orderId, deliveredAt: { not: null } },
      select: { skuSnapshot: true },
    });
    return items.map((item) => item.skuSnapshot);
  }

  private findPayment(paymentId: string | undefined) {
    if (!paymentId) return Promise.resolve(null);
    return this.prisma.client.payment.findUnique({
      where: {
        provider_providerRef: { provider: PaymentProvider.FINAL_PROCESSOR, providerRef: paymentId },
      },
      select: {
        id: true,
        state: true,
        _count: { select: { refunds: true } },
        order: { select: { id: true, number: true, status: true, totalUsd: true } },
      },
    });
  }

  /**
   * Something staff must look at: an audit row, an error in the log (ids
   * only), and a staff-only note on the order, which is where the panel shows
   * it.
   */
  private async flag(
    payment: { id: string; order: { id: string; number: string } },
    action: 'payment.fp.mismatch' | 'payment.fp.closed-order' | 'payment.fp.refund-failed',
    detail: Record<string, string | string[]>,
  ): Promise<void> {
    const notes: Record<typeof action, string> = {
      'payment.fp.mismatch': `Final Processor reported a payment that does not match this order (${[
        detail.fields ?? [],
      ]
        .flat()
        .join(
          ', ',
        )}). It was NOT marked paid. Check the payment in the processor before doing anything.`,
      'payment.fp.closed-order':
        'Final Processor collected a payment for this order after it was closed. Refund it in the processor, or reopen the sale by hand.',
      'payment.fp.refund-failed':
        'Final Processor: the gateway rejected a refund on this order. The money has not gone back.',
    };
    this.logger.error(`${action} on order ${payment.order.number}: ${JSON.stringify(detail)}`);
    await this.audit.record({
      actorType: ActorType.SYSTEM,
      entity: 'Payment',
      entityId: payment.id,
      action,
      after: { orderNumber: payment.order.number, ...detail },
    });
    await this.prisma.client.orderNote.create({
      data: { orderId: payment.order.id, body: notes[action], isCustomerVisible: false },
    });
  }

  /** One row per processed delivery, for the admin's log. A failed write never fails the webhook. */
  private async log(event: WebhookEvent, result: FpWebhookResult): Promise<void> {
    try {
      await this.prisma.client.paymentWebhookLog.create({
        data: {
          eventId: event.event_id,
          type: event.type,
          orderRef: event.data.order_ref ? String(event.data.order_ref).slice(0, 100) : null,
          result,
        },
      });
    } catch (error) {
      this.logger.error(
        `Could not log Final Processor event ${event.event_id}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }

  // --- the return page's check (A.2.5, B.1) --------------------------------

  /**
   * Paid, pending or failed — the server's answer, never the URL's.
   *
   * An order not yet paid with an open Final Processor payment is confirmed
   * with `getPayment()`, through the same checks as the webhook. The return
   * URL's `fp_result` is never read.
   */
  async confirmStatus(number: string): Promise<FpPaymentStatus> {
    const order = await this.prisma.client.order.findUnique({
      where: { number },
      select: {
        status: true,
        payments: {
          where: { provider: PaymentProvider.FINAL_PROCESSOR },
          orderBy: { createdAt: 'desc' },
          select: { providerRef: true, state: true },
        },
      },
    });
    if (!order) throw new NotFoundException(`لا يوجد طلب بالرقم ${number}`);
    if (PAID_STATUSES.includes(order.status)) return { status: 'paid' };
    if (order.status !== OrderStatus.PENDING_PAYMENT) return { status: 'failed' };

    const open = order.payments.find(
      (payment) => OPEN_STATES.includes(payment.state) && payment.providerRef,
    );
    if (!open?.providerRef) {
      const failed = order.payments.some(
        (payment) =>
          payment.state === PaymentState.FAILED || payment.state === PaymentState.CANCELLED,
      );
      return { status: failed ? 'failed' : 'pending' };
    }
    if (!this.fp.configured) return { status: 'pending' };

    let remote;
    try {
      remote = await this.fp.getPayment(open.providerRef);
    } catch (error) {
      this.logger.warn(`Final Processor getPayment for order ${number}: ${fpErrorCode(error)}`);
      return { status: 'pending' };
    }
    if (remote.payment_id !== open.providerRef) {
      this.logger.error(`Final Processor answered for another payment than order ${number}'s.`);
      return { status: 'pending' };
    }
    if (remote.status === 'failed') return { status: 'failed' };
    if (remote.status !== 'succeeded') return { status: 'pending' };

    const applied = await this.applySuccess(snapshotOf(remote), 'status_check');
    return {
      status:
        applied.result === 'applied' && applied.status && PAID_STATUSES.includes(applied.status)
          ? 'paid'
          : 'pending',
    };
  }

  // --- refunds from the panel (B.4) ----------------------------------------

  /**
   * Refunds all or part of what was paid, through the processor.
   *
   * The refund row is written first, pending, with its own id as the
   * processor's `refund_ref` — the idempotency key: if the answer is lost, a
   * retry sends the same reference and cannot refund twice. The cap is what
   * was paid less refunds that succeeded or are still pending.
   */
  async refund(input: {
    number: string;
    reason: string;
    staffId: string;
    amount?: string | undefined;
    amountMinor?: string | undefined;
  }): Promise<RefundOrderResult> {
    const order = await this.prisma.client.order.findUnique({
      where: { number: input.number },
      select: {
        id: true,
        status: true,
        payments: {
          where: { provider: PaymentProvider.FINAL_PROCESSOR, state: PaymentState.SUCCEEDED },
          select: {
            id: true,
            providerRef: true,
            amountUsd: true,
            refunds: {
              select: {
                id: true,
                refundRef: true,
                providerRef: true,
                amountUsd: true,
                status: true,
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(
        say(`لا يوجد طلب بالرقم ${input.number}`, `No order numbered ${input.number}`),
      );
    }
    if (!REFUNDABLE.includes(order.status)) {
      throw new BadRequestException(
        say(
          `الطلب ${input.number} في الحالة ${order.status}؛ لا شيء يُسترد.`,
          `Order ${input.number} is ${order.status}; there is nothing to refund.`,
        ),
      );
    }
    const payment = order.payments[0];
    if (!payment?.providerRef) {
      throw new BadRequestException(
        say(
          `لا توجد دفعة ناجحة عبر Final Processor للطلب ${input.number}.`,
          `Order ${input.number} has no succeeded Final Processor payment.`,
        ),
      );
    }
    if (!this.fp.configured) {
      throw adminError(HttpStatus.SERVICE_UNAVAILABLE, 'not_configured');
    }

    const paid = BigInt(usdMinor(payment.amountUsd));
    const committed = payment.refunds
      .filter((row) => row.status !== RefundStatus.FAILED)
      .reduce((sum, row) => sum + BigInt(usdMinor(row.amountUsd)), 0n);
    const requested =
      input.amountMinor !== undefined
        ? BigInt(input.amountMinor)
        : input.amount !== undefined
          ? BigInt(toMinor(input.amount, 'USD'))
          : null;

    // A refund whose answer never came back is retried with its own
    // reference before anything new is started.
    const unconfirmed = payment.refunds.find(
      (row) => row.status === RefundStatus.PENDING && row.providerRef === null && row.refundRef,
    );
    let refund: { id: string; refundRef: string; amountMinor: bigint };
    if (unconfirmed?.refundRef) {
      const amount = BigInt(usdMinor(unconfirmed.amountUsd));
      if (requested !== null && requested !== amount) {
        throw new ConflictException(
          say(
            `استرداد بقيمة ${unconfirmed.amountUsd.toFixed(2)} دولار لم يُؤكَّد بعد. أعد محاولته أولاً (اترك المبلغ فارغاً).`,
            `A refund of $${unconfirmed.amountUsd.toFixed(2)} is still unconfirmed. Retry it first (leave the amount empty).`,
          ),
        );
      }
      refund = { id: unconfirmed.id, refundRef: unconfirmed.refundRef, amountMinor: amount };
    } else {
      const remaining = paid - committed;
      const amount = requested ?? remaining;
      if (amount <= 0n || amount > remaining) {
        throw new BadRequestException(
          say(
            `المبلغ يجب أن يكون بين 0.01 و${minorToUsd(remaining.toString())} دولار (المدفوع ناقص المسترد).`,
            `The amount must be between $0.01 and $${minorToUsd(remaining.toString())} (paid less already refunded).`,
          ),
        );
      }
      refund = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.refund.create({
          data: {
            paymentId: payment.id,
            amountUsd: minorToUsd(amount.toString()),
            reason: input.reason,
            createdById: input.staffId || null,
            status: RefundStatus.PENDING,
          },
          select: { id: true },
        });
        await tx.refund.update({ where: { id: row.id }, data: { refundRef: row.id } });
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            authorId: input.staffId || null,
            body: `Refund requested ($${minorToUsd(amount.toString())}): ${input.reason}`,
            isCustomerVisible: false,
          },
        });
        return { id: row.id, refundRef: row.id, amountMinor: amount };
      });
    }

    let answer;
    try {
      answer = await this.fp.refund(payment.providerRef, {
        refundRef: refund.refundRef,
        amountMinor: refund.amountMinor.toString(),
      });
    } catch (error) {
      const code = fpErrorCode(error);
      this.logger.warn(`Final Processor refund ${refund.id} on order ${input.number}: ${code}`);
      if (isTransientFpCode(code)) {
        // Outcome unknown: the row stays pending, and a retry reuses its
        // reference, which the processor never refunds twice.
        throw adminError(HttpStatus.SERVICE_UNAVAILABLE, code, {
          suffix: say(
            'سُجّل الاسترداد معلّقاً؛ أعد المحاولة لتأكيده (بالمرجع نفسه، فلا يُسترد مرتين).',
            'The refund is recorded as pending; retry to confirm it (same reference, never refunded twice).',
          ),
        });
      }
      await this.prisma.client.refund.update({
        where: { id: refund.id },
        data: { status: RefundStatus.FAILED, failureCode: code },
      });
      throw adminError(HttpStatus.BAD_REQUEST, code);
    }

    const status = refundStatusFrom(answer.status);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          providerRef: answer.refund_id,
          status,
          ...(status === RefundStatus.FAILED ? { failureCode: 'refund_failed' } : {}),
        },
      });
      if (status !== RefundStatus.SUCCEEDED) return;
      await this.settleFromRows(tx, {
        paymentId: payment.id,
        orderId: order.id,
        paid,
        actor: { type: 'STAFF', id: input.staffId || null },
      });
    });
    if (status === RefundStatus.FAILED) {
      await this.flag(
        { id: payment.id, order: { id: order.id, number: input.number } },
        'payment.fp.refund-failed',
        { paymentId: payment.providerRef, refundId: answer.refund_id, refundRowId: refund.id },
      );
    }

    const after = await this.prisma.client.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true },
    });
    return {
      status: after.status,
      via: 'final_processor',
      refund: {
        id: refund.id,
        amountUsd: minorToUsd(refund.amountMinor.toString()),
        status,
      },
    };
  }

  /** The order's refund state from the refunds that succeeded. */
  private async settleFromRows(
    tx: Prisma.TransactionClient,
    input: {
      paymentId: string;
      orderId: string;
      paid: bigint;
      actor: { type: 'STAFF'; id: string | null };
    },
  ): Promise<void> {
    const rows = await tx.refund.findMany({
      where: { paymentId: input.paymentId, status: RefundStatus.SUCCEEDED },
      select: { amountUsd: true },
    });
    const refunded = rows.reduce((sum, row) => sum + BigInt(usdMinor(row.amountUsd)), 0n);
    const fullyRefunded = refunded >= input.paid;
    await this.raiseRefunded(tx, input.paymentId, refunded.toString());
    if (fullyRefunded) {
      await tx.payment.update({
        where: { id: input.paymentId },
        data: { state: PaymentState.REFUNDED },
      });
    }
    await recordRefundOutcome(tx, {
      orderId: input.orderId,
      fullyRefunded,
      actor: input.actor,
      label: 'Refunded in Final Processor',
      delivered: await this.deliveredSkus(tx, input.orderId),
      note: 'on_change',
    });
  }

  // --- the panel's views (B.4, B.5) ----------------------------------------

  /** The Final Processor block of an order's detail, or null when it was not paid that way. */
  async orderPayment(orderId: string, paidAt: Date | null): Promise<AdminFpOrderPayment | null> {
    const payments = await this.prisma.client.payment.findMany({
      where: { orderId, provider: PaymentProvider.FINAL_PROCESSOR },
      orderBy: { createdAt: 'desc' },
      include: { refunds: { orderBy: { createdAt: 'desc' } } },
    });
    if (payments.length === 0) return null;
    // The one that took the money, else the latest attempt.
    const payment =
      payments.find(
        (row) => row.state === PaymentState.SUCCEEDED || row.state === PaymentState.REFUNDED,
      ) ?? payments[0];
    if (!payment) return null;

    const committed = payment.refunds
      .filter((row) => row.status !== RefundStatus.FAILED)
      .reduce((sum, row) => sum + BigInt(usdMinor(row.amountUsd)), 0n);
    const paid =
      payment.state === PaymentState.SUCCEEDED || payment.state === PaymentState.REFUNDED
        ? BigInt(usdMinor(payment.amountUsd))
        : 0n;
    const refundable = paid > committed ? paid - committed : 0n;

    return {
      paymentId: payment.providerRef,
      state: payment.state,
      testMode: payment.testMode,
      paidAt: paid > 0n ? (paidAt?.toISOString() ?? null) : null,
      amountUsd: payment.amountUsd.toFixed(2),
      refundedUsd: payment.refundedUsd.toFixed(2),
      refundableUsd: minorToUsd(refundable.toString()),
      refunds: payment.refunds.map((row) => ({
        id: row.id,
        refundRef: row.refundRef,
        refundId: row.providerRef,
        amountUsd: row.amountUsd.toFixed(2),
        status: row.status,
        failureCode: row.failureCode,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /** The notification log (B.5), newest first. */
  async events(page: number): Promise<AdminFpEventList> {
    const rows = await this.prisma.client.paymentWebhookLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * EVENTS_PER_PAGE,
      take: EVENTS_PER_PAGE + 1,
    });
    const shown = rows.slice(0, EVENTS_PER_PAGE);
    const refs = [...new Set(shown.map((row) => row.orderRef).filter((ref) => ref !== null))];
    const orders =
      refs.length > 0
        ? await this.prisma.client.order.findMany({
            where: { id: { in: refs } },
            select: { id: true, number: true },
          })
        : [];
    const numbers = new Map(orders.map((order) => [order.id, order.number]));
    return {
      rows: shown.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        type: row.type,
        orderRef: row.orderRef,
        orderNumber: row.orderRef ? (numbers.get(row.orderRef) ?? null) : null,
        result: (['applied', 'duplicate', 'mismatch', 'error'] as const).includes(
          row.result as FpWebhookResult,
        )
          ? (row.result as FpWebhookResult)
          : 'error',
        createdAt: row.createdAt.toISOString(),
      })),
      page,
      hasMore: rows.length > EVENTS_PER_PAGE,
    };
  }
}

function snapshotOf(data: {
  payment_id: string;
  order_ref: string;
  status: string;
  amount_minor: string;
  currency: string;
  test_mode: boolean;
  refunded_minor?: string;
}): PaymentSnapshot {
  return {
    payment_id: String(data.payment_id),
    order_ref: String(data.order_ref),
    status: String(data.status),
    amount_minor: String(data.amount_minor),
    currency: String(data.currency),
    test_mode: data.test_mode === true,
    refunded_minor: String(data.refunded_minor ?? '0'),
  };
}

/** A customer-facing refusal (A.6): a short generic message, never the processor's code. */
function customerError(
  status: 400 | 409 | 503,
  locale: 'ar' | 'en',
  reason: 'unavailable' | 'retry' | 'order_changed',
): HttpException {
  return new HttpException(
    { statusCode: status, message: fpCustomerMessage(locale, reason), reason },
    status,
  );
}

/** A staff-facing refusal: the processor's code, and what it means. */
function adminError(
  status: HttpStatus,
  code: string,
  options: { suffix?: string } = {},
): HttpException {
  const message = fpAdminMessage(code);
  return new HttpException(
    {
      statusCode: status,
      message: options.suffix ? `${message} ${options.suffix}` : message,
      code,
    },
    status,
  );
}
