import { createHmac } from 'node:crypto';

import { HttpException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { Prisma } from '@da/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersController } from '../admin/orders.controller.js';
import type { AuditService } from '../auth/audit.service.js';
import { ROLES_KEY, StaffGuard } from '../auth/staff.guard.js';
import { runWithPanelLocale } from '../common/panel-locale.js';
import type { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

import { CheckoutController, flatHeaders } from './checkout.controller.js';
import type { CheckoutService } from './checkout.service.js';
import { FinalProcessorAdminController } from './final-processor-admin.controller.js';
import { FinalProcessor, type PaymentMethod, type WebhookEvent } from './final-processor.js';
import {
  FP_METHODS_TTL_MS,
  FinalProcessorService,
  fpAdminMessage,
  fpCustomerMessage,
  isTransientFpCode,
} from './final-processor.service.js';
import { FinalProcessorError } from './final-processor.js';
import { FpLogPruneService } from './fp-log-prune.service.js';
import { FpPaymentsService, fpOrderNumber, minorToUsd, usdMinor } from './fp-payments.service.js';
import { PaymentSettingsService } from './payment-settings.service.js';
import type { StripeService } from './stripe.service.js';

/**
 * Final Processor, without a processor: the SDK's network calls are stubbed
 * and `fetch` itself throws, so nothing here can reach one. Webhook
 * signatures are computed with a test secret exactly as the SDK computes them.
 */

// Built, not written out: a literal of this shape is what a secret scanner looks for.
const SECRET = 'fpsec_' + 'unit-test-'.repeat(3);
const SITE_URL = 'https://shop.example.test';

function sign(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  const timestamp = String(at);
  return {
    'x-fp-timestamp': timestamp,
    'x-fp-signature':
      'v1=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex'),
  };
}

const card: PaymentMethod = {
  id: 'stripe_card',
  label: 'Card',
  labels: { ar: 'بطاقة', en: 'Card' },
  icon_url: 'https://processor.example.test/card.svg',
  currencies: ['USD', 'EUR'],
  refunds: 'partial',
  test_mode: true,
};

// --- an in-memory database, just big enough -----------------------------------

type Row = Record<string, unknown>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR') return (condition as Row[]).some((branch) => matches(row, branch));
    const value = row[key];
    if (
      condition !== null &&
      typeof condition === 'object' &&
      !(condition instanceof Prisma.Decimal) &&
      !(condition instanceof Date)
    ) {
      const c = condition as Row;
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if ('not' in c) return value !== c.not;
      if ('lt' in c) return new Prisma.Decimal(value as string).lt(c.lt as Prisma.Decimal);
      return true; // relation filters are not modelled
    }
    return value === condition;
  });
}

/** A mock that answers a promise, as Prisma's methods do, without an `async` that awaits nothing. */
function asyncFn<A extends unknown[], R>(implementation: (...args: A) => R) {
  return vi.fn((...args: A) => Promise.resolve(implementation(...args)));
}

let ids = 0;
const nextId = (prefix: string) => `${prefix}_${String((ids += 1))}`;

