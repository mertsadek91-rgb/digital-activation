import {
  ActorType,
  FulfillmentMode,
  FulfillmentState,
  Locale,
  OrderStatus,
  RiskLevel,
} from '@da/db';
import { Logger } from '@nestjs/common';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../auth/audit.service.js';
import type { MailService } from '../mail/mail.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Actor, VaultService } from '../vault/vault.service.js';

import { FulfillmentService, deliveryLockKey } from './fulfillment.service.js';

/**
 * BUG-0021: a stocked line is sent on payment, once, and only when it may be.
 *
 * The database, the vault and the mail transport are in-memory fakes that keep
 * just enough state to answer the questions that matter here: how many licence
 * emails left, what the line ended up as, and who the vault recorded as having
 * opened the key — and whether it recorded that before the key was opened.
 */

interface FakeItem {
  id: string;
  orderId: string;
  variantId: string;
  qty: number;
  fulfillmentState: FulfillmentState;
  assignedKeyIds: string[];
  deliveredAt: Date | null;
  skuSnapshot: string;
  productNameSnapshot: string;
  lineTotalUsd: { toFixed: (digits: number) => string };
}

function build(options?: {
  riskLevel?: RiskLevel;
  mailFails?: boolean;
  /** Whether the per-line delivery lock is free. */
  lockFree?: boolean;
  /** The process dies after the email left, before the line was marked. */
  crashAfterMail?: boolean;
}) {
  const money = (value: number) => ({ toFixed: (digits: number) => value.toFixed(digits) });
  const order = {
    id: 'order-1',
    number: 'DA-1001',
    status: OrderStatus.PAID as OrderStatus,
    riskLevel: options?.riskLevel ?? RiskLevel.LOW,
    email: 'buyer@example.test',
    activationEmail: null,
    locale: Locale.AR,
    customerId: null,
    totalUsd: money(20),
  };
  const items: FakeItem[] = [
    {
      id: 'item-1',
      orderId: order.id,
      variantId: 'variant-stocked',
      qty: 1,
      fulfillmentState: FulfillmentState.PENDING,
      assignedKeyIds: [],
      deliveredAt: null,
      skuSnapshot: 'WIN-11-PRO',
      productNameSnapshot: 'Windows 11 Pro',
      lineTotalUsd: money(20),
    },
  ];
  const variant = {
    fulfillmentMode: FulfillmentMode.FROM_STOCK,
    deliverySlaSeconds: 60,
    warrantyDays: 30,
    product: { hasGoldenWarranty: false, translations: [] },
  };

  /** Everything observable, in the order it happened. */
  const events: string[] = [];
  const licenceMails: string[] = [];
  const accessLog: { actorId: string; actorType: ActorType | undefined }[] = [];
  const audits: { actorId?: string | undefined; actorType?: ActorType | undefined }[] = [];
  const locks: number[] = [];
  const transport = { fails: options?.mailFails ?? false };
  /** The NotificationLog rows mail.send wrote, as the real service does. */
  const notificationLog: {
    template: string;
    deliveredAt: Date | null;
    payload: Record<string, unknown>;
  }[] = [];
  const crash = { armed: options?.crashAfterMail ?? false };
  let bound: string | null = null;

  const itemById = (id: string) => items.find((item) => item.id === id);
  const withOrder = (item: FakeItem) => ({ ...item, order, variant });

  const tx = {
    $queryRaw: (_strings: TemplateStringsArray, key: number) => {
      locks.push(key);
      return Promise.resolve([{ locked: options?.lockFree ?? true }]);
    },
    order: {
      findUniqueOrThrow: () => Promise.resolve({ status: order.status }),
      updateMany: ({ data }: { data: { status: OrderStatus } }) => {
        order.status = data.status;
        return Promise.resolve({ count: 1 });
      },
    },
    orderStatusEvent: { create: () => Promise.resolve({}) },
  };

  const prisma = {
    client: {
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
      notificationLog: {
        findFirst: ({
          where,
        }: {
          where: {
            template: string;
            deliveredAt: { not: null };
            payload: { path: string[]; equals: unknown };
          };
        }) => {
          const [field] = where.payload.path;
          const found = notificationLog.find(
            (row) =>
              row.template === where.template &&
              row.deliveredAt !== null &&
              field !== undefined &&
              row.payload[field] === where.payload.equals,
          );
          return Promise.resolve(found ? { id: 'log-1' } : null);
        },
      },
      variant: {
        findUnique: () => Promise.resolve({ credentialKind: 'ACTIVATION_KEY' }),
      },
      order: {
        findUnique: () =>
          Promise.resolve({ ...order, items: items.map((item) => ({ ...item, variant })) }),
      },
      orderItem: {
        findUnique: ({ where }: { where: { id: string } }) => {
          const item = itemById(where.id);
          return Promise.resolve(item ? withOrder(item) : null);
        },
        findMany: () => Promise.resolve(items.map((item) => ({ ...item }))),
        update: ({ where, data }: { where: { id: string }; data: Partial<FakeItem> }) => {
          const item = itemById(where.id);
          if (!item) throw new Error('no item');
          Object.assign(item, data);
          return Promise.resolve({ ...item });
        },
        updateMany: ({
          where,
          data,
        }: {
          where: { id: string; fulfillmentState: FulfillmentState };
          data: Partial<FakeItem>;
        }) => {
          const item = itemById(where.id);
          if (!item || item.fulfillmentState !== where.fulfillmentState) {
            return Promise.resolve({ count: 0 });
          }
          Object.assign(item, data);
          return Promise.resolve({ count: 1 });
        },
      },
    },
  } as unknown as PrismaService;

  const vault = {
    fulfilManually: ({ orderItemId }: { orderItemId: string }) => {
      bound = orderItemId;
      return Promise.resolve({ licenseKeyId: 'key-pasted' });
    },
    assign: ({ orderItemId }: { orderItemId: string }) => {
      bound = orderItemId;
      return Promise.resolve({ assigned: ['key-1'], short: 0 });
    },
    isBound: (orderItemId: string) => Promise.resolve(bound === orderItemId),
    openForDelivery: ({ actor }: { orderItemId: string; actor: Actor }) => {
      accessLog.push({ actorId: actor.staffId, actorType: actor.kind });
      events.push('access-logged');
      events.push('opened');
      return Promise.resolve([
        { licenseKeyId: 'key-1', secret: { kind: 'LICENSE_KEY', key: 'AAAAA-BBBBB' } },
      ]);
    },
    keysForOrderItem: () =>
      Promise.resolve([{ licenseKeyId: 'key-1', state: 'ASSIGNED', deliveredAt: null }]),
    markDelivered: () => {
      if (crash.armed) {
        crash.armed = false;
        return Promise.reject(new Error('process died'));
      }
      events.push('vault-delivered');
      return Promise.resolve(1);
    },
  } as unknown as VaultService;

  const mail = {
    supportEmail: 'help@example.test',
    alreadySent: () => Promise.resolve(false),
    send: ({ template, payload }: { template: string; payload: Record<string, unknown> }) => {
      if (template === 'licence.delivered') {
        licenceMails.push(template);
        events.push(transport.fails ? 'mail-failed' : 'mailed');
        notificationLog.push({
          template,
          deliveredAt: transport.fails ? null : new Date(),
          payload,
        });
        return Promise.resolve(
          transport.fails
            ? { ok: false, ref: null, error: 'SMTP refused' }
            : { ok: true, ref: 'x', error: null },
        );
      }
      return Promise.resolve({ ok: true, ref: 'x', error: null });
    },
  } as unknown as MailService;

  const audit = {
    record: (input: { actorId?: string; actorType?: ActorType }) => {
      audits.push(input);
      return Promise.resolve();
    },
  } as unknown as AuditService;

  const service = new FulfillmentService(prisma, vault, audit, mail);
  return {
    service,
    order,
    items,
    events,
    licenceMails,
    accessLog,
    audits,
    locks,
    transport,
    notificationLog,
  };
}

