import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';

import type { CredentialKind, SecretInput } from '@da/contracts';
import {
  ActorType,
  FulfillmentMode,
  FulfillmentState,
  LicenseKeyState,
  Locale,
  NotificationChannel,
  OrderStatus,
  Prisma,
  RiskLevel,
  StockMovementReason,
} from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { transitionOrder } from '../checkout/order-status.js';
import { parseActivationSteps } from '../common/activation-steps.js';
import { withAdvisoryLock } from '../common/advisory-lock.js';
import { MailService } from '../mail/mail.service.js';
import {
  fulfilmentFailed,
  licenceDelivered,
  type OrderLineView,
  orderReceived,
} from '../mail/templates.js';
import { orderLink } from '../common/order-link.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type ParsedSecret, canonical, parse, parseBlock } from '../vault/credential.js';
import { type Actor, VaultService } from '../vault/vault.service.js';

/**
 * The actor for the automatic send on payment.
 *
 * `staffId` is what the vault writes to `KeyAccessLog.actorId`, a free-text
 * column; the SYSTEM kind is what says no person was involved. No TOTP is
 * asked for: `openForDelivery` requires none, because sending a key to the
 * address that paid for it is not a person looking at it.
 */
const SYSTEM_ACTOR: Actor = { staffId: 'system', kind: ActorType.SYSTEM, totpAt: 0 };

/** Long enough for one SMTP or Resend round trip with its own timeouts. */
const DELIVERY_LOCK_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * The advisory-lock key for sending one order line.
 *
 * Hashed into the 32-bit range the sweep keys already use. Two different
 * lines sharing a key only means one waits for the queue — the lock guards a
 * duplicate send, and a collision can cause a skipped send, never a double.
 */
export function deliveryLockKey(orderItemId: string): number {
  return createHash('sha256').update(`fulfillment.deliver:${orderItemId}`).digest().readInt32BE(0);
}

/** How one attempt to send an assigned line ended. */
export type SendOutcome =
  | { kind: 'delivered'; keys: number }
  | { kind: 'missing' }
  | { kind: 'unpaid'; status: OrderStatus }
  | { kind: 'held' }
  | { kind: 'already-delivered' }
  | { kind: 'busy' }
  | { kind: 'no-key' }
  | { kind: 'send-failed'; error: string | null };

function outcomeReason(outcome: Exclude<SendOutcome, { kind: 'delivered' }>): string {
  switch (outcome.kind) {
    case 'unpaid':
      return `order is ${outcome.status}`;
    case 'held':
      return 'order is held for review';
    case 'send-failed':
      return `email failed: ${outcome.error ?? 'reason unknown'}`;
    default:
      return outcome.kind;
  }
}

/**
 * Whether a stocked line is sent the moment its key is assigned (BUG-0021).
 *
 * `AUTO_DELIVERY=off` is the incident switch: keys are still assigned on
 * payment, but the line stops at AUTO_ASSIGNED in the staff queue, as it did
 * before BUG-0021. Read on each call, from the value ConfigModule validated
 * and copied in at boot — so a change needs an API restart.
 */
export function autoDeliveryEnabled(): boolean {
  return process.env.AUTO_DELIVERY !== 'off';
}

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
export class FulfillmentService implements OnModuleInit {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  onModuleInit(): void {
    if (!autoDeliveryEnabled()) {
      this.logger.warn(
        'AUTO_DELIVERY=off: stocked keys are assigned on payment but not sent; they wait in the staff fulfilment queue.',
      );
    }
  }

  private get storefront(): string {
    return process.env.STOREFRONT_URL ?? 'http://localhost:3000';
  }

  /**
   * The order page, in the locale the customer bought in, carrying the key
   * that opens it from any device — see `order-link.ts`.
   */
  private orderUrl(number: string, locale: Locale): string {
    const prefix = locale === Locale.EN ? '/en' : '';
    return orderLink(this.storefront, `${prefix}/orders/${encodeURIComponent(number)}`, number);
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
      ? `يُجهَّز بعد الشراء — خلال ${window}`
      : `Prepared after purchase — within ${window}`;
  }