function world(options: { currency?: string } = {}) {
  const order: Row = {
    id: 'ord_1',
    number: 'DA-2026-00042',
    status: 'PENDING_PAYMENT',
    email: 'buyer@example.test',
    totalUsd: new Prisma.Decimal('25.50'),
    currency: options.currency ?? 'USD',
    locale: 'EN',
    paidAt: null,
  };
  const orders: Row[] = [order];
  const payments: Row[] = [];
  const refunds: Row[] = [];
  const notes: Row[] = [];
  const statusEvents: Row[] = [];
  const logs: Row[] = [];
  const configs: Row[] = [];
  const decimal = (value: unknown) =>
    value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value as string);
  const withRefunds = (payment: Row) => ({
    ...payment,
    refunds: refunds.filter((refund) => refund.paymentId === payment.id),
  });

  const client = {
    order: {
      findUnique: asyncFn(({ where, select }: { where: Row; select?: Row }) => {
        const found = orders.find((row) =>
          where.id ? row.id === where.id : row.number === where.number,
        );
        if (!found) return null;
        const paymentsSelect = select?.payments as { where?: Row } | undefined;
        return {
          ...found,
          payments: payments
            .filter((row) => row.orderId === found.id && matches(row, paymentsSelect?.where))
            .map(withRefunds),
        };
      }),
      findUniqueOrThrow: asyncFn(({ where }: { where: Row }) => {
        const found = orders.find((row) => row.id === where.id || row.number === where.number);
        if (!found) throw new Error('not found');
        return found;
      }),
      findMany: asyncFn(() => orders),
      updateMany: asyncFn(({ where, data }: { where: Row; data: Row }) => {
        const hit = orders.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      }),
    },
    orderStatusEvent: { create: asyncFn(({ data }: { data: Row }) => statusEvents.push(data)) },
    orderNote: { create: asyncFn(({ data }: { data: Row }) => notes.push(data)) },
    orderItem: { findMany: asyncFn(() => []) },
    product: { updateMany: asyncFn(() => ({ count: 0 })) },
    notificationLog: { count: asyncFn(() => 0) },
    payment: {
      findUnique: asyncFn(({ where }: { where: { provider_providerRef: Row } }) => {
        const key = where.provider_providerRef;
        const found = payments.find(
          (row) => row.provider === key.provider && row.providerRef === key.providerRef,
        );
        if (!found) return null;
        return {
          ...found,
          _count: { refunds: withRefunds(found).refunds.length },
          order: orders.find((row) => row.id === found.orderId),
        };
      }),
      findMany: asyncFn(({ where }: { where: Row }) =>
        payments.filter((row) => matches(row, where)).map(withRefunds),
      ),
      count: asyncFn(
        ({ where }: { where: Row }) => payments.filter((row) => matches(row, where)).length,
      ),
      upsert: asyncFn(
        ({ where, create }: { where: { provider_providerRef: Row }; create: Row }) => {
          const key = where.provider_providerRef;
          const found = payments.find(
            (row) => row.provider === key.provider && row.providerRef === key.providerRef,
          );
          if (found) return found;
          const row = {
            id: nextId('pay'),
            testMode: false,
            refundedUsd: new Prisma.Decimal(0),
            createdAt: new Date(),
            ...create,
            amountUsd: decimal(create.amountUsd),
          };
          payments.push(row);
          return row;
        },
      ),
      update: asyncFn(({ where, data }: { where: Row; data: Row }) => {
        const row = payments.find((entry) => entry.id === where.id);
        if (!row) throw new Error('no payment');
        Object.assign(row, data);
        return row;
      }),
      updateMany: asyncFn(({ where, data }: { where: Row; data: Row }) => {
        const hit = payments.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return { count: hit.length };
      }),
    },
    refund: {
      findFirst: asyncFn(
        ({ where }: { where: Row }) => refunds.find((row) => matches(row, where)) ?? null,
      ),
      findUnique: asyncFn(
        ({ where }: { where: Row }) =>
          refunds.find((row) => row.refundRef === where.refundRef) ?? null,
      ),
      findMany: asyncFn(({ where }: { where: Row }) =>
        refunds.filter((row) => matches(row, where)),
      ),
      create: asyncFn(({ data }: { data: Row }) => {
        if (data.providerRef && refunds.some((row) => row.providerRef === data.providerRef)) {
          throw new Error('unique violation: Refund.providerRef');
        }
        const row = {
          id: nextId('ref'),
          refundRef: null,
          providerRef: null,
          failureCode: null,
          reason: null,
          createdAt: new Date(),
          ...data,
          amountUsd: decimal(data.amountUsd),
        };
        refunds.push(row);
        return row;
      }),
      update: asyncFn(({ where, data }: { where: Row; data: Row }) => {
        const row = refunds.find((entry) => entry.id === where.id);
        if (!row) throw new Error('no refund');
        Object.assign(row, data, data.amountUsd ? { amountUsd: decimal(data.amountUsd) } : {});
        return row;
      }),
    },
    paymentWebhookLog: {
      create: asyncFn(({ data }: { data: Row }) => logs.push({ ...data, createdAt: new Date() })),
      findMany: asyncFn(() => logs),
      deleteMany: asyncFn(() => ({ count: 3 })),
    },
    paymentMethodConfig: {
      findMany: asyncFn(() => configs),
      findUnique: asyncFn(() => null),
      upsert: asyncFn(() => ({})),
    },
    setting: { findUnique: asyncFn(() => null) },
    $queryRaw: asyncFn(() => [{ locked: true }]),
    // The transaction handle is the client itself; `self` breaks the
    // self-reference so the object keeps its type.
    $transaction: vi.fn((run: (tx: unknown) => Promise<unknown>) => run(self)),
  };
  const self: unknown = client;
  const prisma = { client } as unknown as PrismaService;

  const processed = new Set<string>();
  const checkout = {
    beginWebhook: asyncFn(({ eventId }: { eventId: string }) => ({
      id: eventId,
      processed: processed.has(eventId),
    })),
    finishWebhook: asyncFn((id: string, error?: unknown) => {
      if (!error) processed.add(id);
    }),
    markPaid: asyncFn((input: { orderNumber: string; providerRef: string; testMode?: boolean }) => {
      const row = orders.find((entry) => entry.number === input.orderNumber);
      const payment = payments.find((entry) => entry.providerRef === input.providerRef);
      if (payment) Object.assign(payment, { state: 'SUCCEEDED', testMode: input.testMode });
      if (!row || row.status !== 'PENDING_PAYMENT') {
        return { status: row?.status, alreadyApplied: true, consumed: 0 };
      }
      row.status = 'PAID';
      row.paidAt = new Date();
      return { status: 'PAID', alreadyApplied: false, consumed: 0 };
    }),
    retireDraft: asyncFn(() => true),
  };
  const fulfillment = { onOrderPaid: asyncFn(() => undefined) };
  const audit = { record: asyncFn(() => undefined) };

  const sdk = new FinalProcessor({
    baseUrl: 'https://processor.example.test/payment',
    siteId: 'site_unit',
    secret: SECRET,
  });
  const listMethods = vi.spyOn(sdk, 'listMethods').mockResolvedValue([card]);
  const createPayment = vi.spyOn(sdk, 'createPayment').mockResolvedValue({
    payment_id: 'pay_fp_1',
    status: 'pending',
    redirect_url: 'https://processor.example.test/payment/go/abc',
    expires_at: '2026-09-30T13:00:00Z',
  });
  const getPayment = vi.spyOn(sdk, 'getPayment');
  const refund = vi.spyOn(sdk, 'refund');

  const fp = new FinalProcessorService(sdk);
  const settings = new PaymentSettingsService(
    prisma,
    { payable: false, configured: false } as unknown as StripeService,
    fp,
    audit as unknown as AuditService,
  );
  const service = new FpPaymentsService(
    prisma,
    fp,
    checkout as unknown as CheckoutService,
    settings,
    fulfillment as unknown as FulfillmentService,
    audit as unknown as AuditService,
  );

  /** A succeeded payment on the order, as a webhook or the admin would find it. */
  const paid = () => {
    order.status = 'PAID';
    order.paidAt = new Date();
    const row = {
      id: 'pay_row_1',
      orderId: order.id,
      provider: 'FINAL_PROCESSOR',
      providerRef: 'pay_fp_1',
      state: 'SUCCEEDED',
      amountUsd: new Prisma.Decimal('25.50'),
      refundedUsd: new Prisma.Decimal(0),
      testMode: true,
      createdAt: new Date(),
    };
    payments.push(row);
    return row;
  };
  const opened = () => {
    const row = {
      id: 'pay_row_1',
      orderId: order.id,
      provider: 'FINAL_PROCESSOR',
      providerRef: 'pay_fp_1',
      state: 'PROCESSING',
      amountUsd: new Prisma.Decimal('25.50'),
      refundedUsd: new Prisma.Decimal(0),
      testMode: false,
      createdAt: new Date(),
    };
    payments.push(row);
    return row;
  };

  return {
    order,
    payments,
    refunds,
    notes,
    statusEvents,
    logs,
    configs,
    client,
    checkout,
    fulfillment,
    audit,
    sdk: { listMethods, createPayment, getPayment, refund },
    fp,
    settings,
    service,
    paid,
    opened,
  };
}

