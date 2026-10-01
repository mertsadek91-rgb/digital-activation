import { createHmac } from 'node:crypto';

import { type Checkout, checkoutSchema, fpPaymentStatusSchema } from '@da/contracts';
import { OrderStatus, PaymentProvider, Prisma } from '@da/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { OrdersService } from '../admin/orders.service.js';
import { FinalProcessor, type PaymentMethod } from '../checkout/final-processor.js';
import { FinalProcessorService } from '../checkout/final-processor.service.js';
import { FpPaymentsService } from '../checkout/fp-payments.service.js';

import {
  type Catalogue,
  type Harness,
  HAS_DATABASE,
  bootApp,
  seedCatalogue,
  shopper,
} from './harness.js';

/**
 * Final Processor end to end, against a real database, with no processor.
 *
 * The configuration is test values set before AppModule is imported (the
 * suite's env.ts blanks any real ones). The SDK's four network calls are
 * stubbed on its prototype and `fetch` itself throws; `verifyWebhook` is the
 * real one, and every webhook here is signed with the test secret exactly as
 * the processor signs it.
 */
const config = vi.hoisted(() => {
  const values = {
    FP_BASE_URL: 'https://processor.example.test/payment',
    FP_SITE_ID: 'site_integration00',
    FP_SECRET: 'fpsec_' + 'integration-'.repeat(3),
    SITE_URL: 'https://shop.example.test',
    API_PUBLIC_URL: 'https://api.example.test',
    // The sandbox events below should fulfil; the hold is tested on its own.
    FP_FULFIL_TEST_PAYMENTS: 'on',
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  return values;
});

const card: PaymentMethod = {
  id: 'stripe_card',
  label: 'Card',
  labels: { ar: 'بطاقة', en: 'Card' },
  icon_url: 'https://processor.example.test/card.svg',
  currencies: ['USD'],
  refunds: 'partial',
  test_mode: true,
};

function signed(body: unknown, secret = config.FP_SECRET) {
  const payload = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    payload,
    headers: {
      'content-type': 'application/json',
      'x-fp-timestamp': timestamp,
      'x-fp-signature':
        'v1=' + createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex'),
    },
  };
}

