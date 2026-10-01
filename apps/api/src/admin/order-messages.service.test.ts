import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '@da/db';

import type { AuditService } from '../auth/audit.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ReviewsService } from '../reviews/reviews.service.js';

import { OrderMessagesService } from './order-messages.service.js';

// The order link and the unsubscribe token are HMACs over this secret.
process.env.JWT_ACCESS_SECRET ??= 'test-secret-for-order-links';
process.env.NEWSLETTER_SECRET ??= 'test-secret-for-newsletter';

/**
 * The rules the order page relies on, checked without a database: the
 * recipient is the order's, an offer needs consent and is withdrawn when its
 * email never left, a receipt is refused where it would be a lie, and no
 * message body reaches a log payload.
 */

type Order = Record<string, unknown>;

function order(overrides: Order = {}): Order {
  return {
    id: 'o1',
    number: 'DA-2026-00001',
    email: 'buyer@example.com',
    locale: 'AR',
    status: 'PAID',
    paidAt: new Date('2026-10-01T10:00:00Z'),
    currency: 'SAR',
    fxRate: new Prisma.Decimal('3.75'),
    totalUsd: new Prisma.Decimal('30.00'),
    customerId: 'c1',
    customer: {
      id: 'c1',
      firstName: 'Sara',
      marketingOptInAt: new Date('2026-01-01'),
      marketingOptOutAt: null,
    },
    items: [],
    payments: [
      {
        state: 'SUCCEEDED',
        amountCharged: new Prisma.Decimal('30.000'),
        chargedCurrency: 'USD',
      },
    ],
    ...overrides,
  };
}

function build(found: Order | null, sendOk = true) {
  const promotionCreate = vi.fn().mockResolvedValue({ id: 'p1', code: 'OFFER-ABCDEFGHJK' });
  const promotionUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    client: {
      order: { findUnique: vi.fn().mockResolvedValue(found) },
      promotion: { create: promotionCreate, update: promotionUpdate },
      reviewInvite: { findUnique: vi.fn().mockResolvedValue(null) },
    },
  } as unknown as PrismaService;
  const send = vi.fn().mockResolvedValue({ ok: sendOk, error: sendOk ? null : 'smtp down' });
  const mail = { send, supportEmail: 'help@example.com' } as unknown as MailService;
  const invite = vi.fn().mockResolvedValue({ sent: true });
  const reviews = { invite } as unknown as ReviewsService;
  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;
  const settings = {
    get: vi.fn().mockResolvedValue({ discountLicenceNumber: 'LIC-1' }),
  } as unknown as MarketingSettingsService;
  const service = new OrderMessagesService(prisma, mail, reviews, audit, settings);
  return { service, send, invite, record, promotionCreate, promotionUpdate };
}

const context = { ip: '127.0.0.1', userAgent: 'vitest' };
const asOwner = { staffId: 's1', staffRole: 'OWNER', context } as const;

describe('OrderMessagesService', () => {
  it('sends the receipt to the order address with the charged amount, and audits the real status', async () => {
    const { service, send, record } = build(order());

    const result = await service.send({
      number: 'DA-2026-00001',
      body: { kind: 'payment_received', validDays: 14 },
      ...asOwner,
    });

    expect(result).toMatchObject({ sent: true, to: 'buyer@example.com', skipped: null });
    const call = send.mock.calls[0]?.[0] as {
      to: string;
      rendered: { text: string };
      payload: unknown;
    };
    expect(call.to).toBe('buyer@example.com');
    // The payment row's charge, never totalUsd × fxRate.
    expect(call.rendered.text).toContain('30.00 USD');
    expect(call.rendered.text).not.toContain('112.50');
    expect(call.payload).toEqual({ orderNumber: 'DA-2026-00001', byStaff: true });
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      action: 'order.message_sent',
      after: { kind: 'payment_received', sent: true, status: 'PAID' },
    });
  });

  it('refuses the receipt where it would be a lie: unpaid, or the money already went back', async () => {
    for (const status of ['PENDING_PAYMENT', 'REFUNDED', 'CANCELLED']) {
      const { service, send } = build(
        order({ status, paidAt: status === 'PENDING_PAYMENT' ? null : new Date() }),
      );
      const result = await service.send({
        number: 'DA-2026-00001',
        body: { kind: 'payment_received', validDays: 14 },
        ...asOwner,
      });
      expect(result.sent).toBe(false);
      expect(result.skipped).toBe('not_paid');
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('refuses an offer without marketing consent', async () => {
    const { service, send, promotionCreate } = build(
      order({
        customer: { id: 'c1', firstName: 'Sara', marketingOptInAt: null, marketingOptOutAt: null },
      }),
    );

    await expect(
      service.send({
        number: 'DA-2026-00001',
        body: { kind: 'offer', percent: 10, validDays: 14 },
        ...asOwner,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(promotionCreate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('lets only the owner or an admin issue a discount code', async () => {
    const { service, promotionCreate } = build(order());

    await expect(
      service.send({
        number: 'DA-2026-00001',
        body: { kind: 'offer', percent: 10, validDays: 14 },
        staffId: 's2',
        staffRole: 'SUPPORT',
        context,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(promotionCreate).not.toHaveBeenCalled();
  });

  it('mints a single-use code for the customer and withdraws it when the email never left', async () => {
    const { service, send, promotionCreate, promotionUpdate } = build(order(), false);

    const result = await service.send({
      number: 'DA-2026-00001',
      body: { kind: 'offer', percent: 15, validDays: 7 },
      ...asOwner,
    });

    expect(promotionCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        type: 'PERCENT',
        singleUse: true,
        usageLimit: 1,
        perCustomerLimit: 1,
        issuedToId: 'c1',
        createdById: 's1',
      },
    });
    const call = send.mock.calls[0]?.[0] as { kind: string; headers?: Record<string, string> };
    expect(call.kind).toBe('marketing');
    expect(call.headers?.['List-Unsubscribe']).toBeTruthy();
    expect(result).toMatchObject({ sent: false, code: null });
    expect(promotionUpdate).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isActive: false },
    });
  });

  it('logs only the subject of a staff message, never its body', async () => {
    const { service, send } = build(order());

    await service.send({
      number: 'DA-2026-00001',
      body: { kind: 'custom', subject: 'About your key', body: 'SECRET-BODY-TEXT', validDays: 14 },
      ...asOwner,
    });

    const call = send.mock.calls[0]?.[0] as {
      payload: Record<string, unknown>;
      rendered: { html: string };
    };
    expect(call.payload).toEqual({
      orderNumber: 'DA-2026-00001',
      subject: 'About your key',
      byStaff: true,
    });
    expect(JSON.stringify(call.payload)).not.toContain('SECRET-BODY-TEXT');
    expect(call.rendered.html).toContain('SECRET-BODY-TEXT');
  });

  it('skips a review request on a guest order rather than faking a send', async () => {
    const { service, invite } = build(order({ customerId: null, customer: null }));

    const result = await service.send({
      number: 'DA-2026-00001',
      body: { kind: 'review_request', validDays: 14 },
      ...asOwner,
    });

    expect(result).toMatchObject({ sent: false, skipped: 'guest_order' });
    expect(invite).not.toHaveBeenCalled();
  });
});