function event(
  type: WebhookEvent['type'],
  data: Partial<WebhookEvent['data']> = {},
  eventId = `evt_${String((ids += 1))}`,
): WebhookEvent {
  return {
    event_id: eventId,
    type,
    created_at: '2026-09-30T12:00:00Z',
    data: {
      payment_id: 'pay_fp_1',
      order_ref: 'ord_1',
      status: 'succeeded',
      amount_minor: '2550',
      currency: 'USD',
      method: 'stripe_card',
      refunded_minor: '0',
      test_mode: true,
      ...data,
    },
  };
}

beforeEach(() => {
  process.env.SITE_URL = SITE_URL;
  process.env.API_PUBLIC_URL = 'https://api.example.test';
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No network in unit tests.');
    }),
  );
});

afterEach(() => {
  delete process.env.SITE_URL;
  delete process.env.API_PUBLIC_URL;
  vi.unstubAllGlobals();
});

// --- money --------------------------------------------------------------------

describe('Final Processor money', () => {
  it('converts with string arithmetic only', () => {
    expect(usdMinor(new Prisma.Decimal('25.5'))).toBe('2550');
    expect(usdMinor(new Prisma.Decimal('0.07'))).toBe('7');
    expect(usdMinor(new Prisma.Decimal('1234567.89'))).toBe('123456789');
    expect(minorToUsd('2550')).toBe('25.50');
    expect(minorToUsd('7')).toBe('0.07');
    expect(minorToUsd('100')).toBe('1.00');
  });

  it('strips an order number down to what the processor accepts', () => {
    expect(fpOrderNumber('DA-2026-00042')).toBe('DA-2026-00042');
    expect(fpOrderNumber('DA/2026 #42.x')).toBe('DA202642x');
    expect(fpOrderNumber('x'.repeat(40))).toHaveLength(32);
    expect(fpOrderNumber('###')).toBeUndefined();
  });
});

// --- the pay path -------------------------------------------------------------

