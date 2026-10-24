import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { VaultService } from '../vault/vault.service.js';

import { AccountService } from './account.service.js';

/**
 * BUG-0030: the customer's own reveal obeys the holds staff delivery obeys.
 * A line that has not been sent, or that sits on a HIGH or BLOCKED risk order
 * (an open dispute), gives the buyer nothing to read — checked without a
 * database, on the query the service asks for and on what it does with the
 * answer.
 */

/** The `where` of the first call to a mocked Prisma read. */
function whereOf(fn: { mock: { calls: unknown[][] } }) {
  return (fn.mock.calls[0]?.[0] as { where: { order: Record<string, unknown> } }).where;
}

const actor = { customerId: 'c1', ip: '203.0.113.7', userAgent: 'test' };

function build(found: { id: string; fulfillmentState: string } | null) {
  const findFirst = vi.fn().mockResolvedValue(found);
  const revealForCustomer = vi.fn().mockResolvedValue([{ kind: 'KEY', key: 'AAAA-BBBB' }]);
  const resendLicence = vi.fn().mockResolvedValue({ to: 'buyer@example.com' });
  const service = new AccountService(
    { client: { orderItem: { findFirst } } } as unknown as PrismaService,
    { revealForCustomer } as unknown as VaultService,
    { resendLicence } as unknown as FulfillmentService,
    {} as MailService,
  );
  return { service, findFirst, revealForCustomer, resendLicence };
}

describe('AccountService.reveal holds (BUG-0030)', () => {
  it('asks only for lines on orders that are not held for risk', async () => {
    const { service, findFirst } = build({ id: 'i1', fulfillmentState: 'DELIVERED' });
    await service.reveal({ orderItemId: 'i1', actor });

    const where = whereOf(findFirst);
    expect(where.order.customerId).toBe('c1');
    expect(where.order.riskLevel).toEqual({ notIn: ['HIGH', 'BLOCKED'] });
  });

  it('answers a held order (no row back) as not found, and opens nothing', async () => {
    const { service, revealForCustomer } = build(null);
    await expect(service.reveal({ orderItemId: 'i1', actor })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(revealForCustomer).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'MANUAL_QUEUE', 'AUTO_ASSIGNED', 'FAILED'])(
    'refuses a line that is %s and opens nothing',
    async (state) => {
      const { service, revealForCustomer } = build({ id: 'i1', fulfillmentState: state });
      await expect(service.reveal({ orderItemId: 'i1', actor })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(revealForCustomer).not.toHaveBeenCalled();
    },
  );

  it('opens a delivered line on a clear order, as the customer', async () => {
    const { service, revealForCustomer } = build({ id: 'i1', fulfillmentState: 'DELIVERED' });
    const secrets = await service.reveal({ orderItemId: 'i1', actor });

    expect(secrets).toHaveLength(1);
    const call = revealForCustomer.mock.calls[0]?.[0] as {
      orderItemId: string;
      actor: { staffId: string; kind: string };
    };
    expect(call.orderItemId).toBe('i1');
    expect(call.actor).toMatchObject({ staffId: 'c1', kind: 'CUSTOMER' });
  });

  it('applies the same hold to the resend', async () => {
    const { service, findFirst, resendLicence } = build(null);
    await expect(service.resend({ orderItemId: 'i1', actor })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(whereOf(findFirst).order.riskLevel).toEqual({
      notIn: ['HIGH', 'BLOCKED'],
    });
    expect(resendLicence).not.toHaveBeenCalled();
  });
});
