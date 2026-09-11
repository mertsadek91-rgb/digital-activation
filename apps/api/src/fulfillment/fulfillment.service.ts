import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { FulfillmentMode, FulfillmentState, OrderStatus, Prisma, RiskLevel } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type Actor, VaultService } from '../vault/vault.service.js';

/**
 * Fulfilment: turning a paid order into a delivered licence.
 *
 * Two paths, because the catalog has two kinds of line.
 *
 * A stocked line already has a key in the vault, so payment assigns one and it
 * goes out immediately. That is nine variants.
 *
 * Everything else — eighty on-demand and twelve manual-setup — has no key
 * until somebody buys it from the supplier. Those land in a queue a person
 * works through: place the supplier order, paste the code that comes back, and
 * the system seals it into the vault and sends it. The queue is the point of
 * this file; without it "MANUAL_QUEUE" is a state nothing ever leaves.
 *
 * One rule holds across both: a key leaves only after the money has arrived
 * and the risk check has cleared. A digital key cannot be clawed back, so the
 * block is always before delivery and never after.
 */
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Works an order after payment.
   *
   * Called from the payment webhook. Idempotent by state: a line already
   * delivered or already holding a key is left alone, because a webhook is
   * delivered at least once and the second delivery must not produce a second
   * key.
   */
  async onOrderPaid(orderNumber: string): Promise<{
    autoAssigned: number;
    queued: number;
    skipped: number;
  }> {
    const order = await this.prisma.client.order.findUnique({
      where: { number: orderNumber },
      include: { items: { include: { variant: { select: { fulfillmentMode: true } } } } },
    });
    if (!order) throw new NotFoundException(`No order ${orderNumber}`);

    // PAYMENT_REVIEW is money taken and delivery held. That is the whole point
    // of the state, so fulfilment must not quietly proceed through it.
    if (order.status !== OrderStatus.PAID) {
      return { autoAssigned: 0, queued: 0, skipped: order.items.length };
    }

    let autoAssigned = 0;
    let queued = 0;
    let skipped = 0;

    for (const item of order.items) {
      if (
        item.fulfillmentState === FulfillmentState.DELIVERED ||
        item.fulfillmentState === FulfillmentState.AUTO_ASSIGNED
      ) {
        skipped += 1;
        continue;
      }

      if (item.variant.fulfillmentMode !== FulfillmentMode.FROM_STOCK) {
        await this.prisma.client.orderItem.update({
          where: { id: item.id },
          data: { fulfillmentState: FulfillmentState.MANUAL_QUEUE },
        });
        queued += 1;
        continue;
      }

      const result = await this.vault.assign({
        orderItemId: item.id,
        variantId: item.variantId,
        qty: item.qty,
      });

      if (result.assigned.length === 0) {
        // Sold from stock the vault does not actually have. Not an error to
        // throw at the payment webhook — the money is already taken — but a
        // line a person has to see, because somebody is waiting for a key.
        this.logger.warn(
          `Order ${orderNumber} line ${item.skuSnapshot} is short ${String(result.short)} key(s); queued for manual fulfilment.`,
        );
        await this.prisma.client.orderItem.update({
          where: { id: item.id },
          data: { fulfillmentState: FulfillmentState.MANUAL_QUEUE },
        });
        queued += 1;
        continue;
      }

      await this.prisma.client.orderItem.update({
        where: { id: item.id },
        data: {
          fulfillmentState: FulfillmentState.AUTO_ASSIGNED,
          assignedKeyIds: result.assigned,
        },
      });
      autoAssigned += 1;
    }

    await this.refreshOrderState(order.id);
    return { autoAssigned, queued, skipped };
  }

  /**
   * The supplier queue: lines waiting for somebody to buy a licence.
   *
   * Ordered oldest first, because the only unfair thing a queue can do is let
   * the customer who waited longest keep waiting. Carries the activation email
   * on the row, since for twenty-six variants the supplier order cannot be
   * placed without it.
   */
  async queue(input: { limit: number; includeDone: boolean }): Promise<
    {
      orderItemId: string;
      orderNumber: string;
      placedAt: Date;
      paidAt: Date | null;
      email: string;
      activationEmail: string | null;
      sku: string;
      productName: string;
      qty: number;
      spec: Prisma.JsonValue;
      state: FulfillmentState;
      mode: FulfillmentMode;
      deliverySlaSeconds: number;
      requiresActivationEmail: boolean;
      hasKey: boolean;
    }[]
  > {
    // AUTO_ASSIGNED belongs in the queue, not out of it. A stocked line gets a
    // key the moment payment lands, but something still has to send it — and
    // until the mail module exists that something is a person. Leaving those
    // rows out made them invisible: key bound, customer waiting, nothing on
    // anybody's list.
    const states = input.includeDone
      ? [
          FulfillmentState.MANUAL_QUEUE,
          FulfillmentState.AUTO_ASSIGNED,
          FulfillmentState.DELIVERED,
          FulfillmentState.FAILED,
        ]
      : [FulfillmentState.MANUAL_QUEUE, FulfillmentState.AUTO_ASSIGNED];

    const items = await this.prisma.client.orderItem.findMany({
      where: {
        fulfillmentState: { in: states },
        // Only paid work. An unpaid order is not the supplier's problem yet.
        order: { status: { in: [OrderStatus.PAID, OrderStatus.FULFILLING] } },
      },
      orderBy: { order: { paidAt: 'asc' } },
      take: input.limit,
      include: {
        order: {
          select: {
            number: true,
            email: true,
            activationEmail: true,
            placedAt: true,
            paidAt: true,
          },
        },
        variant: {
          select: {
            fulfillmentMode: true,
            deliverySlaSeconds: true,
            requiresActivationEmail: true,
          },
        },
      },
    });

    return items.map((item) => ({
      orderItemId: item.id,
      orderNumber: item.order.number,
      placedAt: item.order.placedAt,
      paidAt: item.order.paidAt,
      email: item.order.email,
      activationEmail: item.order.activationEmail,
      sku: item.skuSnapshot,
      productName: item.productNameSnapshot,
      qty: item.qty,
      spec: item.variantSpecSnapshot,
      state: item.fulfillmentState,
      mode: item.variant.fulfillmentMode,
      deliverySlaSeconds: item.variant.deliverySlaSeconds,
      requiresActivationEmail: item.variant.requiresActivationEmail,
      hasKey: item.assignedKeyIds.length > 0,
    }));
  }

  /**
   * Records the code a supplier sent back, and delivers it.
   *
   * The plaintext passes through this call and stops. It is sealed into the
   * vault, the line is marked delivered, and nothing writes it to a log or an
   * order note — which is precisely where the legacy store kept its keys, and
   * why its own backup is a file full of customer licences.
   */
  async fulfilManually(input: {
    orderItemId: string;
    code: string;
    supplierId?: string | undefined;
    costUsd?: string | undefined;
    actor: Actor;
  }): Promise<{ state: FulfillmentState; deliveredAt: Date }> {
    const item = await this.prisma.client.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: { order: { select: { id: true, number: true, status: true, riskLevel: true } } },
    });
    if (!item) throw new NotFoundException('لا يوجد هذا السطر.');

    if (item.order.status !== OrderStatus.PAID && item.order.status !== OrderStatus.FULFILLING) {
      throw new BadRequestException(
        `لا يمكن التسليم وحالة الطلب ${item.order.status}. لا يُفرج عن مفتاح قبل وصول المال.`,
      );
    }
    if (item.order.riskLevel === RiskLevel.HIGH || item.order.riskLevel === RiskLevel.BLOCKED) {
      throw new BadRequestException('هذا الطلب موقوف للمراجعة. لا يُسلَّم مفتاح قبل رفع الإيقاف.');
    }
    if (item.fulfillmentState === FulfillmentState.DELIVERED) {
      throw new BadRequestException('هذا السطر مُسلَّم بالفعل.');
    }

    const { licenseKeyId } = await this.vault.fulfilManually({
      orderItemId: item.id,
      variantId: item.variantId,
      plaintext: input.code,
      supplierId: input.supplierId,
      costUsd: input.costUsd,
      actor: input.actor,
    });

    await this.vault.markDelivered(item.id);
    const deliveredAt = new Date();

    await this.prisma.client.orderItem.update({
      where: { id: item.id },
      data: {
        fulfillmentState: FulfillmentState.DELIVERED,
        deliveredAt,
        assignedKeyIds: [licenseKeyId],
      },
    });

    // The audit records that a key was delivered and by whom. It records no
    // part of the key: the eslint rule on order notes exists for the same
    // reason, and an audit trail that leaks the secret is not an audit trail.
    await this.audit.record({
      actorId: input.actor.staffId,
      entity: 'OrderItem',
      entityId: item.id,
      action: 'fulfillment.delivered',
      before: { fulfillmentState: item.fulfillmentState },
      after: { fulfillmentState: FulfillmentState.DELIVERED, licenseKeyId },
      ip: input.actor.ip,
      userAgent: input.actor.userAgent,
    });

    await this.refreshOrderState(item.order.id);
    return { state: FulfillmentState.DELIVERED, deliveredAt };
  }

  /**
   * Delivers a line that already has a key assigned from stock.
   *
   * Split from the manual path because nothing new is being stored: the key
   * exists, it is bound to the line, and this is the act of sending it.
   */
  async deliverAssigned(input: {
    orderItemId: string;
    actor: Actor;
  }): Promise<{ state: FulfillmentState; keys: number }> {
    const item = await this.prisma.client.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: { order: { select: { id: true, status: true, riskLevel: true } } },
    });
    if (!item) throw new NotFoundException('لا يوجد هذا السطر.');
    if (item.order.riskLevel === RiskLevel.HIGH || item.order.riskLevel === RiskLevel.BLOCKED) {
      throw new BadRequestException('هذا الطلب موقوف للمراجعة.');
    }
    if (item.assignedKeyIds.length === 0) {
      throw new BadRequestException('لا يوجد مفتاح مخصّص لهذا السطر.');
    }

    // Opened, then marked delivered. The email itself is the next module; what
    // matters here is that "delivered" is set after the key was actually
    // produced, not before.
    const opened = await this.vault.openForDelivery({
      orderItemId: item.id,
      actor: input.actor,
    });
    await this.vault.markDelivered(item.id);

    await this.prisma.client.orderItem.update({
      where: { id: item.id },
      data: { fulfillmentState: FulfillmentState.DELIVERED, deliveredAt: new Date() },
    });

    await this.audit.record({
      actorId: input.actor.staffId,
      entity: 'OrderItem',
      entityId: item.id,
      action: 'fulfillment.delivered',
      after: { keys: opened.length },
      ip: input.actor.ip,
      userAgent: input.actor.userAgent,
    });

    await this.refreshOrderState(item.order.id);
    return { state: FulfillmentState.DELIVERED, keys: opened.length };
  }

  /** Marks a line as failed, so it stops looking like work in progress. */
  async markFailed(input: {
    orderItemId: string;
    reason: string;
    actor: Actor;
  }): Promise<{ state: FulfillmentState }> {
    const item = await this.prisma.client.orderItem.update({
      where: { id: input.orderItemId },
      data: { fulfillmentState: FulfillmentState.FAILED },
      select: { id: true, orderId: true },
    });

    await this.audit.record({
      actorId: input.actor.staffId,
      entity: 'OrderItem',
      entityId: item.id,
      action: 'fulfillment.failed',
      after: { reason: input.reason },
      ip: input.actor.ip,
      userAgent: input.actor.userAgent,
    });

    await this.refreshOrderState(item.orderId);
    return { state: FulfillmentState.FAILED };
  }

  /**
   * Moves the order's own status to match its lines.
   *
   * Derived rather than set by hand in five places: an order is FULFILLED when
   * every line is delivered, FULFILLING while some are, and left alone
   * otherwise. Keeping it derived is what stops a half-delivered order
   * reporting itself complete.
   */
  private async refreshOrderState(orderId: string): Promise<void> {
    const items = await this.prisma.client.orderItem.findMany({
      where: { orderId },
      select: { fulfillmentState: true },
    });
    if (items.length === 0) return;

    const delivered = items.filter(
      (item) => item.fulfillmentState === FulfillmentState.DELIVERED,
    ).length;

    const order = await this.prisma.client.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) return;
    // Never walk backwards out of a terminal state.
    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REFUNDED ||
      order.status === OrderStatus.PARTIALLY_REFUNDED
    ) {
      return;
    }

    if (delivered === items.length) {
      await this.prisma.client.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.FULFILLED, fulfilledAt: new Date() },
      });
      return;
    }

    if (delivered > 0 && order.status === OrderStatus.PAID) {
      await this.prisma.client.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.FULFILLING },
      });
    }
  }

  /** Queue depth and the oldest wait, for the admin's attention. */
  async queueSummary(): Promise<{ waiting: number; oldestPaidAt: Date | null }> {
    const pending = {
      fulfillmentState: {
        in: [FulfillmentState.MANUAL_QUEUE, FulfillmentState.AUTO_ASSIGNED],
      },
      order: { status: { in: [OrderStatus.PAID, OrderStatus.FULFILLING] } },
    };
    const waiting = await this.prisma.client.orderItem.count({ where: pending });
    const oldest = await this.prisma.client.orderItem.findFirst({
      where: pending,
      orderBy: { order: { paidAt: 'asc' } },
      select: { order: { select: { paidAt: true } } },
    });
    return { waiting, oldestPaidAt: oldest?.order.paidAt ?? null };
  }
}