describe('starting a Final Processor payment', () => {
  it('charges the USD total in cents even when the order is shown in euros', async () => {
    const w = world({ currency: 'EUR' });
    const session = await w.service.start('DA-2026-00042', 'stripe_card');

    expect(w.sdk.createPayment).toHaveBeenCalledTimes(1);
    const input = w.sdk.createPayment.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      orderRef: 'ord_1',
      orderNumber: 'DA-2026-00042',
      amountMinor: '2550',
      currency: 'USD',
      method: 'stripe_card',
      customerEmail: 'buyer@example.test',
    });
    expect(session).toEqual({
      provider: 'FINAL_PROCESSOR',
      redirectUrl: 'https://processor.example.test/payment/go/abc',
      amount: { amount: '25.50', currency: 'USD', compareAt: null, discountPercent: null },
    });
    // Recorded against the processor's payment id, in dollars, open.
    expect(w.payments[0]).toMatchObject({
      provider: 'FINAL_PROCESSOR',
      providerRef: 'pay_fp_1',
      state: 'PROCESSING',
      chargedCurrency: 'USD',
    });
    expect(String(w.payments[0]?.amountUsd)).toBe('25.5');
  });

  it('builds absolute https return and cancel URLs from SITE_URL and the order locale', async () => {
    const w = world();
    await w.service.start('DA-2026-00042', 'stripe_card');
    const input = w.sdk.createPayment.mock.calls[0]?.[0];
    expect(input?.returnUrl).toBe(`${SITE_URL}/en/checkout/return/DA-2026-00042`);
    expect(input?.cancelUrl).toBe(`${SITE_URL}/en/checkout`);
    expect(input?.returnUrl.startsWith('https://')).toBe(true);
    expect(input?.cancelUrl.startsWith('https://')).toBe(true);
  });

  it('refuses a method that is disabled here', async () => {
    const w = world();
    w.configs.push({ id: 'stripe_card', enabled: false, displayOrder: 0 });
    await expect(w.service.start('DA-2026-00042', 'stripe_card')).rejects.toMatchObject({
      status: 400,
    });
    expect(w.sdk.createPayment).not.toHaveBeenCalled();
  });

  it('refuses a method the processor does not return', async () => {
    const w = world();
    await expect(w.service.start('DA-2026-00042', 'paypal')).rejects.toBeInstanceOf(HttpException);
    expect(w.sdk.createPayment).not.toHaveBeenCalled();
  });

  it('closes the draft on order_ref_conflict and tells the customer, not the code', async () => {
    const w = world();
    w.sdk.createPayment.mockRejectedValueOnce(new FinalProcessorError('order_ref_conflict', 409));
    const error = await w.service.start('DA-2026-00042', 'stripe_card').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    const response = (error as HttpException).getResponse() as { message: string; reason: string };
    expect((error as HttpException).getStatus()).toBe(409);
    expect(response.reason).toBe('order_changed');
    expect(response.message).not.toContain('order_ref_conflict');
    expect(w.checkout.retireDraft).toHaveBeenCalledWith('ord_1', expect.any(String));
    expect(w.payments).toHaveLength(0);
  });

  it('answers 503 with a generic message on a transient processor error', async () => {
    const w = world();
    w.sdk.createPayment.mockRejectedValueOnce(new FinalProcessorError('network_error', 0));
    const error = (await w.service
      .start('DA-2026-00042', 'stripe_card')
      .catch((e: unknown) => e)) as HttpException;
    expect(error.getStatus()).toBe(503);
    expect(JSON.stringify(error.getResponse())).not.toContain('network_error');
  });
});

// --- the webhook route --------------------------------------------------------

