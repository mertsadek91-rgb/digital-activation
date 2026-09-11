import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { CredentialKind, SecretInput } from '@da/contracts';
import { FulfillmentMode, FulfillmentState, Locale, OrderStatus, Prisma, RiskLevel } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { parseActivationSteps } from '../common/activation-steps.js';
import { MailService } from '../mail/mail.service.js';
import {
  fulfilmentFailed,
  licenceDelivered,
  type OrderLineView,
  orderReceived,
} from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type ParsedSecret, canonical, parse, parseBlock } from '../vault/credential.js';
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
    private readonly mail: MailService,
  ) {}

  private get storefront(): string {
    return process.env.STOREFRONT_URL ?? 'http://localhost:3000';
  }

  /** The order page, in the locale the customer bought in. */
  private orderUrl(number: string, locale: Locale): string {
    const prefix = locale === Locale.EN ? '/en' : '';
    return `${this.storefront}${prefix}/orders/${encodeURIComponent(number)}`;
  }

  private lang(locale: Locale): 'ar' | 'en' {
    return locale === Locale.EN ? 'en' : 'ar';
  }

  /**
   * How a line is supplied, in the customer's words.
   *
   * Said again here rather than shared with the storefront: an email is read
   * days later, out of the context of the page, and has to stand on its own.
   */
  private supplyNote(mode: FulfillmentMode, seconds: number, locale: Locale): string {
    const ar = locale !== Locale.EN;
    const hours = Math.round(seconds / 3600);
    const window = ar
      ? seconds < 3600
        ? `${String(Math.round(seconds / 60))} دقيقة`
        : hours === 1
          ? 'ساعة'
          : `${String(hours)} ساعات`
      : seconds < 3600
        ? `${String(Math.round(seconds / 60))} minutes`
        : hours === 1
          ? 'an hour'
          : `${String(hours)} hours`;

    if (mode === FulfillmentMode.FROM_STOCK) {
      return ar ? 'متوفّر لدينا — يُسلَّم فوراً' : 'Held in stock — delivered immediately';
    }
    return ar
      ? `يُطلَب من المورّد بعد الشراء — خلال ${window}`
      : `Ordered from the supplier after purchase — within ${window}`;
  }

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
    await this.sendOrderReceived(orderNumber);
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
      credentialKind: CredentialKind;
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

    // Only paid work: an unpaid order is not the supplier's problem yet. But
    // the history view has to reach past PAID — the moment the last line of an
    // order is delivered the order becomes FULFILLED, so a filter stopping at
    // FULFILLING hid exactly the completed work the view exists to show.
    const orderStates = input.includeDone
      ? [OrderStatus.PAID, OrderStatus.FULFILLING, OrderStatus.FULFILLED, OrderStatus.COMPLETED]
      : [OrderStatus.PAID, OrderStatus.FULFILLING];

    const items = await this.prisma.client.orderItem.findMany({
      where: {
        fulfillmentState: { in: states },
        order: { status: { in: orderStates } },
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
            credentialKind: true,
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
      credentialKind: item.variant.credentialKind,
      deliverySlaSeconds: item.variant.deliverySlaSeconds,
      requiresActivationEmail: item.variant.requiresActivationEmail,
      hasKey: item.assignedKeyIds.length > 0,
    }));
  }

  /**
   * Sends a licence email again, to the address on the order.
   *
   * The customer's own page calls this, and it is the safer of the two ways to
   * answer "I lost my key": the plaintext goes from the vault into a message
   * body and is shown to nobody on the way. The address is read from the order
   * rather than accepted from the caller — a resend that could be redirected
   * is a way to steal a licence, not a convenience.
   *
   * Marked RESEND in the vault's access log, with whoever asked as the actor.
   */
  async resendLicence(input: { orderItemId: string; actor: Actor }): Promise<{ to: string }> {
    const item = await this.prisma.client.orderItem.findUnique({
      where: { id: input.orderItemId },
      select: { id: true, fulfillmentState: true, order: { select: { email: true } } },
    });
    if (!item) throw new NotFoundException('لا يوجد هذا السطر.');
    if (item.fulfillmentState !== FulfillmentState.DELIVERED) {
      throw new BadRequestException('لم يُسلَّم هذا السطر بعد.');
    }

    const opened = await this.vault.openForDelivery({
      orderItemId: item.id,
      actor: input.actor,
    });
    const sent = await this.emailLicence({
      orderItemId: item.id,
      secrets: opened.map((entry) => entry.secret),
    });
    if (!sent.ok) {
      throw new BadRequestException(
        `تعذّر إرسال البريد (${sent.error ?? 'سبب غير معروف'}). حاول بعد قليل.`,
      );
    }

    return { to: item.order.email };
  }

  /**
   * What a variant is sold as.
   *
   * Lives here rather than in the vault because the vault has no visibility of
   * the catalog by design, and the answer is a catalog fact. Every caller that
   * needs to seal or render a secret comes through this module for it.
   */
  async credentialKind(variantId: string): Promise<CredentialKind> {
    const variant = await this.prisma.client.variant.findUnique({
      where: { id: variantId },
      select: { credentialKind: true },
    });
    if (!variant) throw new NotFoundException('لا يوجد هذا المتغيّر.');
    return variant.credentialKind;
  }

  /**
   * Takes in a pasted block of licences for one variant.
   *
   * The parsing happens here because it depends on what the variant is sold
   * as: one key per line, or a username and password per line. The vault is
   * handed secrets it can seal, and never a block it would have to interpret.
   */
  async importKeys(input: {
    variantId: string;
    block: string;
    supplierId?: string | undefined;
    costUsd?: string | undefined;
    expiresAt?: Date | undefined;
    actor: Actor;
  }): Promise<{ imported: number; duplicatesSkipped: number; invalidSkipped: number }> {
    const kind = await this.credentialKind(input.variantId);
    const { secrets, invalid } = parseBlock(kind, input.block);

    return this.vault.importKeys({
      variantId: input.variantId,
      kind,
      secrets,
      invalidSkipped: invalid,
      supplierId: input.supplierId,
      costUsd: input.costUsd,
      expiresAt: input.expiresAt,
      actor: input.actor,
    });
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
    secret: SecretInput;
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

    // What the supplier sent must be the shape this line is sold as. A key
    // pasted into an account line would be stored as a key and mailed under
    // the wrong heading — and the customer would have no password to use.
    const kind = await this.credentialKind(item.variantId);
    if (input.secret.kind !== kind) {
      throw new BadRequestException(
        kind === 'ACCOUNT_CREDENTIALS'
          ? 'هذا المنتج يُسلَّم باسم مستخدم وكلمة مرور، لا بمفتاح.'
          : 'هذا المنتج يُسلَّم بمفتاح تفعيل، لا بحساب.',
      );
    }

    const { licenseKeyId } = await this.vault.fulfilManually({
      orderItemId: item.id,
      variantId: item.variantId,
      secret: input.secret,
      supplierId: input.supplierId,
      costUsd: input.costUsd,
      actor: input.actor,
    });

    // The email goes first, and "delivered" is set only if it left. The other
    // order round looks harmless and is not: a line marked delivered whose
    // message never went is a customer waiting for something nobody will send
    // again, with nothing in the system saying so.
    const sent = await this.emailLicence({
      orderItemId: item.id,
      secrets: [parse(input.secret.kind, canonical(input.secret))],
    });
    if (!sent.ok) {
      // The key is in the vault and bound to the line — that part is done and
      // must not be undone. The line stays in the queue so the send can be
      // retried, and the failure is on the record.
      throw new BadRequestException(
        `المفتاح محفوظ ومربوط بالطلب، لكن إرسال البريد فشل (${sent.error ?? 'سبب غير معروف'}). أعد المحاولة من الطابور.`,
      );
    }

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
    // Asked of the vault, not of `assignedKeyIds`. That array is written only
    // after a successful send, so a send that failed leaves it empty while the
    // key is bound and paid for — and reading it here stranded the line: this
    // path refused it for having no key, and the manual path refused it for
    // already having one.
    if (!(await this.vault.isBound(item.id))) {
      throw new BadRequestException('لا يوجد مفتاح مخصّص لهذا السطر.');
    }

    // Opened, then marked delivered. The email itself is the next module; what
    // matters here is that "delivered" is set after the key was actually
    // produced, not before.
    const opened = await this.vault.openForDelivery({
      orderItemId: item.id,
      actor: input.actor,
    });

    const sent = await this.emailLicence({
      orderItemId: item.id,
      secrets: opened.map((entry) => entry.secret),
    });
    if (!sent.ok) {
      throw new BadRequestException(
        `تعذّر إرسال البريد (${sent.error ?? 'سبب غير معروف'}). المفتاح ما زال مخصّصاً للطلب؛ أعد المحاولة.`,
      );
    }

    await this.vault.markDelivered(item.id);

    await this.prisma.client.orderItem.update({
      where: { id: item.id },
      data: {
        fulfillmentState: FulfillmentState.DELIVERED,
        deliveredAt: new Date(),
        // Written here too, not only on the manual path. A delivered line with
        // an empty array cannot be linked back to the key it sent, which is
        // the one thing somebody handling a complaint needs.
        assignedKeyIds: opened.map((entry) => entry.licenseKeyId),
      },
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

    // The customer hears it from us rather than by noticing. A silent failure
    // is how somebody who paid ends up chasing the store.
    await this.emailFailure(item.id);

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

  // --- mail -----------------------------------------------------------------

  /**
   * Tells the customer the money arrived and what happens next.
   *
   * Sent once. `alreadySent` is keyed on the order number in the log payload,
   * so a replayed webhook or a second call does not send a second receipt.
   */
  private async sendOrderReceived(orderNumber: string): Promise<void> {
    const order = await this.prisma.client.order.findUnique({
      where: { number: orderNumber },
      include: {
        items: {
          include: {
            variant: { select: { fulfillmentMode: true, deliverySlaSeconds: true } },
          },
        },
      },
    });
    if (!order) return;

    if (
      await this.mail.alreadySent({
        template: 'order.received',
        to: order.email,
        orderNumber,
      })
    ) {
      return;
    }

    const lines: OrderLineView[] = order.items.map((item) => ({
      productName: item.productNameSnapshot,
      sku: item.skuSnapshot,
      qty: item.qty,
      lineTotal: `$${item.lineTotalUsd.toFixed(2)}`,
      supplyNote: this.supplyNote(
        item.variant.fulfillmentMode,
        item.variant.deliverySlaSeconds,
        order.locale,
      ),
    }));

    await this.mail.send({
      to: order.email,
      template: 'order.received',
      locale: this.lang(order.locale),
      customerId: order.customerId ?? undefined,
      rendered: orderReceived({
        locale: this.lang(order.locale),
        orderNumber,
        total: `$${order.totalUsd.toFixed(2)}`,
        lines,
        orderUrl: this.orderUrl(orderNumber, order.locale),
        activationEmail: order.activationEmail,
      }),
      // Variables only. There is no key in this email and none in this log.
      payload: { orderNumber, lines: lines.length, total: order.totalUsd.toFixed(2) },
    });
  }

  /**
   * Sends the licence itself.
   *
   * The one message that carries the product. The keys are passed in as
   * arguments and go into the rendered body and nowhere else — not into the
   * NotificationLog payload, not into a log line, not into an order note.
   */
  private async emailLicence(input: {
    orderItemId: string;
    secrets: ParsedSecret[];
  }): Promise<{ ok: boolean; error: string | null }> {
    const item = await this.prisma.client.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: {
        order: {
          select: {
            number: true,
            email: true,
            activationEmail: true,
            locale: true,
            customerId: true,
          },
        },
        variant: {
          select: {
            warrantyDays: true,
            product: {
              select: {
                hasGoldenWarranty: true,
                translations: { select: { locale: true, activationSteps: true } },
              },
            },
          },
        },
      },
    });
    if (!item) return { ok: false, error: 'order item not found' };

    const locale = item.order.locale;
    const ar = locale !== Locale.EN;

    const translation =
      item.variant.product.translations.find((entry) => entry.locale === locale) ??
      item.variant.product.translations[0];
    const steps = parseActivationSteps(translation?.activationSteps);

    const warranty = item.variant.warrantyDays
      ? ar
        ? `الضمان: ${String(item.variant.warrantyDays)} يوماً من تاريخ التسليم.`
        : `Warranty: ${String(item.variant.warrantyDays)} days from delivery.`
      : item.variant.product.hasGoldenWarranty
        ? ar
          ? 'مغطّى بالضمان الذهبي لمدّة الترخيص.'
          : 'Covered by the Golden Warranty for the licence term.'
        : ar
          ? 'راجِع صفحة المنتج لتفاصيل الضمان.'
          : 'See the product page for warranty details.';

    const result = await this.mail.send({
      to: item.order.email,
      template: 'licence.delivered',
      locale: this.lang(locale),
      customerId: item.order.customerId ?? undefined,
      rendered: licenceDelivered({
        locale: this.lang(locale),
        orderNumber: item.order.number,
        productName: item.productNameSnapshot,
        secrets: input.secrets,
        activationSteps: steps,
        activationEmail: item.order.activationEmail,
        orderUrl: this.orderUrl(item.order.number, locale),
        supportEmail: this.mail.supportEmail,
        warrantyNote: warranty,
      }),
      // Deliberately not the keys. `keyCount` is the most this may say.
      payload: {
        orderNumber: item.order.number,
        sku: item.skuSnapshot,
        keyCount: input.secrets.length,
      },
    });

    return { ok: result.ok, error: result.error };
  }

  /** Tells the customer a line could not be supplied. */
  private async emailFailure(orderItemId: string): Promise<void> {
    const item = await this.prisma.client.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        order: { select: { number: true, email: true, locale: true, customerId: true } },
      },
    });
    if (!item) return;

    await this.mail.send({
      to: item.order.email,
      template: 'fulfillment.failed',
      locale: this.lang(item.order.locale),
      customerId: item.order.customerId ?? undefined,
      rendered: fulfilmentFailed({
        locale: this.lang(item.order.locale),
        orderNumber: item.order.number,
        productName: item.productNameSnapshot,
        supportEmail: this.mail.supportEmail,
        orderUrl: this.orderUrl(item.order.number, item.order.locale),
      }),
      payload: { orderNumber: item.order.number, sku: item.skuSnapshot },
    });
  }

  /**
   * Every variant worth stocking, with what the vault actually holds.
   *
   * Joined here rather than in the admin module, because only this module can
   * reach both the catalog and the vault — and the two halves are useless
   * apart: a count with no sku is a number, and a sku with no count is a row
   * nobody can act on.
   *
   * A made-to-order variant is listed too, greyed by its mode rather than
   * hidden: the owner may decide to start holding stock of one, and a screen
   * that omits it cannot be used to make that decision.
   */
  async vaultStock(): Promise<
    {
      variantId: string;
      sku: string;
      productName: string;
      productSlug: string;
      mode: FulfillmentMode;
      credentialKind: CredentialKind;
      counts: Record<string, number>;
    }[]
  > {
    const variants = await this.prisma.client.variant.findMany({
      orderBy: [{ fulfillmentMode: 'asc' }, { sku: 'asc' }],
      select: {
        id: true,
        sku: true,
        fulfillmentMode: true,
        credentialKind: true,
        product: {
          select: {
            slug: true,
            translations: { where: { locale: Locale.AR }, select: { name: true } },
          },
        },
      },
    });

    const report = await this.vault.stockReport(variants.map((variant) => variant.id));
    const byVariant = new Map<string, Record<string, number>>();
    for (const row of report) {
      const counts = byVariant.get(row.variantId) ?? {};
      counts[row.state] = row.count;
      byVariant.set(row.variantId, counts);
    }

    return variants.map((variant) => ({
      variantId: variant.id,
      sku: variant.sku,
      productName: variant.product.translations[0]?.name ?? variant.product.slug,
      productSlug: variant.product.slug,
      mode: variant.fulfillmentMode,
      credentialKind: variant.credentialKind,
      counts: byVariant.get(variant.id) ?? {},
    }));
  }

  /**
   * The keys behind one order, by its number.
   *
   * Where a complaint starts: a customer writes in, and the person answering
   * has an order number and nothing else. Returns ids and states, never
   * plaintext — revealing one is a separate, deliberate act with its own
   * challenge and its own audit row.
   */
  async keysForOrder(orderNumber: string): Promise<
    {
      orderItemId: string;
      sku: string;
      productName: string;
      state: FulfillmentState;
      deliveredAt: Date | null;
      keys: { licenseKeyId: string; state: string; deliveredAt: Date | null }[];
    }[]
  > {
    const order = await this.prisma.client.order.findUnique({
      where: { number: orderNumber },
      include: { items: true },
    });
    if (!order) throw new NotFoundException(`لا يوجد طلب بالرقم ${orderNumber}`);

    const out = [];
    for (const item of order.items) {
      out.push({
        orderItemId: item.id,
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        state: item.fulfillmentState,
        deliveredAt: item.deliveredAt,
        keys: await this.vault.keysForOrderItem(item.id),
      });
    }
    return out;
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