describe.skipIf(!HAS_DATABASE)('Final Processor: pay, webhook, status and refunds', () => {
  let harness: Harness;
  let catalogue: Catalogue;
  let sequence = 0;
  // Unique per run: the suite's database outlives it.
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const paymentIds = new Map<string, string>();

  const createPayment = vi.spyOn(FinalProcessor.prototype, 'createPayment');
  const getPayment = vi.spyOn(FinalProcessor.prototype, 'getPayment');
  const refund = vi.spyOn(FinalProcessor.prototype, 'refund');
  vi.spyOn(FinalProcessor.prototype, 'listMethods').mockResolvedValue([card]);

  beforeAll(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No network in the integration suite.');
      }),
    );
    createPayment.mockImplementation((input) => {
      const id = paymentIds.get(input.orderRef) ?? `pay_it_${run}_${String((sequence += 1))}`;
      paymentIds.set(input.orderRef, id);
      return Promise.resolve({
        payment_id: id,
        status: 'pending' as const,
        redirect_url: `https://processor.example.test/payment/go/${id}`,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
    });
    harness = await bootApp();
    catalogue = await seedCatalogue(harness);
    // Euros on the page, so the charge has something to differ from.
    await harness.db.currency.upsert({
      where: { code: 'EUR' },
      update: { isActive: true },
      create: { code: 'EUR', symbol: '€', decimals: 2, isActive: true },
    });
    await harness.db.fxRate.create({
      data: { currencyCode: 'EUR', rate: new Prisma.Decimal('0.9'), source: 'integration' },
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await harness?.close();
  });

  async function draft(email: string) {
    const browser = shopper(harness);
    const added = await browser.request('POST', '/v1/cart/items', {
      variantId: catalogue.madeToOrder.variantId,
      qty: 1,
    });
    expect(added.status).toBe(201);
    const started = await browser.request<Checkout>('POST', '/v1/checkout?currency=EUR&locale=en', {
      email,
    });
    expect(started.status).toBe(201);
    return { browser, checkout: checkoutSchema.parse(started.body) };
  }

  const deliver = (body: unknown, secret?: string) => {
    const { payload, headers } = signed(body, secret);
    return harness.app.inject({
      method: 'POST',
      url: '/v1/webhooks/final-processor',
      headers,
      payload,
    });
  };

  const orderOf = (number: string) =>
    harness.db.order.findUniqueOrThrow({
      where: { number },
      include: { payments: { include: { refunds: true } }, statusEvents: true },
    });

  let paidNumber = '';
  let paidOrderId = '';
  let paidPaymentId = '';

  it('offers the processor’s methods and says the charge is in dollars', async () => {
    const { checkout } = await draft('fp-offer@example.test');
    expect(checkout.order.currency).toBe('EUR');
    expect(checkout.paymentMethods).toContain('FINAL_PROCESSOR');
    expect(checkout.finalProcessorMethods).toEqual([
      { id: 'stripe_card', label: 'Card', iconUrl: card.icon_url, description: null },
    ]);
    expect(checkout.chargedInUsd).toEqual({ amountUsd: '35.00' });
  });

  it('starts a payment for the USD total, whatever the display currency', async () => {
    const { browser, checkout } = await draft('fp-paid@example.test');
    paidNumber = checkout.order.number;

    const paid = await browser.request<{ provider: string; redirectUrl: string }>(
      'POST',
      `/v1/orders/${paidNumber}/pay`,
      { provider: 'FINAL_PROCESSOR', method: 'stripe_card' },
    );
    expect(paid.status).toBe(201);
    const input = createPayment.mock.calls.at(-1)?.[0];
    const order = await orderOf(paidNumber);
    paidOrderId = order.id;
    expect(input).toMatchObject({
      orderRef: order.id,
      amountMinor: '3500',
      currency: 'USD',
      returnUrl: `https://shop.example.test/en/checkout/return/${paidNumber}`,
      cancelUrl: 'https://shop.example.test/en/checkout',
    });
    expect(paid.body.redirectUrl).toBe(
      `https://processor.example.test/payment/go/${paymentIds.get(order.id) ?? ''}`,
    );
    paidPaymentId = paymentIds.get(order.id) ?? '';
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]).toMatchObject({
      provider: PaymentProvider.FINAL_PROCESSOR,
      providerRef: paidPaymentId,
      state: 'PROCESSING',
      chargedCurrency: 'USD',
    });
  });

  it('refuses a method the shop does not offer', async () => {
    const { browser, checkout } = await draft('fp-bad-method@example.test');
    const paid = await browser.request('POST', `/v1/orders/${checkout.order.number}/pay`, {
      provider: 'FINAL_PROCESSOR',
      method: 'not_a_method',
    });
    expect(paid.status).toBe(400);
  });

  it('does not mark an unpaid order paid because the return URL says so', async () => {
    getPayment.mockResolvedValueOnce({
      payment_id: paidPaymentId,
      order_ref: paidOrderId,
      order_number: paidNumber,
      status: 'pending',
      amount_minor: '3500',
      currency: 'USD',
      method: 'stripe_card',
      refunded_minor: '0',
      test_mode: true,
      created_at: '',
      expires_at: '',
      succeeded_at: null,
      refunds: [],
    });
    const response = await harness.app.inject({
      method: 'GET',
      url: `/v1/checkout/final-processor/status/${paidNumber}?fp_result=paid&fp_payment=${paidPaymentId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(fpPaymentStatusSchema.parse(response.json())).toEqual({ status: 'pending' });
    expect((await orderOf(paidNumber)).status).toBe(OrderStatus.PENDING_PAYMENT);
  });

  const succeeded = (overrides: Record<string, unknown> = {}, eventId?: string) => ({
    event_id: eventId ?? `evt_it_${run}_${String((sequence += 1))}`,
    type: 'payment.succeeded',
    created_at: new Date().toISOString(),
    data: {
      payment_id: paidPaymentId,
      order_ref: paidOrderId,
      status: 'succeeded',
      amount_minor: '3500',
      currency: 'USD',
      method: 'stripe_card',
      refunded_minor: '0',
      test_mode: true,
      ...overrides,
    },
  });

  it('answers 401 to a wrong signature and changes nothing', async () => {
    const response = await deliver(succeeded(), 'fpsec_wrong_secret_entirely');
    expect(response.statusCode).toBe(401);
    expect((await orderOf(paidNumber)).status).toBe(OrderStatus.PENDING_PAYMENT);
  });

  it('does not mark paid an event for another amount', async () => {
    const response = await deliver(succeeded({ amount_minor: '3499' }));
    expect(response.statusCode).toBe(201);
    const order = await orderOf(paidNumber);
    expect(order.status).toBe(OrderStatus.PENDING_PAYMENT);
    const log = await harness.db.paymentWebhookLog.findFirst({
      where: { orderRef: paidOrderId },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.result).toBe('mismatch');
  });

  it('pays on a verified event, once, and delivers', async () => {
    const event = succeeded({}, `evt_it_paid_${run}`);
    const { payload, headers } = signed(event);
    const first = await harness.app.inject({
      method: 'POST',
      url: '/v1/webhooks/final-processor',
      headers,
      payload,
    });
    expect(first.statusCode).toBe(201);

    const order = await orderOf(paidNumber);
    expect([OrderStatus.PAID, OrderStatus.FULFILLING, OrderStatus.FULFILLED]).toContain(
      order.status,
    );
    expect(order.paidAt).not.toBeNull();
    expect(order.payments[0]).toMatchObject({ state: 'SUCCEEDED', testMode: true });
    const events = order.statusEvents.length;

    // The same body and headers again: 2xx, nothing changes.
    const again = await harness.app.inject({
      method: 'POST',
      url: '/v1/webhooks/final-processor',
      headers,
      payload,
    });
    expect(again.statusCode).toBe(201);
    const after = await orderOf(paidNumber);
    expect(after.status).toBe(order.status);
    expect(after.statusEvents).toHaveLength(events);
    const logs = await harness.db.paymentWebhookLog.findMany({
      where: { eventId: event.event_id },
    });
    expect(logs.map((row) => row.result).sort()).toEqual(['applied', 'duplicate']);

    const status = await harness.app.inject({
      method: 'GET',
      url: `/v1/checkout/final-processor/status/${paidNumber}`,
    });
    expect(status.json()).toEqual({ status: 'paid' });
  });

  it('never releases keys when the refund event arrives before the success event', async () => {
    const { browser, checkout } = await draft('fp-early-refund@example.test');
    const number = checkout.order.number;
    const paid = await browser.request('POST', `/v1/orders/${number}/pay`, {
      provider: 'FINAL_PROCESSOR',
      method: 'stripe_card',
    });
    expect(paid.status).toBe(201);
    const order = await orderOf(number);
    const paymentId = paymentIds.get(order.id) ?? '';
    const base = {
      payment_id: paymentId,
      order_ref: order.id,
      amount_minor: '3500',
      currency: 'USD',
      method: 'stripe_card',
      test_mode: true,
    };

    const refundFirst = await deliver({
      event_id: `evt_it_early_ref_${run}`,
      type: 'payment.refunded',
      created_at: new Date().toISOString(),
      data: {
        ...base,
        status: 'refunded',
        refunded_minor: '3500',
        refund: {
          refund_id: `re_it_early_${run}`,
          refund_ref: `external_${run}`,
          amount_minor: '3500',
          status: 'succeeded',
        },
      },
    });
    expect(refundFirst.statusCode).toBeLessThan(300);

    // The success, retried later with the data it carried when first sent.
    const success = await deliver({
      event_id: `evt_it_early_ok_${run}`,
      type: 'payment.succeeded',
      created_at: new Date().toISOString(),
      data: { ...base, status: 'succeeded', refunded_minor: '0' },
    });
    expect(success.statusCode).toBeLessThan(300);

    const after = await orderOf(number);
    expect(after.status).not.toBe(OrderStatus.PAID);
    expect([
      OrderStatus.PAYMENT_REVIEW,
      OrderStatus.REFUNDED,
      OrderStatus.PENDING_PAYMENT,
    ]).toContain(after.status);
    const delivered = await harness.db.orderItem.count({
      where: { orderId: order.id, fulfillmentState: 'DELIVERED' },
    });
    expect(delivered).toBe(0);
  });

  it('holds a sandbox payment for review unless the operator opted in', async () => {
    const { browser, checkout } = await draft('fp-sandbox@example.test');
    const number = checkout.order.number;
    const paid = await browser.request('POST', `/v1/orders/${number}/pay`, {
      provider: 'FINAL_PROCESSOR',
      method: 'stripe_card',
    });
    expect(paid.status).toBe(201);
    const order = await orderOf(number);
    const paymentId = paymentIds.get(order.id) ?? '';
    process.env.FP_FULFIL_TEST_PAYMENTS = 'off';
    try {
      const response = await deliver({
        ...succeeded({ payment_id: paymentId, order_ref: order.id }),
        event_id: `evt_it_sandbox_${run}`,
      });
      expect(response.statusCode).toBe(201);
    } finally {
      process.env.FP_FULFIL_TEST_PAYMENTS = 'on';
    }
    const after = await orderOf(number);
    expect(after.status).toBe(OrderStatus.PAYMENT_REVIEW);
    expect(after.payments[0]).toMatchObject({ testMode: true });
  });

  it('refunds part, then the rest, from the panel; each refund recorded once', async () => {
    let n = 0;
    refund.mockImplementation((_paymentId, input) =>
      Promise.resolve({
        refund_id: `rf_it_${String((n += 1))}_${input.refundRef}`,
        refund_ref: input.refundRef,
        amount_minor: input.amountMinor,
        currency: 'USD',
        status: 'succeeded' as const,
        created_at: new Date().toISOString(),
      }),
    );
    const orders = harness.get(OrdersService);
    const context = { ip: undefined, userAgent: undefined };
    // The refund is audited against a real staff account.
    const staff = await harness.db.staffUser.create({
      data: {
        email: `fp-refund-${catalogue.run}@example.test`,
        name: 'Integration admin',
        passwordHash: 'not-a-real-hash',
        role: 'ADMIN',
      },
    });
    const staffId = staff.id;

    const part = await orders.refund({
      number: paidNumber,
      reason: 'partial refund',
      staffId,
      amount: '5.00',
      context,
    });
    expect(part).toMatchObject({
      status: OrderStatus.PARTIALLY_REFUNDED,
      via: 'final_processor',
      refund: { amountUsd: '5.00', status: 'SUCCEEDED' },
    });

    const tooMuch = await orders
      .refund({ number: paidNumber, reason: 'too much', staffId, amount: '30.01', context })
      .catch((error: unknown) => error);
    expect(tooMuch).toMatchObject({ status: 400 });

    const rest = await orders.refund({ number: paidNumber, reason: 'the rest', staffId, context });
    expect(rest).toMatchObject({ status: OrderStatus.REFUNDED, refund: { amountUsd: '30.00' } });

    // The processor's webhook for the second refund: already recorded.
    const order = await orderOf(paidNumber);
    const second = order.payments[0]?.refunds.find((row) => row.amountUsd.toFixed(2) === '30.00');
    const hook = await deliver({
      event_id: `evt_it_ref_${run}`,
      type: 'payment.refunded',
      created_at: new Date().toISOString(),
      data: {
        payment_id: paidPaymentId,
        order_ref: paidOrderId,
        status: 'refunded',
        amount_minor: '3500',
        currency: 'USD',
        method: 'stripe_card',
        refunded_minor: '3500',
        test_mode: true,
        refund: {
          refund_id: second?.providerRef,
          refund_ref: second?.refundRef,
          amount_minor: '3000',
          status: 'succeeded',
        },
      },
    });
    expect(hook.statusCode).toBe(201);

    const final = await orderOf(paidNumber);
    expect(final.status).toBe(OrderStatus.REFUNDED);
    expect(final.payments[0]?.refunds).toHaveLength(2);
    expect(final.payments[0]?.state).toBe('REFUNDED');
    expect(final.payments[0]?.refundedUsd.toFixed(2)).toBe('35.00');

    const detail = await orders.detail(paidNumber);
    expect(detail.finalProcessor).toMatchObject({
      paymentId: paidPaymentId,
      testMode: true,
      refundedUsd: '35.00',
      refundableUsd: '0.00',
    });
    expect(detail.finalProcessor?.refunds).toHaveLength(2);
  });

  it('expires a pending order whose payment session failed', async () => {
    const { browser, checkout } = await draft('fp-failed@example.test');
    const number = checkout.order.number;
    await browser.request('POST', `/v1/orders/${number}/pay`, {
      provider: 'FINAL_PROCESSOR',
      method: 'stripe_card',
    });
    const order = await orderOf(number);
    const response = await deliver({
      event_id: `evt_it_fail_${run}`,
      type: 'payment.failed',
      created_at: new Date().toISOString(),
      data: {
        payment_id: order.payments[0]?.providerRef,
        order_ref: order.id,
        status: 'failed',
        amount_minor: '3500',
        currency: 'USD',
        method: 'stripe_card',
        refunded_minor: '0',
        test_mode: true,
      },
    });
    expect(response.statusCode).toBe(201);
    const after = await orderOf(number);
    expect(after.status).toBe(OrderStatus.CANCELLED);
    expect(after.payments[0]?.state).toBe('FAILED');

    // The cart is intact: checking out again drafts a fresh order.
    const again = await browser.request<Checkout>('POST', '/v1/checkout?locale=en', {
      email: 'fp-failed@example.test',
    });
    expect(again.status).toBe(201);
    expect(checkoutSchema.parse(again.body).order.number).not.toBe(number);
  });

  it('lists processed events newest first', async () => {
    const list = await harness.get(FpPaymentsService).events(1);
    expect(list.rows.length).toBeGreaterThan(0);
    const times = list.rows.map((row) => row.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(list.rows.some((row) => row.orderNumber === paidNumber)).toBe(true);
  });

  it('never exposes the secret on the admin overview', async () => {
    const fp = harness.get(FinalProcessorService);
    expect(fp.configured).toBe(true);
    const response = await harness.app.inject({
      method: 'GET',
      url: '/v1/admin/payments/final-processor',
    });
    // No staff session: refused before anything is read.
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain(config.FP_SECRET);
  });
});