const staff: Actor = { staffId: 'staff-1', totpAt: 0 };

describe('automatic delivery of stocked lines (BUG-0021)', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET ??= 'unit-tests-only-order-link-secret';
  });
  afterEach(() => {
    delete process.env.AUTO_DELIVERY;
  });

  it('sends a stocked line on payment, as the system', async () => {
    const world = build();
    const result = await world.service.onOrderPaid('DA-1001');

    expect(result).toMatchObject({ autoAssigned: 1, autoDelivered: 1 });
    expect(world.licenceMails).toHaveLength(1);
    expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.DELIVERED);
    expect(world.items[0]?.deliveredAt).toBeInstanceOf(Date);
    expect(world.order.status).toBe(OrderStatus.FULFILLED);

    // The key was logged as opened before it existed, sent, and only then
    // marked delivered.
    expect(world.events).toEqual(['access-logged', 'opened', 'mailed', 'vault-delivered']);
    expect(world.accessLog).toEqual([{ actorId: 'system', actorType: ActorType.SYSTEM }]);
    // The audit's actor is a staff foreign key; the system is named by type.
    expect(world.audits).toEqual([
      expect.objectContaining({ actorId: undefined, actorType: ActorType.SYSTEM }),
    ]);
    // Under the line's own lock.
    expect(world.locks).toEqual([deliveryLockKey('item-1')]);
  });

  it.each([RiskLevel.HIGH, RiskLevel.BLOCKED])(
    'does not send when the order is %s risk',
    async (riskLevel) => {
      const world = build({ riskLevel });
      const result = await world.service.onOrderPaid('DA-1001');

      expect(result).toMatchObject({ autoAssigned: 1, autoDelivered: 0 });
      expect(world.licenceMails).toHaveLength(0);
      // Not even opened: the hold comes before the vault is touched.
      expect(world.accessLog).toHaveLength(0);
      expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
    },
  );

  it('refuses a retry once a dispute has blocked the order', async () => {
    const world = build({ mailFails: true });
    await world.service.onOrderPaid('DA-1001');
    // A dispute lands while the line waits in the queue; mail has recovered.
    world.order.riskLevel = RiskLevel.BLOCKED;
    world.transport.fails = false;
    const opened = world.accessLog.length;

    await expect(
      world.service.deliverAssigned({
        orderItemId: 'item-1',
        actor: { staffId: 'staff-1', totpAt: 0 },
      }),
    ).rejects.toThrow(/موقوف للمراجعة/); // held for review;
    expect(world.accessLog).toHaveLength(opened);
    expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
  });

  it('sends once when the payment webhook is delivered twice', async () => {
    const world = build();
    await world.service.onOrderPaid('DA-1001');
    const again = await world.service.onOrderPaid('DA-1001');

    expect(again).toMatchObject({ autoAssigned: 0, autoDelivered: 0, skipped: 1 });
    expect(world.licenceMails).toHaveLength(1);
    expect(world.accessLog).toHaveLength(1);
  });

  it('sends once when two deliveries of the webhook race for the same line', async () => {
    const world = build();
    const [first, second] = await Promise.all([
      world.service.onOrderPaid('DA-1001'),
      world.service.onOrderPaid('DA-1001'),
    ]);

    // Both read the line as PENDING; only one wins the move out of it.
    expect(first.autoDelivered + second.autoDelivered).toBe(1);
    expect(world.licenceMails).toHaveLength(1);
    expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.DELIVERED);
  });

  it('refuses a second staff send of a line that has already gone', async () => {
    const world = build();
    await world.service.onOrderPaid('DA-1001');

    await expect(
      world.service.deliverAssigned({
        orderItemId: 'item-1',
        actor: { staffId: 'staff-1', totpAt: 0 },
      }),
    ).rejects.toThrow(/مُسلّم بالفعل/); // already delivered;
    expect(world.licenceMails).toHaveLength(1);
  });

  it('does not send while another caller holds the line', async () => {
    const world = build({ lockFree: false });
    const result = await world.service.onOrderPaid('DA-1001');

    expect(result.autoDelivered).toBe(0);
    expect(world.accessLog).toHaveLength(0);
    expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
  });

  it('leaves a line whose email failed in the queue, and a person can retry it', async () => {
    const world = build({ mailFails: true });
    const result = await world.service.onOrderPaid('DA-1001');

    // The webhook is not failed by it: the payment is recorded and stays so.
    expect(result).toMatchObject({ autoAssigned: 1, autoDelivered: 0 });
    expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
    expect(world.items[0]?.deliveredAt).toBeNull();
    expect(world.events).not.toContain('vault-delivered');
    expect(world.order.status).toBe(OrderStatus.PAID);

    // The staff retry reaches the same line and reports the failure.
    await expect(
      world.service.deliverAssigned({
        orderItemId: 'item-1',
        actor: { staffId: 'staff-1', totpAt: 0 },
      }),
    ).rejects.toThrow(/تعذّر إرسال البريد/); // the email could not be sent;
    expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
  });

  it('moves a pasted line whose email failed to "key bound, not sent", and the retry sends it (BUG-0029)', async () => {
    const world = build({ mailFails: true });
    const line = world.items[0];
    if (!line) throw new Error('no line');
    line.fulfillmentState = FulfillmentState.MANUAL_QUEUE;

    await expect(
      world.service.fulfilManually({
        orderItemId: 'item-1',
        secret: { kind: 'ACTIVATION_KEY', key: 'AAAAA-BBBBB-CCCCC' },
        actor: staff,
      }),
    ).rejects.toThrow(/المفتاح محفوظ ومربوط بالطلب/); // the key is stored and bound
    // Not MANUAL_QUEUE ("needs a supplier order") beside a bound key.
    expect(line.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
    expect(line.deliveredAt).toBeNull();

    world.transport.fails = false;
    const sent = await world.service.deliverAssigned({ orderItemId: 'item-1', actor: staff });
    expect(sent.state).toBe(FulfillmentState.DELIVERED);
    expect(line.fulfillmentState).toBe(FulfillmentState.DELIVERED);
  });

  it('delivers on the staff retry once mail recovers, in the staff member name', async () => {
    const world = build({ mailFails: true });
    await world.service.onOrderPaid('DA-1001');
    world.transport.fails = false;

    const sent = await world.service.deliverAssigned({
      orderItemId: 'item-1',
      actor: { staffId: 'staff-1', totpAt: 0 },
    });

    expect(sent).toEqual({ state: FulfillmentState.DELIVERED, keys: 1 });
    expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.DELIVERED);
    expect(world.order.status).toBe(OrderStatus.FULFILLED);
    expect(world.accessLog.at(-1)).toEqual({ actorId: 'staff-1', actorType: undefined });
    expect(world.audits.at(-1)).toEqual(
      expect.objectContaining({ actorId: 'staff-1', actorType: ActorType.STAFF }),
    );
  });

  it('names the line in the licence email log, and never the key', async () => {
    const world = build();
    await world.service.onOrderPaid('DA-1001');

    expect(world.notificationLog).toHaveLength(1);
    expect(world.notificationLog[0]?.payload).toEqual({
      orderNumber: 'DA-1001',
      orderItemId: 'item-1',
      sku: 'WIN-11-PRO',
      keyCount: 1,
    });
  });

  describe('AUTO_DELIVERY kill switch', () => {
    it('says so once at boot when it is off, and not when it is on', () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        build().service.onModuleInit();
        expect(warn).not.toHaveBeenCalled();

        process.env.AUTO_DELIVERY = 'off';
        build().service.onModuleInit();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[0]).toMatch(/AUTO_DELIVERY=off/);
      } finally {
        warn.mockRestore();
      }
    });

    it('sends on payment when it is on', async () => {
      process.env.AUTO_DELIVERY = 'on';
      const world = build();
      const result = await world.service.onOrderPaid('DA-1001');

      expect(result).toMatchObject({ autoAssigned: 1, autoDelivered: 1 });
      expect(world.licenceMails).toHaveLength(1);
      expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.DELIVERED);
    });

    it('assigns but does not send when it is off, leaving the line for staff', async () => {
      process.env.AUTO_DELIVERY = 'off';
      const world = build();
      const result = await world.service.onOrderPaid('DA-1001');

      expect(result).toMatchObject({ autoAssigned: 1, autoDelivered: 0 });
      expect(world.licenceMails).toHaveLength(0);
      // The key was never opened.
      expect(world.accessLog).toHaveLength(0);
      expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
      expect(world.items[0]?.assignedKeyIds).toEqual(['key-1']);
      expect(world.order.status).toBe(OrderStatus.PAID);

      // A person still sends it from the queue.
      const sent = await world.service.deliverAssigned({ orderItemId: 'item-1', actor: staff });
      expect(sent).toEqual({ state: FulfillmentState.DELIVERED, keys: 1 });
      expect(world.licenceMails).toHaveLength(1);
    });
  });

  describe('the crash window between the email and the DELIVERED mark', () => {
    it('does not email the key again; it finishes the line', async () => {
      const world = build({ crashAfterMail: true });
      const result = await world.service.onOrderPaid('DA-1001');

      // The email left, then the process died: the line is still AUTO_ASSIGNED.
      expect(result.autoDelivered).toBe(0);
      expect(world.licenceMails).toHaveLength(1);
      expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.AUTO_ASSIGNED);
      const opened = world.accessLog.length;

      const sent = await world.service.deliverAssigned({ orderItemId: 'item-1', actor: staff });

      expect(sent).toEqual({ state: FulfillmentState.DELIVERED, keys: 1 });
      expect(world.licenceMails).toHaveLength(1);
      // Not opened a second time either.
      expect(world.accessLog).toHaveLength(opened);
      expect(world.events.at(-1)).toBe('vault-delivered');
      expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.DELIVERED);
      expect(world.items[0]?.assignedKeyIds).toEqual(['key-1']);
      expect(world.order.status).toBe(OrderStatus.FULFILLED);
      expect(world.audits.at(-1)).toEqual(
        expect.objectContaining({
          actorId: 'staff-1',
          after: { keys: 1, recovered: true },
        }),
      );
    });

    it('still sends when the only logged licence email failed', async () => {
      const world = build({ mailFails: true });
      await world.service.onOrderPaid('DA-1001');
      world.transport.fails = false;

      await world.service.deliverAssigned({ orderItemId: 'item-1', actor: staff });

      expect(world.licenceMails).toHaveLength(2);
      expect(world.items[0]?.fulfillmentState).toBe(FulfillmentState.DELIVERED);
    });

    it('leaves the explicit resend alone', async () => {
      const world = build();
      await world.service.onOrderPaid('DA-1001');

      const resent = await world.service.resendLicence({ orderItemId: 'item-1', actor: staff });

      expect(resent).toEqual({ to: 'buyer@example.test' });
      expect(world.licenceMails).toHaveLength(2);
    });
  });
});
