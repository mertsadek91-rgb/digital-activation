import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import type { RenewalSettings, WhatsappSettings } from '@da/contracts';
import {
  FulfillmentState,
  Locale,
  NotificationChannel,
  OrderStatus,
  Prisma,
  PromotionScope,
  PromotionType,
  PublishStatus,
} from '@da/db';

import { licenceExpiry, termOf } from '../common/licence-term.js';
import { MailService } from '../mail/mail.service.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buttonSuffix, chooseDelivery } from '../whatsapp/rules.js';
import { renewalParams } from '../whatsapp/templates.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';

import { formatDate, storefrontUrl, unsubscribeLinks } from './links.js';
import {
  dueRenewalOffset,
  hasMarketingConsent,
  inHoldout,
  mintCode,
  storeTimeZone,
} from './rules.js';
import { renewalReminder } from './templates.js';

/**
 * Renewal reminders.
 *
 * A one-year licence delivered on a known date runs out on a known date, and
 * the customer needs another one whether or not anybody says so. This says so:
 * at each configured offset before the end (30, 14, 3 days by default) and
 * once after it. The account page already lists these dates; the email is
 * the same arithmetic, arriving on the day it matters.
 *
 * The plain reminder is a service message — it goes to every buyer of a
 * time-limited licence and carries no promotion. A renewal discount, when the
 * store sets one, is added only for customers with marketing consent, as a
 * single-use code bound to them, with the discount licence number beside it.
 *
 * A customer who agreed to WhatsApp, when the channel is on and preferred,
 * gets the reminder there instead of by email — the plain one only, since a
 * Utility template may not carry a promotion. WhatsApp needs its own opt-in
 * even for a service message: Meta's policy requires it before a business
 * writes first, whatever the message is about.
 *
 * Once a day, in the morning, store time. A sweep over the database rather
 * than a job scheduled at delivery, like the review invitations: a day the
 * process was down is caught up the next morning, because the question is
 * "what is due now", not "what was scheduled".
 */

/** Statuses of an order whose licence the customer actually holds. */
const HELD_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];

/** Emails in one pass; the rest go tomorrow. Keeps a backlog from arriving as a burst. */
const PER_PASS = 150;
const BATCH = 500;

/** How long a renewal code stays good after the licence ends. */
const CODE_GRACE_DAYS = 14;

/** Distinct from every other advisory lock in the codebase (761 204 xxx are the older sweeps). */
const LOCK_KEY = 761_205_041;

const FEATURE = 'renewals';

interface DueLine {
  id: string;
  orderId: string;
  orderNumber: string;
  orderPlacedAt: Date;
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  email: string;
  customerId: string | null;
  customer: {
    firstName: string | null;
    marketingOptInAt: Date | null;
    marketingOptOutAt: Date | null;
    whatsappPhone: string | null;
    whatsappOptInAt: Date | null;
    whatsappOptOutAt: Date | null;
  } | null;
  locale: 'ar' | 'en';
  expiresAt: Date;
  offsetDays: number;
}

