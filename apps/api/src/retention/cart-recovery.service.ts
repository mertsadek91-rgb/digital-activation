import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import type { CartRecoverySettings, WhatsappSettings } from '@da/contracts';
import {
  CartStage,
  Locale,
  NotificationChannel,
  OrderStatus,
  Prisma,
  PromotionScope,
  PromotionType,
} from '@da/db';

import { CartService } from '../cart/cart.service.js';
import { readLink, signLink } from '../common/signed-link.js';
import { MailService } from '../mail/mail.service.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buttonSuffix, chooseDelivery } from '../whatsapp/rules.js';
import { cartRecoveryParams } from '../whatsapp/templates.js';
import { WhatsappService } from '../whatsapp/whatsapp.service.js';

import { formatDateTime, storefrontUrl, unsubscribeLinks } from './links.js';
import {
  LADDER_STAGES,
  STALE_STEP_HOURS,
  hasMarketingConsent,
  hoursBetween,
  inHoldout,
  inQuietHours,
  ladderPosition,
  mintCode,
  nextCartStep,
  orderedSteps,
  storeHour,
  storeTimeZone,
} from './rules.js';
import { cartRecovery } from './templates.js';

/**
 * The abandoned-cart ladder.
 *
 * A cart becomes recoverable the moment checkout captures an email; this is
 * what writes to it afterwards. Up to four rungs, each after a configured
 * number of idle hours, the cart's stage advancing one rung per email and a
 * `CartRecoveryEvent` row per rung, so each step is measured on its own.
 *
 * What it will not do:
 *  - write to somebody who has since paid — for this cart, or any order from
 *    the same address after the cart went quiet;
 *  - write to anybody without marketing consent. A reminder about a cart
 *    somebody left is marketing under the PDPL, not a service message about
 *    something they bought, so every rung — with a discount or without —
 *    goes only to a customer whose opt-in is on record and not withdrawn.
 *    A guest who never opted in gets nothing;
 *  - write on both channels. When WhatsApp is on and preferred and the
 *    customer ticked the WhatsApp box, a rung goes there *instead of* the
 *    email; consent is per channel, so WhatsApp consent alone is enough for
 *    WhatsApp and email consent alone for email;
 *  - write during quiet hours, in the store's timezone;
 *  - invent urgency. Nothing in a cart is held before payment, and the email
 *    says what is in it, not that it is running out.
 *
 * Every ten minutes, so a one-hour nudge lands close to the hour it was set for.
 */

/** Carts considered in one pass. */
const PER_PASS = 60;

/** How long an emailed restore link keeps working. The cart cookie lives 30 days. */
const LINK_DAYS = 30;

const LOCK_KEY = 761_205_042;

const FEATURE = 'cartRecovery';

type RecoveryCart = Prisma.CartGetPayload<{
  include: {
    customer: {
      select: {
        id: true;
        firstName: true;
        marketingOptInAt: true;
        marketingOptOutAt: true;
        whatsappPhone: true;
        whatsappOptInAt: true;
        whatsappOptOutAt: true;
        deletedAt: true;
      };
    };
    items: {
      include: {
        variant: {
          select: {
            productId: true;
            product: { select: { slug: true; translations: true } };
          };
        };
      };
    };
  };
}>;

/** Statuses that mean an order was paid for. */
const PAID_STATUSES = [
  OrderStatus.PAID,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];