describe('POST /v1/webhooks/final-processor', () => {
  function controller() {
    const w = world();
    const processEvent = asyncFn(() => 'applied' as const);
    const instance = new CheckoutController(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      w.fp,
      { processEvent } as unknown as FpPaymentsService,
    );
    return { instance, processEvent };
  }
  const request = (body: string, headers: Record<string, string>) =>
    ({ rawBody: Buffer.from(body, 'utf8'), headers }) as never;

  it('accepts a correctly signed body', async () => {
    const { instance, processEvent } = controller();
    const body = JSON.stringify(event('payment.succeeded'));
    await expect(instance.finalProcessorWebhook(request(body, sign(body)))).resolves.toEqual({
      received: true,
    });
    expect(processEvent).toHaveBeenCalledTimes(1);
  });

  it('answers 401 to a wrong signature and changes nothing', async () => {
    const { instance, processEvent } = controller();
    const body = JSON.stringify(event('payment.succeeded'));
    await expect(
      instance.finalProcessorWebhook(request(body, sign(body, 'fpsec_somebody_else'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it('answers 401 to a body modified after signing', async () => {
    const { instance, processEvent } = controller();
    const body = JSON.stringify(event('payment.succeeded'));
    const tampered = body.replace('"2550"', '"1"');
    await expect(
      instance.finalProcessorWebhook(request(tampered, sign(body))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it('answers 401 to a stale timestamp', async () => {
    const { instance, processEvent } = controller();
    const body = JSON.stringify(event('payment.succeeded'));
    const old = Math.floor(Date.now() / 1000) - 600;
    await expect(
      instance.finalProcessorWebhook(request(body, sign(body, SECRET, old))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it('flattens Fastify headers for the SDK', () => {
    expect(flatHeaders({ 'X-FP-Signature': ['v1=a', 'v1=b'], 'x-fp-timestamp': '1' })).toEqual({
      'x-fp-signature': 'v1=a',
      'x-fp-timestamp': '1',
    });
  });
});

// --- applying events ----------------------------------------------------------

describe('Final Processor events', () => {
  it('marks a verified success paid and runs fulfilment once', async () => {
    const w = world();
    w.opened();
    expect(await w.service.processEvent(event('payment.succeeded'))).toBe('applied');

    expect(w.checkout.markPaid).toHaveBeenCalledTimes(1);
    expect(w.checkout.markPaid.mock.calls[0]?.[0]).toMatchObject({
      orderNumber: 'DA-2026-00042',
      provider: 'FINAL_PROCESSOR',
      providerRef: 'pay_fp_1',
      chargedCurrency: 'USD',
      amountMinor: 2550,
      testMode: true,
    });
    expect(w.fulfillment.onOrderPaid).toHaveBeenCalledTimes(1);
    expect(w.fulfillment.onOrderPaid).toHaveBeenCalledWith('DA-2026-00042');
    expect(w.logs.map((row) => row.result)).toEqual(['applied']);
  });

  it('answers a duplicate delivery 2xx and changes nothing', async () => {
    const w = world();
    w.opened();
    const once = event('payment.succeeded', {}, 'evt_same');
    await w.service.processEvent(once);
    expect(await w.service.processEvent(once)).toBe('duplicate');

    expect(w.checkout.markPaid).toHaveBeenCalledTimes(1);
    expect(w.fulfillment.onOrderPaid).toHaveBeenCalledTimes(1);
    expect(w.logs.map((row) => row.result)).toEqual(['applied', 'duplicate']);
  });

  it.each([
    ['amount', { amount_minor: '2549' }, 'amount_minor'],
    ['currency', { currency: 'EUR' }, 'currency'],
    ['order_ref', { order_ref: 'ord_other' }, 'order_ref'],
  ])('does not mark paid on a %s mismatch, and flags it', async (_name, data, field) => {
    const w = world();
    w.opened();
    expect(await w.service.processEvent(event('payment.succeeded', data))).toBe('mismatch');

    expect(w.checkout.markPaid).not.toHaveBeenCalled();
    expect(w.fulfillment.onOrderPaid).not.toHaveBeenCalled();
    expect(w.order.status).toBe('PENDING_PAYMENT');
    expect(w.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payment.fp.mismatch',
        after: expect.objectContaining({ fields: [field] }) as unknown,
      }),
    );
    expect(w.notes[0]?.body).toContain('NOT marked paid');
    expect(w.logs.map((row) => row.result)).toEqual(['mismatch']);
  });

  it('does not mark paid a payment this shop never opened', async () => {
    const w = world();
    expect(await w.service.processEvent(event('payment.succeeded'))).toBe('mismatch');
    expect(w.checkout.markPaid).not.toHaveBeenCalled();
  });

  it('flags money that arrives for an order already closed', async () => {
    const w = world();
    w.opened();
    w.order.status = 'CANCELLED';
    expect(await w.service.processEvent(event('payment.succeeded'))).toBe('mismatch');
    expect(w.fulfillment.onOrderPaid).not.toHaveBeenCalled();
    expect(w.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.fp.closed-order' }),
    );
  });

  it('expires a pending order when its payment session fails', async () => {
    const w = world();
    const payment = w.opened();
    expect(await w.service.processEvent(event('payment.failed', { status: 'failed' }))).toBe(
      'applied',
    );
    expect(payment.state).toBe('FAILED');
    expect(w.order.status).toBe('CANCELLED');
    expect(w.statusEvents[0]).toMatchObject({ from: 'PENDING_PAYMENT', to: 'CANCELLED' });
  });

  it('keeps the order open when the customer was sent bank-transfer details', async () => {
    const w = world();
    w.opened();
    w.client.notificationLog.count.mockResolvedValueOnce(1);
    await w.service.processEvent(event('payment.failed', { status: 'failed' }));
    expect(w.order.status).toBe('PENDING_PAYMENT');
  });

  it('answers 5xx (rethrows) on a failure, logs it, and leaves the event retryable', async () => {
    const w = world();
    w.opened();
    w.checkout.markPaid.mockRejectedValueOnce(new Error('database went away'));
    const once = event('payment.succeeded', {}, 'evt_retry');
    await expect(w.service.processEvent(once)).rejects.toThrow('database went away');
    expect(w.logs.map((row) => row.result)).toEqual(['error']);

    // The retry does the work.
    expect(await w.service.processEvent(once)).toBe('applied');
    expect(w.order.status).toBe('PAID');
  });

  it('records a refund reported by webhook once, keyed by refund_id', async () => {
    const w = world();
    w.paid();
    const refunded = {
      status: 'succeeded' as const,
      refunded_minor: '1000',
      refund: {
        refund_id: 'rf_1',
        refund_ref: 'proc_ref_1',
        amount_minor: '1000',
        status: 'succeeded' as const,
      },
    };
    await w.service.processEvent(event('payment.refunded', refunded));
    // Delivered again under a new event id: still one refund.
    await w.service.processEvent(event('payment.refunded', refunded));

    expect(w.refunds).toHaveLength(1);
    expect(w.refunds[0]).toMatchObject({ providerRef: 'rf_1', status: 'SUCCEEDED' });
    expect(String(w.refunds[0]?.amountUsd)).toBe('10');
    expect(w.order.status).toBe('PARTIALLY_REFUNDED');
    expect(String(w.payments[0]?.refundedUsd)).toBe('10');
  });

  it('marks the order refunded when the processor says the payment is refunded', async () => {
    const w = world();
    w.paid();
    await w.service.processEvent(
      event('payment.refunded', {
        status: 'refunded',
        refunded_minor: '2550',
        refund: { refund_id: 'rf_1', refund_ref: 'x', amount_minor: '2550', status: 'succeeded' },
      }),
    );
    expect(w.order.status).toBe('REFUNDED');
    expect(w.payments[0]?.state).toBe('REFUNDED');
  });

  it('marks a failed refund failed and alerts staff', async () => {
    const w = world();
    w.paid();
    await w.service.processEvent(
      event('refund.failed', {
        refund: { refund_id: 'rf_9', refund_ref: 'r9', amount_minor: '500', status: 'failed' },
      }),
    );
    expect(w.refunds[0]).toMatchObject({ providerRef: 'rf_9', status: 'FAILED' });
    expect(w.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'payment.fp.refund-failed' }),
    );
  });
});

// --- refunds from the panel -----------------------------------------------------

describe('refunding from the panel', () => {
  it('refunds part, then the rest: partially refunded, then refunded, each once', async () => {
    const w = world();
    w.paid();
    let n = 0;
    w.sdk.refund.mockImplementation((_paymentId, input) =>
      Promise.resolve({
        refund_id: `rf_${String((n += 1))}`,
        refund_ref: input.refundRef,
        amount_minor: input.amountMinor,
        currency: 'USD',
        status: 'succeeded' as const,
        created_at: '2026-09-30T12:00:00Z',
      }),
    );

    const first = await w.service.refund({
      number: 'DA-2026-00042',
      reason: 'customer asked',
      staffId: 'staff_1',
      amount: '10.00',
    });
    expect(first).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      via: 'final_processor',
      refund: { amountUsd: '10.00', status: 'SUCCEEDED' },
    });
    // A fresh reference, the refund row's own id.
    const firstRow = w.refunds[0];
    expect(w.sdk.refund).toHaveBeenLastCalledWith('pay_fp_1', {
      refundRef: firstRow?.id,
      amountMinor: '1000',
    });
    expect(firstRow?.refundRef).toBe(firstRow?.id);

    const rest = await w.service.refund({
      number: 'DA-2026-00042',
      reason: 'the rest',
      staffId: 'staff_1',
    });
    expect(rest).toMatchObject({ status: 'REFUNDED', refund: { amountUsd: '15.50' } });
    expect(w.sdk.refund).toHaveBeenLastCalledWith('pay_fp_1', {
      refundRef: w.refunds[1]?.id,
      amountMinor: '1550',
    });
    expect(w.refunds).toHaveLength(2);
    expect(w.payments[0]?.state).toBe('REFUNDED');

    // Now the processor's webhooks for both arrive: nothing new is recorded.
    await w.service.processEvent(
      event('payment.refunded', {
        status: 'refunded',
        refunded_minor: '2550',
        refund: {
          refund_id: 'rf_2',
          refund_ref: String(w.refunds[1]?.id),
          amount_minor: '1550',
          status: 'succeeded',
        },
      }),
    );
    expect(w.refunds).toHaveLength(2);
  });

  it('refuses more than paid less refunded, before asking the processor', async () => {
    const w = world();
    w.paid();
    await expect(
      w.service.refund({
        number: 'DA-2026-00042',
        reason: 'too much',
        staffId: 's',
        amountMinor: '2551',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(w.sdk.refund).not.toHaveBeenCalled();
    expect(w.refunds).toHaveLength(0);
  });

  it('maps a processor refusal to its code and records the refund failed', async () => {
    const w = world();
    w.paid();
    w.sdk.refund.mockRejectedValueOnce(new FinalProcessorError('refund_not_supported', 422));
    const error = (await runWithPanelLocale('en', () =>
      w.service.refund({ number: 'DA-2026-00042', reason: 'nope', staffId: 's' }),
    ).catch((e: unknown) => e)) as HttpException;
    expect(error.getStatus()).toBe(400);
    expect(error.getResponse()).toMatchObject({ code: 'refund_not_supported' });
    expect(w.refunds[0]).toMatchObject({ status: 'FAILED', failureCode: 'refund_not_supported' });
  });

  it('keeps a refund pending on a network error and retries it with the same reference', async () => {
    const w = world();
    w.paid();
    w.sdk.refund.mockRejectedValueOnce(new FinalProcessorError('network_error', 0));
    await expect(
      w.service.refund({ number: 'DA-2026-00042', reason: 'flaky', staffId: 's', amount: '5.00' }),
    ).rejects.toMatchObject({ status: 503 });
    const reference = w.refunds[0]?.refundRef;
    expect(w.refunds[0]?.status).toBe('PENDING');

    w.sdk.refund.mockResolvedValueOnce({
      refund_id: 'rf_1',
      refund_ref: String(reference),
      amount_minor: '500',
      currency: 'USD',
      status: 'succeeded',
      created_at: '2026-09-30T12:00:00Z',
    });
    await w.service.refund({ number: 'DA-2026-00042', reason: 'flaky', staffId: 's' });
    expect(w.sdk.refund).toHaveBeenLastCalledWith('pay_fp_1', {
      refundRef: reference,
      amountMinor: '500',
    });
    expect(w.refunds).toHaveLength(1);
  });
});

// --- the return page's check ---------------------------------------------------

describe('GET /v1/checkout/final-processor/status/:number', () => {
  it('reads nothing but the order number: no query, no request', () => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      CheckoutController,
      'finalProcessorStatus',
    ) as Record<string, { data?: string }>;
    const keys = Object.keys(args);
    expect(keys).toHaveLength(1);
    // RouteParamtypes.PARAM is 5; QUERY (4) and REQUEST (0) must be absent.
    expect(keys[0]?.startsWith('5:')).toBe(true);
    expect(Object.values(args)[0]?.data).toBe('number');
  });

  it('confirms an unpaid order with getPayment and stays pending while the processor does', async () => {
    const w = world();
    w.opened();
    w.sdk.getPayment.mockResolvedValueOnce({
      payment_id: 'pay_fp_1',
      order_ref: 'ord_1',
      order_number: 'DA-2026-00042',
      status: 'pending',
      amount_minor: '2550',
      currency: 'USD',
      method: 'stripe_card',
      refunded_minor: '0',
      test_mode: true,
      created_at: '',
      expires_at: '',
      succeeded_at: null,
      refunds: [],
    });
    expect(await w.service.confirmStatus('DA-2026-00042')).toEqual({ status: 'pending' });
    expect(w.sdk.getPayment).toHaveBeenCalledWith('pay_fp_1');
    expect(w.checkout.markPaid).not.toHaveBeenCalled();
    expect(w.order.status).toBe('PENDING_PAYMENT');
  });

  it('marks paid only through the verified path when getPayment says succeeded', async () => {
    const w = world();
    w.opened();
    w.sdk.getPayment.mockResolvedValueOnce({
      payment_id: 'pay_fp_1',
      order_ref: 'ord_1',
      order_number: 'DA-2026-00042',
      status: 'succeeded',
      amount_minor: '2550',
      currency: 'USD',
      method: 'stripe_card',
      refunded_minor: '0',
      test_mode: false,
      created_at: '',
      expires_at: '',
      succeeded_at: '2026-09-30T12:00:00Z',
      refunds: [],
    });
    expect(await w.service.confirmStatus('DA-2026-00042')).toEqual({ status: 'paid' });
    expect(w.fulfillment.onOrderPaid).toHaveBeenCalledTimes(1);
  });

  it('does not mark paid when getPayment reports another amount', async () => {
    const w = world();
    w.opened();
    w.sdk.getPayment.mockResolvedValueOnce({
      payment_id: 'pay_fp_1',
      order_ref: 'ord_1',
      order_number: null,
      status: 'succeeded',
      amount_minor: '100',
      currency: 'USD',
      method: 'stripe_card',
      refunded_minor: '0',
      test_mode: false,
      created_at: '',
      expires_at: '',
      succeeded_at: null,
      refunds: [],
    });
    expect(await w.service.confirmStatus('DA-2026-00042')).toEqual({ status: 'pending' });
    expect(w.checkout.markPaid).not.toHaveBeenCalled();
  });
});

// --- methods, the cache and the admin view -------------------------------------

describe('Final Processor methods', () => {
  it('caches the processor list for at most five minutes', async () => {
    vi.useFakeTimers();
    try {
      const w = world();
      await w.fp.methods();
      await w.fp.methods();
      expect(w.sdk.listMethods).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(FP_METHODS_TTL_MS + 1);
      await w.fp.methods();
      expect(w.sdk.listMethods).toHaveBeenCalledTimes(2);
      await w.fp.methods({ fresh: true });
      expect(w.sdk.listMethods).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers the checkout the admin’s label, icon and description, in the admin’s order', async () => {
    const w = world();
    w.sdk.listMethods.mockResolvedValue([
      card,
      { ...card, id: 'crypto', label: 'Crypto', labels: {}, test_mode: false },
    ]);
    w.configs.push(
      {
        id: 'crypto',
        enabled: true,
        displayName: null,
        iconUrl: null,
        shortDescription: null,
        displayOrder: 1,
      },
      {
        id: 'stripe_card',
        enabled: true,
        displayName: 'Visa / Mastercard',
        iconUrl: '/media/card.svg',
        shortDescription: 'Pay by card',
        displayOrder: 2,
      },
    );
    expect(await w.settings.finalProcessorMethods('ar')).toEqual([
      { id: 'crypto', label: 'Crypto', iconUrl: card.icon_url, description: null },
      {
        id: 'stripe_card',
        label: 'Visa / Mastercard',
        iconUrl: '/media/card.svg',
        description: 'Pay by card',
      },
    ]);
  });

  it('says why a method is hidden', async () => {
    const w = world();
    w.sdk.listMethods.mockResolvedValue([card, { ...card, id: 'eur_only', currencies: ['EUR'] }]);
    w.configs.push(
      { id: 'stripe_card', enabled: false, displayOrder: 0 },
      { id: 'gone', enabled: true, displayOrder: 0 },
    );
    const overview = await w.settings.finalProcessorOverview();
    const reasons = Object.fromEntries(overview.methods.map((m) => [m.id, m.hiddenReasons]));
    expect(reasons).toEqual({
      stripe_card: ['disabled_here'],
      eur_only: ['currency_not_offered'],
      gone: ['not_returned_by_processor'],
    });
    expect(overview.testMode).toBe(true);
    expect(overview.env.secret).toBeTypeOf('boolean');
    expect(JSON.stringify(overview)).not.toContain(SECRET);
    expect(overview.webhookUrl).toBe('https://api.example.test/v1/webhooks/final-processor');
  });

  it('hides every method while the connection fails', async () => {
    const w = world();
    w.sdk.listMethods.mockRejectedValue(new FinalProcessorError('invalid_signature', 401));
    w.configs.push({ id: 'stripe_card', enabled: true, displayOrder: 0 });
    const overview = await w.settings.finalProcessorOverview({ fresh: true });
    expect(overview.connection).toMatchObject({ ok: false, errorCode: 'invalid_signature' });
    expect(overview.methods[0]?.hiddenReasons).toEqual(['connection_failing']);
    expect(await w.settings.finalProcessorMethods('en')).toEqual([]);
    expect(await w.settings.offeredProviders()).not.toContain('FINAL_PROCESSOR');
  });
});

// --- error mapping ------------------------------------------------------------

describe('Final Processor error mapping', () => {
  it('explains each code to staff, in the panel’s language', () => {
    const codes = [
      'invalid_signature',
      'stale_timestamp',
      'invalid_webhook_url',
      'invalid_return_url',
      'refund_exceeds_balance',
      'network_error',
    ];
    for (const code of codes) {
      const en = runWithPanelLocale('en', () => fpAdminMessage(code));
      const ar = runWithPanelLocale('ar', () => fpAdminMessage(code));
      expect(en).not.toBe(ar);
      expect(en.length).toBeGreaterThan(10);
    }
    expect(runWithPanelLocale('en', () => fpAdminMessage('invalid_signature'))).toMatch(/secret/i);
    expect(runWithPanelLocale('en', () => fpAdminMessage('stale_timestamp'))).toMatch(/clock/i);
    expect(
      runWithPanelLocale('en', () => fpAdminMessage('invalid_request', 'amount_minor')),
    ).toContain('amount_minor');
    expect(runWithPanelLocale('en', () => fpAdminMessage('something_new'))).toContain(
      'something_new',
    );
  });

  it('tells customers something short and generic, never a code', () => {
    for (const kind of ['unavailable', 'retry', 'order_changed', 'failed'] as const) {
      for (const locale of ['ar', 'en'] as const) {
        expect(fpCustomerMessage(locale, kind)).not.toMatch(/_/);
      }
    }
  });

  it('knows which codes are worth retrying', () => {
    expect(isTransientFpCode('network_error')).toBe(true);
    expect(isTransientFpCode('rate_limited')).toBe(true);
    expect(isTransientFpCode('http_502')).toBe(true);
    expect(isTransientFpCode('refund_failed')).toBe(false);
  });
});

// --- access ---------------------------------------------------------------------

describe('Final Processor admin access', () => {
  it('guards every admin route with StaffGuard and OWNER/ADMIN', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FinalProcessorAdminController)).toContain(
      StaffGuard,
    );
    expect(Reflect.getMetadata(ROLES_KEY, FinalProcessorAdminController)).toEqual([
      'OWNER',
      'ADMIN',
    ]);
    for (const method of ['overview', 'connect', 'saveMethod', 'events'] as const) {
      const handler = Reflect.get(FinalProcessorAdminController.prototype, method) as object;
      const own = Reflect.getMetadata(ROLES_KEY, handler) as unknown;
      // No route widens the class's roles.
      expect(own === undefined || JSON.stringify(own) === JSON.stringify(['OWNER', 'ADMIN'])).toBe(
        true,
      );
    }
  });

  it('keeps the refund route OWNER/ADMIN', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OrdersController)).toContain(StaffGuard);
    const handler = Reflect.get(OrdersController.prototype, 'refund') as object;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['OWNER', 'ADMIN']);
  });
});

describe('FpLogPruneService', () => {
  it('drops rows older than thirty days, under its lock', async () => {
    const w = world();
    const service = new FpLogPruneService({ client: w.client } as unknown as PrismaService);
    const now = new Date('2026-09-30T03:17:00Z');
    expect(await service.sweep(now)).toEqual({ deleted: 3 });
    expect(w.client.$queryRaw).toHaveBeenCalled();
    expect(w.client.paymentWebhookLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-08-31T03:17:00Z') } },
    });
  });
});