  /**
   * Works an order after payment.
   *
   * Called from the payment webhook, the stranded-order sweep and the staff
   * paths that release a held payment. Idempotent by state: a line already
   * delivered or already holding a key is left alone, because a webhook is
   * delivered at least once and the second delivery must not produce a second
   * key — or a second email.
   *
   * A stocked line is sent the moment its key is assigned (BUG-0021). Only
   * the call that moved the line into AUTO_ASSIGNED sends it: the move is a
   * compare-and-set on the state this call read, so two deliveries of the
   * same webhook racing each other cannot both win it. A send that fails, or
   * that the risk check holds, leaves the line AUTO_ASSIGNED — which is
   * exactly where the staff queue looks.
   */
  async onOrderPaid(orderNumber: string): Promise<{
    autoAssigned: number;
    autoDelivered: number;
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
      return { autoAssigned: 0, autoDelivered: 0, queued: 0, skipped: order.items.length };
    }

    let autoAssigned = 0;
    let queued = 0;
    let skipped = 0;
    /** Lines this call moved into AUTO_ASSIGNED, and so the lines it sends. */
    const claimed: string[] = [];

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

      // Conditional on the state read above. A concurrent call working the
      // same order gets the same key back from `assign` (it is bound to the
      // line already) and would otherwise both claim the send and, landing
      // after the other call's delivery, walk a DELIVERED line back.
      const { count } = await this.prisma.client.orderItem.updateMany({
        where: { id: item.id, fulfillmentState: item.fulfillmentState },
        data: {
          fulfillmentState: FulfillmentState.AUTO_ASSIGNED,
          assignedKeyIds: result.assigned,
        },
      });
      if (count === 0) {
        skipped += 1;
        continue;
      }
      claimed.push(item.id);
      autoAssigned += 1;
    }

    await this.refreshOrderState(order.id);
    await this.sendOrderReceived(orderNumber);

    let autoDelivered = 0;
    // The kill switch stops here: keys assigned, lines AUTO_ASSIGNED, and the
    // staff queue is where they are sent from.
    if (!autoDeliveryEnabled()) {
      return { autoAssigned, autoDelivered, queued, skipped };
    }
    for (const orderItemId of claimed) {
      if (await this.autoDeliver(orderNumber, orderItemId)) autoDelivered += 1;
    }
    return { autoAssigned, autoDelivered, queued, skipped };
  }

  /**
   * Sends one freshly assigned stocked line, as the system.
   *
   * Never throws. The caller is the payment webhook, and an exception there
   * becomes a retry of a payment that is already recorded; the line is
   * better left AUTO_ASSIGNED, in the staff queue, with the reason logged.
   */
  private async autoDeliver(orderNumber: string, orderItemId: string): Promise<boolean> {
    try {
      const outcome = await this.sendAssigned(orderItemId, SYSTEM_ACTOR);
      if (outcome.kind === 'delivered') return true;
      this.logger.warn(
        `Order ${orderNumber} line ${orderItemId} not sent automatically (${outcomeReason(outcome)}); left in the fulfilment queue.`,
      );
    } catch (error) {
      this.logger.error(
        `Order ${orderNumber} line ${orderItemId} failed to send automatically (${error instanceof Error ? error.message : 'unknown'}); left in the fulfilment queue.`,
      );
    }
    return false;
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
    // AUTO_ASSIGNED belongs in the queue, not out of it. A stocked line is
    // sent the moment payment lands, so one still sitting here is one whose
    // automatic send failed or was held — key bound, customer waiting — and
    // a person has to retry it. Leaving those rows out made them invisible.
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

    // Asked of the vault: a pasted code whose email failed is bound there
    // while the line's own assignedKeyIds may still be empty (BUG-0029), and
    // the queue must offer the send, not a paste the vault would refuse.
    const bound = await this.vault.boundOrderItemIds(items.map((item) => item.id));

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
      hasKey: bound.has(item.id),
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
    if (!item) throw new NotFoundException(say('لا يوجد هذا السطر.', 'No such line.'));
    if (item.fulfillmentState !== FulfillmentState.DELIVERED) {
      throw new BadRequestException(
        say('لم يُسلّم هذا السطر بعد.', 'This line has not been delivered yet.'),
      );
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
        say(
          `تعذّر إرسال البريد (${sent.error ?? 'سبب غير معروف'}). حاول بعد قليل.`,
          `The email could not be sent (${sent.error ?? 'reason unknown'}). Try again shortly.`,
        ),
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
    if (!variant) throw new NotFoundException(say('لا يوجد هذا المتغيّر.', 'No such variant.'));
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

    const result = await this.vault.importKeys({
      variantId: input.variantId,
      kind,
      secrets,
      invalidSkipped: invalid,
      supplierId: input.supplierId,
      costUsd: input.costUsd,
      expiresAt: input.expiresAt,
      actor: input.actor,
    });

    if (result.imported > 0) await this.recount(input.variantId, input.actor);
    return result;
  }

  // --- one key, by a person: read, revoke, replace --------------------------
  //
  // Every one of these is ADMIN-only at the route and needs a TOTP challenge
  // from the last quarter of an hour inside the vault. The vault's access log
  // says who touched a key and when; the reason a person typed goes to the
  // audit log beside it (KeyAccessLog has no column for it), so "why" is on
  // the record too. Nothing here logs or returns any part of a key except
  // revealKey's answer itself.

  /** Shows one key to a member of staff, and records why they asked. */
  async revealKey(input: { licenseKeyId: string; reason: string; actor: Actor }) {
    const secret = await this.vault.reveal({
      licenseKeyId: input.licenseKeyId,
      actor: input.actor,
    });
    // After the vault's own REVEAL row, before the answer leaves: a key is not
    // shown unless the reason for showing it is stored.
    await this.audit.record({
      actorId: input.actor.staffId,
      entity: 'LicenseKey',
      entityId: input.licenseKeyId,
      action: 'vault.reveal',
      after: { reason: input.reason },
      ip: input.actor.ip,
      userAgent: input.actor.userAgent,
    });
    return secret;
  }

  /**
   * Takes one key out of circulation, with a reason, and recounts the stock:
   * a revoked AVAILABLE key was being offered on the product page.
   */
  async revokeKey(input: {
    licenseKeyId: string;
    reason: string;
    actor: Actor;
    onlyIfAvailable?: boolean;
  }): Promise<{ state: LicenseKeyState }> {
    const revoked = await this.vault.revoke(input);
    await this.recount(revoked.variantId, input.actor);
    await this.audit.record({
      actorId: input.actor.staffId,
      entity: 'LicenseKey',
      entityId: input.licenseKeyId,
      action: 'vault.revoke',
      before: { state: revoked.previous },
      after: { state: revoked.state, reason: input.reason },
      ip: input.actor.ip,
      userAgent: input.actor.userAgent,
    });
    return { state: revoked.state };
  }

  /**
   * Corrects a key that was pasted wrong: the new one goes in, then the old
   * one is revoked. Unsold stock only — a key on an order is the customer's,
   * and is answered with a resend or a revoke, never swapped underneath them.
   *
   * In that order on purpose. If the new key is refused (a duplicate, not a
   * key) nothing has changed; if the old key sold in between, its revoke is
   * refused and the new key simply stays in stock.
   */
  async replaceKey(input: {
    licenseKeyId: string;
    code: string;
    reason: string;
    actor: Actor;
  }): Promise<{ imported: number; revoked: boolean }> {
    const meta = await this.vault.keyMeta(input.licenseKeyId);
    if (!meta)
      throw new NotFoundException(say('لا يوجد مفتاح بهذا المعرّف.', 'No key with that id.'));
    if (meta.state !== LicenseKeyState.AVAILABLE) {
      throw new BadRequestException(
        say(
          'يُستبدل المفتاح المتاح في المخزون فقط. مفتاح على طلب يُعاد إرساله أو يُلغى.',
          'Only an available key in stock can be replaced. A key on an order is resent or revoked.',
        ),
      );
    }

    const result = await this.importKeys({
      variantId: meta.variantId,
      block: input.code,
      actor: input.actor,
    });
    if (result.imported !== 1) {
      throw new BadRequestException(
        result.duplicatesSkipped > 0
          ? say(
              'المفتاح الجديد موجود في الخزنة من قبل. لم يتغيّر شيء.',
              'The new key is already in the vault. Nothing changed.',
            )
          : say(
              'المفتاح الجديد غير صالح لهذا المنتج. لم يتغيّر شيء.',
              'The new key is not valid for this product. Nothing changed.',
            ),
      );
    }

    await this.revokeKey({
      licenseKeyId: input.licenseKeyId,
      reason: `replaced: ${input.reason}`,
      actor: input.actor,
      onlyIfAvailable: true,
    });
    return { imported: 1, revoked: true };
  }

  /** The stock list of one variant: ids, states and dates, never a key. */
  variantKeys(variantId: string) {
    return this.vault.keysForVariant(variantId);
  }

  /**
   * Who touched a key and when, with the reason they gave where there is one
   * (matched from the audit log: same person, same act, within a minute).
   */
  async keyHistory(licenseKeyId: string) {
    const [access, audits] = await Promise.all([
      this.vault.history(licenseKeyId),
      this.prisma.client.auditLog.findMany({
        where: { entity: 'LicenseKey', entityId: licenseKeyId },
        select: { actorId: true, action: true, after: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);
    const act: Record<string, string> = { REVEAL: 'vault.reveal', REVOKE: 'vault.revoke' };
    return access.map((row) => {
      const match = audits.find(
        (audit) =>
          audit.action === act[row.action] &&
          audit.actorId === row.actorId &&
          Math.abs(audit.createdAt.getTime() - row.createdAt.getTime()) < 60_000,
      );
      const after = match?.after as { reason?: unknown } | null | undefined;
      return {
        ...row,
        reason: typeof after?.reason === 'string' ? after.reason : null,
      };
    });
  }

  /**
   * Writes the vault's true count across to the number the shop sells against.
   *
   * Two records of one fact, and they have to be: the storefront cannot see
   * the vault. `da_app` is explicitly denied that schema so a future blanket
   * GRANT cannot quietly open it, which means the cart holds stock against
   * `InventoryLevel.onHand` in `public` while the keys sit where the
   * application role cannot reach them. The denormalised count is the bridge.
   *
   * Only one side of that bridge was ever written. Paying for a key decrements
   * `onHand`; importing keys did not increment it — so pasting ten keys into
   * the vault left the count at zero, the buy button still refusing, and
   * nothing on any screen saying why. The ledger could only ever go down.
   *
   * This lives here rather than in the vault service because of the same
   * boundary: `da_vault` has SELECT and nothing else on `public`, so the one
   * place that can read the vault cannot write the count, and the one place
   * that can write it cannot read the vault. This service holds both clients,
   * which is precisely what it is for.
   *
   * Set, not incremented. A count recomputed from what the vault actually
   * holds converges on the truth after a half-finished import or a manual
   * adjustment that drifted; adding a delta inherits every past mistake.
   */
  private async recount(variantId: string, actor: Actor): Promise<void> {
    const truth = (await this.vault.availability([variantId]))[variantId] ?? 0;

    const level = await this.prisma.client.inventoryLevel.findUnique({
      where: { variantId },
      select: { onHand: true, reserved: true },
    });
    const previous = level?.onHand ?? 0;

    // Never below what a cart in checkout is already holding: a reservation is
    // a promise, and a count under it makes the variant unsellable for good.
    const next = Math.max(truth, level?.reserved ?? 0);
    if (previous === next) return;

    await this.prisma.client.inventoryLevel.upsert({
      where: { variantId },
      update: { onHand: next },
      create: { variantId, onHand: next },
    });

    await this.prisma.client.stockMovement.create({
      data: {
        variantId,
        delta: next - previous,
        reason: StockMovementReason.IMPORT,
        // Stated rather than left to the SYSTEM default: "who last changed
        // this count" is the first question asked when a number looks wrong.
        actorId: actor.staffId,
        actorType: actor.kind ?? ActorType.STAFF,
        note: 'Recounted from the vault after an import.',
      },
    });

    this.logger.log(`Variant ${variantId}: onHand ${String(previous)} → ${String(next)}`);
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
    if (!item) throw new NotFoundException(say('لا يوجد هذا السطر.', 'No such line.'));

    if (item.order.status !== OrderStatus.PAID && item.order.status !== OrderStatus.FULFILLING) {
      throw new BadRequestException(
        say(
          `لا يمكن التسليم وحالة الطلب ${item.order.status}. لا يُفرج عن مفتاح قبل وصول المال.`,
          `Cannot deliver while the order is ${item.order.status}. No key is released before the money arrives.`,
        ),
      );
    }
    if (item.order.riskLevel === RiskLevel.HIGH || item.order.riskLevel === RiskLevel.BLOCKED) {
      throw new BadRequestException(
        say(
          'هذا الطلب موقوف للمراجعة. لا يُسلّم مفتاح قبل رفع الإيقاف.',
          'This order is held for review. No key is delivered until the hold is lifted.',
        ),
      );
    }
    if (item.fulfillmentState === FulfillmentState.DELIVERED) {
      throw new BadRequestException(
        say('هذا السطر مُسلّم بالفعل.', 'This line has already been delivered.'),
      );
    }

    // What the supplier sent must be the shape this line is sold as. A key
    // pasted into an account line would be stored as a key and mailed under
    // the wrong heading — and the customer would have no password to use.
    const kind = await this.credentialKind(item.variantId);
    if (input.secret.kind !== kind) {
      throw new BadRequestException(
        kind === 'ACCOUNT_CREDENTIALS'
          ? say(
              'هذا المنتج يُسلّم باسم مستخدم وكلمة مرور، لا بمفتاح.',
              'This product is delivered as a username and password, not as a key.',
            )
          : say(
              'هذا المنتج يُسلّم بمفتاح تفعيل، لا بحساب.',
              'This product is delivered as an activation key, not as an account.',
            ),
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
      // must not be undone. The line moves to AUTO_ASSIGNED, the state of a
      // bound key that has not been sent, which is what the automatic path
      // leaves after a failed email too. Left in MANUAL_QUEUE it read as
      // "needs a supplier order" beside an ASSIGNED key, offered "paste the
      // code" again (refused: the line already has one) and hid the retry
      // (BUG-0029). The guard keeps a concurrent send from being overwritten.
      await this.prisma.client.orderItem.updateMany({
        where: { id: item.id, fulfillmentState: item.fulfillmentState },
        data: { fulfillmentState: FulfillmentState.AUTO_ASSIGNED, assignedKeyIds: [licenseKeyId] },
      });
      throw new BadRequestException(
        say(
          `المفتاح محفوظ ومربوط بالطلب، لكن إرسال البريد فشل (${sent.error ?? 'سبب غير معروف'}). أعد المحاولة من الطابور.`,
          `The key is stored and bound to the order, but the email failed (${sent.error ?? 'reason unknown'}). Retry from the queue.`,
        ),
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
   * exists, it is bound to the line, and this is the act of sending it. This
   * is the staff retry; the first attempt is made by `onOrderPaid`, through
   * the same `sendAssigned`.
   */
  async deliverAssigned(input: {
    orderItemId: string;
    actor: Actor;
  }): Promise<{ state: FulfillmentState; keys: number }> {
    const outcome = await this.sendAssigned(input.orderItemId, input.actor);
    switch (outcome.kind) {
      case 'delivered':
        return { state: FulfillmentState.DELIVERED, keys: outcome.keys };
      case 'missing':
        throw new NotFoundException(say('لا يوجد هذا السطر.', 'No such line.'));
      case 'unpaid':
        throw new BadRequestException(
          say(
            `لا يمكن التسليم وحالة الطلب ${outcome.status}. لا يُفرج عن مفتاح قبل وصول المال.`,
            `Cannot deliver while the order is ${outcome.status}. No key is released before the money arrives.`,
          ),
        );
      case 'held':
        throw new BadRequestException(
          say('هذا الطلب موقوف للمراجعة.', 'This order is held for review.'),
        );
      case 'already-delivered':
        throw new BadRequestException(
          say('هذا السطر مُسلّم بالفعل.', 'This line has already been delivered.'),
        );
      case 'busy':
        throw new BadRequestException(
          say(
            'يجري إرسال هذا السطر الآن. حدّث الطابور بعد لحظات.',
            'This line is being sent right now. Refresh the queue in a moment.',
          ),
        );
      case 'no-key':
        throw new BadRequestException(
          say('لا يوجد مفتاح مخصّص لهذا السطر.', 'No key is assigned to this line.'),
        );
      case 'send-failed':
        throw new BadRequestException(
          say(
            `تعذّر إرسال البريد (${outcome.error ?? 'سبب غير معروف'}). المفتاح ما زال مخصّصاً للطلب؛ أعد المحاولة.`,
            `The email could not be sent (${outcome.error ?? 'reason unknown'}). The key is still assigned to the order; try again.`,
          ),
        );
    }
  }

  /**
   * The act of sending a line whose key is already bound, for any actor.
   *
   * One line at a time, under a per-line advisory lock, with every check made
   * again inside it. That is what makes the send idempotent across its three
   * callers — the webhook, a redelivered webhook, and a person pressing the
   * button — none of which can see the others: whichever holds the lock
   * sends, and whoever comes after finds the line DELIVERED. The lock is
   * transaction-scoped, so a process that dies mid-send lets go of it.
   *
   * The same two gates as the manual path, re-read here rather than trusted
   * from the caller: the money has arrived, and the order is not held for
   * review. A dispute that lands between payment and send is caught here.
   *
   * The vault writes the KeyAccessLog row before it produces the plaintext,
   * and "delivered" is set only after the message has actually left.
   */
  private async sendAssigned(orderItemId: string, actor: Actor): Promise<SendOutcome> {
    const locked = await withAdvisoryLock(
      this.prisma.client,
      deliveryLockKey(orderItemId),
      () => this.sendAssignedLocked(orderItemId, actor),
      { timeoutMs: DELIVERY_LOCK_TIMEOUT_MS },
    );
    return locked.ran ? locked.value : { kind: 'busy' };
  }

  private async sendAssignedLocked(orderItemId: string, actor: Actor): Promise<SendOutcome> {
    const item = await this.prisma.client.orderItem.findUnique({
      where: { id: orderItemId },
      include: { order: { select: { id: true, status: true, riskLevel: true, email: true } } },
    });
    if (!item) return { kind: 'missing' };
    // First, so that a line on an order which has since become FULFILLED is
    // answered as sent rather than as unpaid.
    if (item.fulfillmentState === FulfillmentState.DELIVERED) {
      return { kind: 'already-delivered' };
    }
    if (item.order.status !== OrderStatus.PAID && item.order.status !== OrderStatus.FULFILLING) {
      return { kind: 'unpaid', status: item.order.status };
    }
    if (item.order.riskLevel === RiskLevel.HIGH || item.order.riskLevel === RiskLevel.BLOCKED) {
      return { kind: 'held' };
    }
    // Asked of the vault, not of `assignedKeyIds`. That array is written only
    // after a successful send, so a send that failed leaves it empty while the
    // key is bound and paid for — and reading it here stranded the line: this
    // path refused it for having no key, and the manual path refused it for
    // already having one.
    if (!(await this.vault.isBound(item.id))) return { kind: 'no-key' };

    // The crash window: a process that died after the email left and before
    // the line was marked DELIVERED leaves an AUTO_ASSIGNED line whose key the
    // customer already has. Sending again would email the key twice; the log
    // says it went, so the line is finished without opening the key. Only the
    // explicit resend (`resendLicence`) sends a delivered key again.
    if (await this.licenceAlreadyEmailed(item.id, item.order.email)) {
      this.logger.warn(
        `Line ${item.id} already has a delivered licence email; marked DELIVERED without sending again.`,
      );
      return this.finishDelivered(item.id, item.order.id, actor, { recovered: true });
    }

    // The access row is written inside this call, before the plaintext exists.
    const opened = await this.vault.openForDelivery({ orderItemId: item.id, actor });

    const sent = await this.emailLicence({
      orderItemId: item.id,
      secrets: opened.map((entry) => entry.secret),
    });
    if (!sent.ok) return { kind: 'send-failed', error: sent.error };

    return this.finishDelivered(
      item.id,
      item.order.id,
      actor,
      { recovered: false },
      opened.map((entry) => entry.licenseKeyId),
    );
  }

  /**
   * Whether a licence email for this line has already left.
   *
   * Keyed on `orderItemId` in the log payload, which is written from the
   * licence email onwards; a log row from before that carries no id and is
   * not matched.
   */
  /** Only an email the provider accepted for the order's own address, not since bounced, counts. */
  private async licenceAlreadyEmailed(orderItemId: string, toAddress: string): Promise<boolean> {
    const found = await this.prisma.client.notificationLog.findFirst({
      where: {
        template: 'licence.delivered',
        channel: NotificationChannel.EMAIL,
        toAddress,
        deliveredAt: { not: null },
        bouncedAt: null,
        payload: { path: ['orderItemId'], equals: orderItemId },
      },
      select: { id: true },
    });
    return found !== null;
  }

  /** Records a line as sent: vault, line, audit and the order's own status. */
  private async finishDelivered(
    orderItemId: string,
    orderId: string,
    actor: Actor,
    how: { recovered: boolean },
    keyIds?: string[],
  ): Promise<SendOutcome> {
    await this.vault.markDelivered(orderItemId);

    // Written here too, not only on the manual path. A delivered line with an
    // empty array cannot be linked back to the key it sent, which is the one
    // thing somebody handling a complaint needs. A recovered line was not
    // opened here, so its ids are read from the vault — ids only.
    const ids =
      keyIds ?? (await this.vault.keysForOrderItem(orderItemId)).map((key) => key.licenseKeyId);

    await this.prisma.client.orderItem.update({
      where: { id: orderItemId },
      data: {
        fulfillmentState: FulfillmentState.DELIVERED,
        deliveredAt: new Date(),
        assignedKeyIds: ids,
      },
    });

    const kind = actor.kind ?? ActorType.STAFF;
    await this.audit.record({
      // The audit actor is a staff foreign key; the system has no row there,
      // so it is named by `actorType` alone.
      actorId: kind === ActorType.STAFF ? actor.staffId : undefined,
      actorType: kind,
      entity: 'OrderItem',
      entityId: orderItemId,
      action: 'fulfillment.delivered',
      after: how.recovered ? { keys: ids.length, recovered: true } : { keys: ids.length },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    await this.refreshOrderState(orderId);
    return { kind: 'delivered', keys: ids.length };
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

    // Through the transition map, with 'skip': a re-delivery on an order
    // already FULFILLED or COMPLETED is not a status change, and must not walk
    // a COMPLETED order back or fail the delivery that triggered it.
    if (delivered === items.length) {
      await this.prisma.client.$transaction((tx) =>
        transitionOrder(tx, {
          orderId,
          from: order.status,
          to: OrderStatus.FULFILLED,
          actor: { type: 'SYSTEM' },
          reason: 'Every line delivered',
          data: { fulfilledAt: new Date() },
          ifIllegal: 'skip',
        }),
      );
      return;
    }

    if (delivered > 0 && order.status === OrderStatus.PAID) {
      await this.prisma.client.$transaction((tx) =>
        transitionOrder(tx, {
          orderId,
          from: order.status,
          to: OrderStatus.FULFILLING,
          actor: { type: 'SYSTEM' },
          reason: `${String(delivered)} of ${String(items.length)} lines delivered`,
        }),
      );
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
        // What the crash-window check in `sendAssignedLocked` looks up.
        orderItemId: item.id,
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
    if (!order)
      throw new NotFoundException(
        say(`لا يوجد طلب بالرقم ${orderNumber}`, `No order numbered ${orderNumber}`),
      );

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