@Injectable()
export class RenewalSweepService {
  private readonly logger = new Logger(RenewalSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: MarketingSettingsService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Cron('0 10 * * *', { name: 'renewal-reminders', timeZone: storeTimeZone() })
  async sweep(): Promise<{ sent: number; heldOut: number }> {
    const settings = await this.settings.get('renewals');
    if (!settings.enabled) return { sent: 0, heldOut: 0 };

    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!lock?.locked) return { sent: 0, heldOut: 0 };

    try {
      return await this.run(settings, await this.settings.get('whatsapp'), new Date());
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  private async run(
    settings: RenewalSettings,
    whatsapp: WhatsappSettings,
    now: Date,
  ): Promise<{ sent: number; heldOut: number }> {
    const due = await this.findDue(settings, now);
    if (due.length === 0) return { sent: 0, heldOut: 0 };

    // One email per licence, not per line: an order of three seats is three
    // lines with one end date, and three identical emails would be spam.
    const groups = new Map<string, DueLine[]>();
    for (const line of due) {
      const key = [
        line.email.toLowerCase(),
        line.orderId,
        line.variantId,
        String(line.offsetDays),
        line.expiresAt.toISOString().slice(0, 10),
      ].join('|');
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }

    let sent = 0;
    let heldOut = 0;
    for (const lines of groups.values()) {
      if (sent >= PER_PASS) break;
      const first = lines[0];
      if (!first) continue;
      try {
        if (await this.alreadyRenewed(first)) continue;

        const holdoutId = first.customerId ?? first.email.toLowerCase();
        if (inHoldout(FEATURE, holdoutId, settings.holdoutPercent)) {
          await this.claim(lines, { heldOut: true });
          heldOut += 1;
          this.logger.log(
            `Renewal reminder for ${first.orderNumber} (${String(first.offsetDays)}d) held out for measurement.`,
          );
          continue;
        }

        if (await this.send(lines, settings, whatsapp, now)) sent += 1;
      } catch (error) {
        // One line that cannot be emailed must not stop the pass. The order
        // number is safe to log; the address is not.
        const reason = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Renewal reminder for ${first.orderNumber} failed: ${reason}`);
      }
    }

    if (sent + heldOut > 0) {
      this.logger.log(`Renewal reminders: sent ${String(sent)}, held out ${String(heldOut)}.`);
    }
    return { sent, heldOut };
  }

  /**
   * Delivered, time-limited lines with a reminder due today that has not been
   * recorded yet.
   *
   * Read in batches and decided in code, because the end date is arithmetic on
   * a JSON snapshot that SQL cannot do cleanly. Lifetime licences are filtered
   * out in the query, which is most of this catalog.
   */
  private async findDue(settings: RenewalSettings, now: Date): Promise<DueLine[]> {
    const due: DueLine[] = [];
    const timeLimited: Prisma.OrderItemWhereInput[] = [
      { variant: { licensePeriodUnit: { not: 'LIFETIME' } } },
      ...(['DAY', 'MONTH', 'YEAR'] as const).map((unit) => ({
        variantSpecSnapshot: { path: ['licensePeriodUnit'], equals: unit },
      })),
    ];

    let cursor: string | undefined;
    for (;;) {
      const rows = await this.prisma.client.orderItem.findMany({
        where: {
          fulfillmentState: FulfillmentState.DELIVERED,
          deliveredAt: { not: null },
          order: { status: { in: HELD_STATUSES } },
          OR: timeLimited,
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        select: {
          id: true,
          orderId: true,
          variantId: true,
          deliveredAt: true,
          productNameSnapshot: true,
          variantSpecSnapshot: true,
          variant: {
            select: {
              productId: true,
              status: true,
              licensePeriodUnit: true,
              licensePeriodValue: true,
              product: {
                select: {
                  slug: true,
                  status: true,
                  translations: { select: { locale: true, name: true } },
                },
              },
            },
          },
          order: {
            select: {
              number: true,
              email: true,
              customerId: true,
              locale: true,
              placedAt: true,
              customer: {
                select: {
                  firstName: true,
                  marketingOptInAt: true,
                  marketingOptOutAt: true,
                  whatsappPhone: true,
                  whatsappOptInAt: true,
                  whatsappOptOutAt: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]?.id;

      for (const row of rows) {
        if (!row.deliveredAt) continue;
        if (row.order.customer?.deletedAt) continue;
        // Nothing to renew into if the product is no longer on sale.
        if (
          row.variant.status !== PublishStatus.PUBLISHED ||
          row.variant.product.status !== PublishStatus.PUBLISHED
        ) {
          continue;
        }

        const term = termOf(row.variantSpecSnapshot, {
          unit: row.variant.licensePeriodUnit,
          value: row.variant.licensePeriodValue,
        });
        const expiresAt = licenceExpiry(row.deliveredAt, term);
        if (!expiresAt) continue;

        const offsetDays = dueRenewalOffset({
          expiresAt,
          deliveredAt: row.deliveredAt,
          now,
          daysBefore: settings.daysBefore,
          daysAfter: settings.daysAfter,
        });
        if (offsetDays === null) continue;

        const locale = row.order.locale === Locale.EN ? 'en' : 'ar';
        const name =
          row.variant.product.translations.find((entry) => entry.locale === row.order.locale)
            ?.name ?? row.productNameSnapshot;

        due.push({
          id: row.id,
          orderId: row.orderId,
          orderNumber: row.order.number,
          orderPlacedAt: row.order.placedAt,
          variantId: row.variantId,
          productId: row.variant.productId,
          productSlug: row.variant.product.slug,
          productName: name,
          email: row.order.email,
          customerId: row.order.customerId,
          customer: row.order.customer,
          locale,
          expiresAt,
          offsetDays,
        });
      }
      if (rows.length < BATCH) break;
    }

    if (due.length === 0) return due;

    // Drop what is already recorded — sent, or held out.
    const recorded = await this.prisma.client.renewalReminder.findMany({
      where: { orderItemId: { in: due.map((line) => line.id) } },
      select: { orderItemId: true, offsetDays: true },
    });
    const seen = new Set(recorded.map((row) => `${row.orderItemId}:${String(row.offsetDays)}`));
    return due.filter((line) => !seen.has(`${line.id}:${String(line.offsetDays)}`));
  }

  /**
   * Whether the customer has bought the product again since.
   *
   * Somebody who renewed last week must not be told their licence is ending.
   * Matched by customer and by address, because a guest checking out twice
   * with the same email is the same person.
   */
  private async alreadyRenewed(line: DueLine): Promise<boolean> {
    const later = await this.prisma.client.order.findFirst({
      where: {
        id: { not: line.orderId },
        status: { in: HELD_STATUSES },
        placedAt: { gt: line.orderPlacedAt },
        OR: [
          ...(line.customerId ? [{ customerId: line.customerId }] : []),
          { email: { equals: line.email, mode: 'insensitive' as const } },
        ],
        items: { some: { variant: { productId: line.productId } } },
      },
      select: { id: true },
    });
    return later !== null;
  }

  /** Writes the reminder rows. The unique index makes a second writer a no-op. */
  private async claim(
    lines: DueLine[],
    data: {
      heldOut: boolean;
      sentAt?: Date;
      promotionId?: string | null;
      channel?: NotificationChannel;
    },
  ): Promise<void> {
    await this.prisma.client.renewalReminder.createMany({
      data: lines.map((line) => ({
        orderItemId: line.id,
        orderId: line.orderId,
        variantId: line.variantId,
        productId: line.productId,
        customerId: line.customerId,
        email: line.email,
        offsetDays: line.offsetDays,
        expiresAt: line.expiresAt,
        heldOut: data.heldOut,
        sentAt: data.sentAt ?? null,
        promotionId: data.promotionId ?? null,
        channel: data.channel ?? NotificationChannel.EMAIL,
      })),
      skipDuplicates: true,
    });
  }

  private async send(
    lines: DueLine[],
    settings: RenewalSettings,
    whatsapp: WhatsappSettings,
    now: Date,
  ): Promise<boolean> {
    const first = lines[0];
    if (!first) return false;

    const route = chooseDelivery({
      whatsappEnabled: whatsapp.enabled,
      preferWhatsapp: whatsapp.preferWhatsapp,
      configured: this.whatsapp.configured,
      templateName: whatsapp.renewal.templateName,
      customer: first.customer,
      // A service message: email is always allowed. The holdout was decided
      // by the caller, before the channel, so it is the same on both.
      emailAllowed: true,
      heldOut: false,
    });
    if (route === 'whatsapp' && (await this.sendWhatsapp(lines, whatsapp))) return true;
    // Either the route was email, or WhatsApp refused the message outright —
    // in which case the reminder has not reached anybody and the email goes.

    const consent = hasMarketingConsent(first.customer);
    const offer =
      settings.discountPercent > 0 && consent && first.customerId
        ? await this.offerFor(lines, first.customerId, settings, now)
        : null;

    const timeZone = storeTimeZone();
    const renew = storefrontUrl('/cart', first.locale);
    renew.searchParams.set('add', first.variantId);
    if (lines.length > 1) renew.searchParams.set('qty', String(lines.length));
    const unsubscribe = offer ? unsubscribeLinks(first.email, first.locale) : null;

    const result = await this.mail.send({
      to: first.email,
      template: 'renewal.reminder',
      locale: first.locale,
      // A reminder with a discount in it is marketing, and leaves from the
      // marketing domain; the plain one is about something the customer owns.
      kind: offer ? 'marketing' : 'transactional',
      customerId: first.customerId ?? undefined,
      rendered: renewalReminder({
        locale: first.locale,
        firstName: first.customer?.firstName ?? null,
        productName: first.productName,
        qty: lines.length,
        expiresOn: formatDate(first.expiresAt, first.locale, timeZone),
        offsetDays: first.offsetDays,
        renewUrl: renew.toString(),
        accountUrl: storefrontUrl('/account/for-you', first.locale).toString(),
        offer: offer
          ? {
              code: offer.code,
              percent: settings.discountPercent,
              validUntil: formatDate(offer.endsAt, first.locale, timeZone),
              licenceNumber: settings.discountLicenceNumber,
            }
          : null,
        unsubscribeUrl: unsubscribe?.pageUrl ?? null,
      }),
      ...(unsubscribe ? { headers: unsubscribe.headers } : {}),
      payload: {
        orderNumber: first.orderNumber,
        offsetDays: first.offsetDays,
        withCode: offer !== null,
      },
    });

    if (!result.ok) {
      // Not recorded, so tomorrow's pass tries again. A code minted for a
      // message that never left is switched off rather than left live.
      if (offer?.minted) {
        await this.prisma.client.promotion.update({
          where: { id: offer.id },
          data: { isActive: false },
        });
      }
      return false;
    }

    await this.claim(lines, { heldOut: false, sentAt: new Date(), promotionId: offer?.id ?? null });
    return true;
  }

  /** The plain reminder as the approved Utility template, recorded like the email. */
  private async sendWhatsapp(lines: DueLine[], whatsapp: WhatsappSettings): Promise<boolean> {
    const first = lines[0];
    const phone = first?.customer?.whatsappPhone;
    if (!first || !phone) return false;

    const renew = storefrontUrl('/cart', first.locale);
    renew.searchParams.set('add', first.variantId);
    if (lines.length > 1) renew.searchParams.set('qty', String(lines.length));
    const template = whatsapp.renewal;

    const result = await this.whatsapp.sendTemplate({
      to: phone,
      template: template.templateName,
      language: first.locale === 'ar' ? template.languageAr : template.languageEn,
      bodyParams: renewalParams({
        locale: first.locale,
        firstName: first.customer?.firstName ?? null,
        productName: first.productName,
        expiresOn: formatDate(first.expiresAt, first.locale, storeTimeZone()),
        offsetDays: first.offsetDays,
      }),
      buttonUrlSuffix: buttonSuffix(renew),
      log: {
        template: 'renewal.reminder',
        locale: first.locale,
        customerId: first.customerId,
        payload: { orderNumber: first.orderNumber, offsetDays: first.offsetDays, withCode: false },
      },
    });
    if (!result.ok) return false;

    await this.claim(lines, {
      heldOut: false,
      sentAt: new Date(),
      promotionId: null,
      channel: NotificationChannel.WHATSAPP,
    });
    return true;
  }

  /**
   * The renewal code for this licence: the one an earlier reminder already
   * issued if it is still unused and in date, otherwise a new one.
   *
   * Single use, bound to the customer, limited to the product being renewed,
   * and expiring a fortnight after the licence does.
   */
  private async offerFor(
    lines: DueLine[],
    customerId: string,
    settings: RenewalSettings,
    now: Date,
  ): Promise<{ id: string; code: string; endsAt: Date; minted: boolean } | null> {
    const first = lines[0];
    if (!first) return null;

    const earlier = await this.prisma.client.renewalReminder.findFirst({
      where: { orderItemId: { in: lines.map((line) => line.id) }, promotionId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { promotionId: true },
    });
    if (earlier?.promotionId) {
      const promotion = await this.prisma.client.promotion.findFirst({
        where: {
          id: earlier.promotionId,
          isActive: true,
          usageCount: 0,
          endsAt: { gt: now },
          code: { not: null },
        },
        select: { id: true, code: true, endsAt: true },
      });
      if (promotion?.code && promotion.endsAt) {
        return { id: promotion.id, code: promotion.code, endsAt: promotion.endsAt, minted: false };
      }
    }

    const endsAt = new Date(
      Math.max(first.expiresAt.getTime(), now.getTime()) + CODE_GRACE_DAYS * 86_400_000,
    );
    const promotion = await this.prisma.client.promotion.create({
      data: {
        code: mintCode('RENEW'),
        type: PromotionType.PERCENT,
        scope: PromotionScope.PRODUCT,
        value: new Prisma.Decimal(settings.discountPercent),
        name: `Renewal ${first.productSlug}`,
        description: `Renewal reminder for order ${first.orderNumber}`,
        rules: { productIds: [first.productId] },
        startsAt: now,
        endsAt,
        usageLimit: 1,
        perCustomerLimit: 1,
        singleUse: true,
        issuedToId: customerId,
      },
      select: { id: true, code: true },
    });
    return { id: promotion.id, code: promotion.code ?? '', endsAt, minted: true };
  }
}
