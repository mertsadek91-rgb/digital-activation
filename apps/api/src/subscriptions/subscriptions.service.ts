import crypto from 'node:crypto';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { FulfillmentMode, Locale, PublishStatus, StockAlertKind } from '@da/db';

import { MailService } from '../mail/mail.service.js';
import { backInStock, newsletterConfirm } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * The two things a visitor can ask to be told about: a product coming back,
 * and the deals newsletter.
 *
 * Both were buttons that did nothing. The footer box showed "subscribed" after
 * a timer and stored nothing, and "notify me when available" sat on the
 * out-of-stock pages — the ones with the most traffic and nothing to sell —
 * with no handler at all.
 *
 * Neither answer ever says whether an address is already known. Both routes
 * reply the same way for a new address, a repeat and one already confirmed,
 * so they cannot be used to test who is a customer.
 */

const PER_PASS = 50;
const LOCK_KEY = 761_204_004;

/** Distinct labels, so a confirm link can never be replayed as an unsubscribe. */
type Purpose = 'newsletter-confirm' | 'newsletter-unsubscribe';

function secret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (!value) throw new Error('JWT_ACCESS_SECRET is required to sign newsletter links.');
  return value;
}

/** `<email, base64url>.<hmac>`: self-contained, nothing stored until it is used. */
export function newsletterToken(email: string, purpose: Purpose): string {
  const payload = Buffer.from(email).toString('base64url');
  const mac = crypto
    .createHmac('sha256', secret())
    .update(`${purpose}:v1:${payload}`)
    .digest('base64url');
  return `${payload}.${mac}`;
}

export function readNewsletterToken(token: string, purpose: Purpose): string | null {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(
    crypto.createHmac('sha256', secret()).update(`${purpose}:v1:${payload}`).digest('base64url'),
  );
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return Buffer.from(payload, 'base64url').toString('utf8');
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private get storefront(): string {
    return process.env.STOREFRONT_URL ?? 'http://localhost:3000';
  }

  // --- back in stock --------------------------------------------------------

  async requestStockAlert(input: {
    email: string;
    variantId: string;
    locale: 'ar' | 'en';
  }): Promise<{ ok: true }> {
    const variant = await this.prisma.client.variant.findFirst({
      where: { id: input.variantId, status: PublishStatus.PUBLISHED },
      select: { id: true, productId: true },
    });
    if (!variant) throw new BadRequestException('Unknown product option.');

    const customer = await this.prisma.client.customer.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    // Re-asking after a previous alert was sent re-arms it, so a product that
    // sells out twice can be waited for twice.
    await this.prisma.client.stockAlert.upsert({
      where: {
        kind_email_variantId: {
          kind: StockAlertKind.BACK_IN_STOCK,
          email: input.email,
          variantId: variant.id,
        },
      },
      update: { notifiedAt: null, locale: input.locale === 'en' ? Locale.EN : Locale.AR },
      create: {
        kind: StockAlertKind.BACK_IN_STOCK,
        email: input.email,
        variantId: variant.id,
        productId: variant.productId,
        customerId: customer?.id ?? null,
        locale: input.locale === 'en' ? Locale.EN : Locale.AR,
      },
    });
    return { ok: true };
  }

  /**
   * Tells the people waiting once stock is back.
   *
   * A sweep over the database rather than a hook on the stock import, so a
   * key added by any path — the vault import, a manual correction, a script —
   * reaches the people who asked. Only stocked variants: a made-to-order one
   * is never "out of stock" in the sense the button means.
   */
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'back-in-stock' })
  async sweep(): Promise<{ sent: number }> {
    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!lock?.locked) return { sent: 0 };
    try {
      return await this.notify();
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  private async notify(): Promise<{ sent: number }> {
    const alerts = await this.prisma.client.stockAlert.findMany({
      where: {
        kind: StockAlertKind.BACK_IN_STOCK,
        notifiedAt: null,
        variant: {
          status: PublishStatus.PUBLISHED,
          fulfillmentMode: FulfillmentMode.FROM_STOCK,
          product: { status: PublishStatus.PUBLISHED },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: PER_PASS,
      include: {
        variant: {
          select: {
            inventory: { select: { onHand: true, reserved: true } },
            product: {
              select: { slug: true, translations: { select: { locale: true, name: true } } },
            },
          },
        },
      },
    });

    let sent = 0;
    for (const alert of alerts) {
      const variant = alert.variant;
      if (!variant) continue;
      const available = (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0);
      if (available <= 0) continue;

      const locale = alert.locale === Locale.EN ? 'en' : 'ar';
      const name =
        variant.product.translations.find((entry) => entry.locale === alert.locale)?.name ??
        variant.product.translations[0]?.name ??
        variant.product.slug;
      const prefix = locale === 'en' ? '/en' : '';

      const result = await this.mail.send({
        to: alert.email,
        template: 'stock.back-in-stock',
        locale,
        customerId: alert.customerId ?? undefined,
        rendered: backInStock({
          locale,
          productName: name,
          productUrl: `${this.storefront}${prefix}/store/${encodeURIComponent(variant.product.slug)}`,
        }),
        payload: { alertId: alert.id },
      });
      if (!result.ok) continue;

      await this.prisma.client.stockAlert.update({
        where: { id: alert.id },
        data: { notifiedAt: new Date() },
      });
      sent += 1;
    }
    if (sent > 0) this.logger.log(`Sent ${String(sent)} back-in-stock email(s).`);
    return { sent };
  }

  // --- newsletter -----------------------------------------------------------

  /** Sends the confirmation. Subscribes nobody until the link is followed. */
  async subscribe(input: { email: string; locale: 'ar' | 'en' }): Promise<{ ok: true }> {
    const existing = await this.prisma.client.customer.findUnique({
      where: { email: input.email },
      select: { marketingOptInAt: true },
    });
    // Already confirmed: say nothing new and send nothing, rather than a
    // second confirmation that reads like the first one failed.
    if (existing?.marketingOptInAt) return { ok: true };

    const prefix = input.locale === 'en' ? '/en' : '';
    const url = new URL(`${prefix}/newsletter/confirm`, this.storefront);
    url.searchParams.set('token', newsletterToken(input.email, 'newsletter-confirm'));

    await this.mail.send({
      to: input.email,
      template: 'newsletter.confirm',
      locale: input.locale,
      rendered: newsletterConfirm({ locale: input.locale, confirmUrl: url.toString() }),
    });
    return { ok: true };
  }

  async confirm(token: string, locale: 'ar' | 'en'): Promise<{ ok: true }> {
    const email = readNewsletterToken(token, 'newsletter-confirm');
    if (!email) throw new BadRequestException('This link is not valid.');

    const now = new Date();
    await this.prisma.client.customer.upsert({
      where: { email },
      // Only set once: the first confirmation is the consent record.
      update: {},
      create: {
        email,
        marketingOptInAt: now,
        locale: locale === 'en' ? Locale.EN : Locale.AR,
      },
    });
    await this.prisma.client.customer.updateMany({
      where: { email, marketingOptInAt: null },
      data: { marketingOptInAt: now },
    });
    return { ok: true };
  }

  async unsubscribe(token: string): Promise<{ ok: true }> {
    const email = readNewsletterToken(token, 'newsletter-unsubscribe');
    if (!email) throw new BadRequestException('This link is not valid.');
    await this.prisma.client.customer.updateMany({
      where: { email },
      data: { marketingOptInAt: null },
    });
    return { ok: true };
  }
}