@Injectable()
export class CartRecoveryService {
  private readonly logger = new Logger(CartRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly cart: CartService,
    private readonly settings: MarketingSettingsService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'cart-recovery' })
  async sweep(): Promise<{ sent: number; heldOut: number; closed: number }> {
    const none = { sent: 0, heldOut: 0, closed: 0 };
    const settings = await this.settings.get('cartRecovery');
    if (!settings.enabled || settings.steps.length === 0) return none;

    const now = new Date();
    if (inQuietHours(storeHour(now), settings.quietFromHour, settings.quietToHour)) return none;

    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!lock?.locked) return none;

    try {
      return await this.run(settings, await this.settings.get('whatsapp'), now);
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  private async run(
    settings: CartRecoverySettings,
    whatsapp: WhatsappSettings,
    now: Date,
  ): Promise<{ sent: number; heldOut: number; closed: number }> {
    const steps = orderedSteps(settings.steps);
    const first = steps[0];
    const last = steps[steps.length - 1];
    if (!first || !last) return { sent: 0, heldOut: 0, closed: 0 };

    // Whether a WhatsApp-only customer could be reached this pass. Only then
    // are they read at all — otherwise they would be skipped in the loop on
    // every pass and crowd out carts that can be sent.
    const whatsappLive =
      whatsapp.enabled &&
      whatsapp.preferWhatsapp &&
      this.whatsapp.configured &&
      whatsapp.cartRecovery.templateName !== '';
    const channelFor = (cart: RecoveryCart, heldOut: boolean) =>
      chooseDelivery({
        whatsappEnabled: whatsapp.enabled,
        preferWhatsapp: whatsapp.preferWhatsapp,
        configured: this.whatsapp.configured,
        templateName: whatsapp.cartRecovery.templateName,
        customer: cart.customer,
        emailAllowed: cart.customer !== null && hasMarketingConsent(cart.customer),
        heldOut,
      });

    const carts = await this.prisma.client.cart.findMany({
      where: {
        email: { not: null },
        stage: { in: [CartStage.ACTIVE, ...LADDER_STAGES.slice(0, steps.length - 1)] },
        items: { some: {} },
        // Consent only, and filtered in the query rather than skipped in the
        // loop: a skipped cart would come back first on every pass and crowd
        // out the rest. (Unsubscribing clears the opt-in, so a set opt-in
        // means consent was given — or given again — after any opt-out.)
        customer: {
          deletedAt: null,
          OR: [
            { marketingOptInAt: { not: null } },
            ...(whatsappLive
              ? [{ whatsappOptInAt: { not: null }, whatsappPhone: { not: null } }]
              : []),
          ],
        },
        lastActivityAt: {
          lte: new Date(now.getTime() - first.afterHours * 3_600_000),
          gte: new Date(now.getTime() - (last.afterHours + STALE_STEP_HOURS) * 3_600_000),
        },
      },
      orderBy: { lastActivityAt: 'asc' },
      take: PER_PASS,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            marketingOptInAt: true,
            marketingOptOutAt: true,
            whatsappPhone: true,
            whatsappOptInAt: true,
            whatsappOptOutAt: true,
            deletedAt: true,
          },
        },
        items: {
          orderBy: { createdAt: 'asc' },
          include: {
            variant: {
              select: {
                productId: true,
                product: { select: { slug: true, translations: true } },
              },
            },
          },
        },
      },
    });

    let sent = 0;
    let heldOut = 0;
    let closed = 0;

    for (const cart of carts) {
      const email = cart.email;
      if (!email) continue;
      try {
        const position = ladderPosition(cart.stage);
        if (position === null) continue;
        const step = nextCartStep({
          position,
          idleHours: hoursBetween(cart.lastActivityAt, now),
          steps,
        });
        if (step === null) continue;
        const stage = LADDER_STAGES[step];
        const config = steps[step];
        if (!stage || !config) continue;

        // Bought anyway — this cart through another tab, or a new cart with
        // the same address. Nothing to recover; stop the ladder for good. The
        // one case where closing is right: the purchase it was for happened.
        const paid = await this.prisma.client.order.findFirst({
          where: {
            status: { in: PAID_STATUSES },
            OR: [
              { cartId: cart.id },
              {
                email: { equals: email, mode: 'insensitive' },
                paidAt: { gte: cart.lastActivityAt },
              },
            ],
          },
          select: { id: true },
        });
        if (paid) {
          await this.prisma.client.cart.update({
            where: { id: cart.id },
            data: { stage: CartStage.CLOSED },
          });
          closed += 1;
          continue;
        }

        // The query already excludes these; asked again with the exact rule.
        // Checked again here, against both timestamps and per channel, in
        // case an opt-out (or a STOP) landed after the query read the row.
        if (!cart.customer || cart.customer.deletedAt) continue;
        const route = channelFor(cart, false);
        if (route === 'none') continue;

        // Same holdout whichever channel the rung would have gone on: the
        // question it answers is whether reminding works, not which app.
        if (channelFor(cart, inHoldout(FEATURE, cart.id, settings.holdoutPercent)) === 'held-out') {
          await this.advance(cart.id, cart.stage, stage, {
            heldOut: true,
            promotionId: null,
            channel:
              route === 'whatsapp' ? NotificationChannel.WHATSAPP : NotificationChannel.EMAIL,
          });
          heldOut += 1;
          this.logger.log(`Cart ${cart.id} held out of recovery step ${String(step + 1)}.`);
          continue;
        }

        // Only consented customers get this far (on the channel the code
        // travels on), which is what a code needs.
        const offer =
          config.discountPercent > 0
            ? await this.mint(cart, config.discountPercent, settings, now)
            : null;
        const offered = offer ? { ...offer, percent: config.discountPercent } : null;

        let channel: NotificationChannel = NotificationChannel.EMAIL;
        let ok = false;
        if (route === 'whatsapp') {
          ok = await this.sendWhatsapp(cart, step, offered, settings, whatsapp);
          if (ok) channel = NotificationChannel.WHATSAPP;
        }
        // Email when that was the route, or when WhatsApp refused the message
        // outright and email consent exists: the rung was not delivered, so
        // this is a fallback, not a second message.
        if (!ok && hasMarketingConsent(cart.customer)) {
          ok = await this.send(cart, email, step, offered, settings);
        }
        if (!ok) {
          if (offer) {
            await this.prisma.client.promotion.update({
              where: { id: offer.id },
              data: { isActive: false },
            });
          }
          continue;
        }

        await this.advance(cart.id, cart.stage, stage, {
          heldOut: false,
          promotionId: offer?.id ?? null,
          channel,
        });
        sent += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(`Cart recovery for ${cart.id} failed: ${reason}`);
      }
    }

    if (sent + heldOut + closed > 0) {
      this.logger.log(
        `Cart recovery: sent ${String(sent)}, held out ${String(heldOut)}, closed ${String(closed)}.`,
      );
    }
    return { sent, heldOut, closed };
  }

  /**
   * Moves the cart one rung on and records the touch.
   *
   * Compare-and-set on the stage, so a cart the shopper paid for in the
   * meantime (which `markPaid` moves to CLOSED or RECOVERED) is not dragged
   * back onto the ladder.
   */
  private async advance(
    cartId: string,
    from: CartStage,
    to: CartStage,
    event: { heldOut: boolean; promotionId: string | null; channel: NotificationChannel },
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const moved = await tx.cart.updateMany({
        where: { id: cartId, stage: from },
        data: { stage: to },
      });
      if (moved.count !== 1) return;
      await tx.cartRecoveryEvent.create({
        data: {
          cartId,
          stage: to,
          channel: event.channel,
          heldOut: event.heldOut,
          promotionId: event.promotionId,
        },
      });
    });
  }

  /** A single-use code for this cart's customer and this cart's products. */
  private async mint(
    cart: {
      id: string;
      customer: { id: string } | null;
      items: { variant: { productId: string } }[];
    },
    percent: number,
    settings: CartRecoverySettings,
    now: Date,
  ): Promise<{ id: string; code: string; endsAt: Date } | null> {
    if (!cart.customer) return null;
    const endsAt = new Date(now.getTime() + settings.codeValidHours * 3_600_000);
    const productIds = [...new Set(cart.items.map((item) => item.variant.productId))];
    const promotion = await this.prisma.client.promotion.create({
      data: {
        code: mintCode('BACK'),
        type: PromotionType.PERCENT,
        scope: PromotionScope.PRODUCT,
        value: new Prisma.Decimal(percent),
        name: 'Cart recovery',
        description: `Abandoned-cart offer for cart ${cart.id}`,
        rules: { productIds },
        startsAt: now,
        endsAt,
        usageLimit: 1,
        perCustomerLimit: 1,
        singleUse: true,
        issuedToId: cart.customer.id,
      },
      select: { id: true, code: true },
    });
    return promotion.code ? { id: promotion.id, code: promotion.code, endsAt } : null;
  }

  /** The cart's lines and total in its own currency and language. */
  private async summarise(
    cart: RecoveryCart,
    locale: 'ar' | 'en',
  ): Promise<{ lines: { productName: string; qty: number; lineTotal: string }[]; total: string }> {
    const currency = cart.currency;
    const lines = await Promise.all(
      cart.items.map(async (item) => {
        const name =
          item.variant.product.translations.find((entry) => entry.locale === cart.locale)?.name ??
          item.variant.product.translations[0]?.name ??
          item.variant.product.slug;
        const total = await this.cart.convertUsd(item.unitPriceUsd.times(item.qty), currency);
        return { productName: name, qty: item.qty, lineTotal: money(total, locale) };
      }),
    );
    const subtotal = cart.items.reduce(
      (sum, item) => sum.plus(item.unitPriceUsd.times(item.qty)),
      new Prisma.Decimal(0),
    );
    return { lines, total: money(await this.cart.convertUsd(subtotal, currency), locale) };
  }

  /** The signed link that puts this cart back in whichever browser opens it. */
  private restoreUrl(cartId: string, locale: 'ar' | 'en'): URL {
    const restore = storefrontUrl('/cart', locale);
    restore.searchParams.set(
      'restore',
      signLink('cart-restore', cartId, new Date(Date.now() + LINK_DAYS * 86_400_000)),
    );
    return restore;
  }

  /**
   * The rung as the approved WhatsApp template. The restore link is the URL
   * button, and it carries any code: opening it puts the discount on the cart.
   */
  private async sendWhatsapp(
    cart: RecoveryCart,
    step: number,
    offer: { code: string; endsAt: Date; percent: number } | null,
    settings: CartRecoverySettings,
    whatsapp: WhatsappSettings,
  ): Promise<boolean> {
    const phone = cart.customer?.whatsappPhone;
    if (!phone) return false;
    const locale = cart.locale === Locale.EN ? 'en' : 'ar';
    const { lines, total } = await this.summarise(cart, locale);
    const template = whatsapp.cartRecovery;
    const result = await this.whatsapp.sendTemplate({
      to: phone,
      template: template.templateName,
      language: locale === 'ar' ? template.languageAr : template.languageEn,
      bodyParams: cartRecoveryParams({
        locale,
        firstName: cart.customer?.firstName ?? null,
        productNames: lines.map((line) => line.productName),
        total,
        offer: offer
          ? { percent: offer.percent, licenceNumber: settings.discountLicenceNumber }
          : null,
      }),
      buttonUrlSuffix: buttonSuffix(this.restoreUrl(cart.id, locale)),
      log: {
        template: `cart.recovery.${String(step + 1)}`,
        locale,
        customerId: cart.customerId,
        payload: { cartId: cart.id, step: step + 1, withCode: offer !== null },
      },
    });
    return result.ok;
  }

  private async send(
    cart: RecoveryCart,
    email: string,
    step: number,
    offer: { code: string; endsAt: Date; percent: number } | null,
    settings: CartRecoverySettings,
  ): Promise<boolean> {
    const locale = cart.locale === Locale.EN ? 'en' : 'ar';
    const { lines, total } = await this.summarise(cart, locale);
    const restore = this.restoreUrl(cart.id, locale);
    const unsubscribe = unsubscribeLinks(email, locale);

    const result = await this.mail.send({
      to: email,
      template: `cart.recovery.${String(step + 1)}`,
      locale,
      // From the marketing domain: a cart reminder is not about something the
      // customer owns, and a complaint about one must not land on the domain
      // that delivers licences.
      kind: 'marketing',
      customerId: cart.customerId ?? undefined,
      rendered: cartRecovery({
        locale,
        step,
        lines,
        total,
        restoreUrl: restore.toString(),
        offer: offer
          ? {
              code: offer.code,
              percent: offer.percent,
              validUntil: formatDateTime(offer.endsAt, locale, storeTimeZone()),
              licenceNumber: settings.discountLicenceNumber,
            }
          : null,
        unsubscribeUrl: unsubscribe.pageUrl,
      }),
      headers: unsubscribe.headers,
      payload: { cartId: cart.id, step: step + 1, withCode: offer !== null },
    });
    return result.ok;
  }

  // --- restoring ---------------------------------------------------------------

  /**
   * The cart a recovery link points at, for the browser that opened it.
   *
   * Returns the cart's token for the controller to set as the cookie, or null
   * when the link is forged, expired, or its cart already closed — in which
   * case the visitor simply keeps whatever cart they had. The most recent
   * recovery code, if still good, is put on the cart, so the discount the
   * email promised is there without typing it.
   */
  async restore(token: string): Promise<string | null> {
    const cartId = readLink('cart-restore', token);
    if (!cartId) return null;

    const cart = await this.prisma.client.cart.findUnique({
      where: { id: cartId },
      select: { id: true, token: true, stage: true, couponCode: true },
    });
    if (!cart || cart.stage === CartStage.CLOSED || cart.stage === CartStage.RECOVERED) {
      return null;
    }

    const event = await this.prisma.client.cartRecoveryEvent.findFirst({
      where: { cartId: cart.id, heldOut: false },
      orderBy: { sentAt: 'desc' },
      select: { id: true, clickedAt: true },
    });
    const offered = await this.prisma.client.cartRecoveryEvent.findFirst({
      where: { cartId: cart.id, heldOut: false, promotionId: { not: null } },
      orderBy: { sentAt: 'desc' },
      select: {
        promotion: {
          select: {
            code: true,
            isActive: true,
            endsAt: true,
            usageLimit: true,
            usageCount: true,
          },
        },
      },
    });
    const promotion = offered?.promotion;
    const now = new Date();
    const codeStillGood =
      promotion?.code &&
      promotion.isActive &&
      (!promotion.endsAt || promotion.endsAt > now) &&
      (promotion.usageLimit === null || promotion.usageCount < promotion.usageLimit);

    await this.prisma.client.cart.update({
      where: { id: cart.id },
      data: {
        lastActivityAt: now,
        ...(codeStillGood ? { couponCode: promotion.code } : {}),
      },
    });
    if (event && !event.clickedAt) {
      await this.prisma.client.cartRecoveryEvent.update({
        where: { id: event.id },
        data: { clickedAt: now },
      });
    }
    return cart.token;
  }
}

function money(value: { amount: string; currency: string }, locale: 'ar' | 'en'): string {
  const amount = Number(value.amount);
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-u-nu-latn' : 'en', {
      style: 'currency',
      currency: value.currency,
    }).format(amount);
  } catch {
    return `${value.amount} ${value.currency}`;
  }
}
