import crypto from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  CUSTOMER_SESSION_HOURS,
  type CustomerMe,
  type CustomerSecret,
  type LicenceList,
} from '@da/contracts';
import { ActorType, FulfillmentState, Locale, OrderStatus } from '@da/db';

import { parseActivationSteps } from '../common/activation-steps.js';
import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { MailService } from '../mail/mail.service.js';
import { accountLink } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VaultService } from '../vault/vault.service.js';

/**
 * The customer's own licences.
 *
 * This page exists for one moment: the licence email is gone — deleted,
 * filtered, or read on a phone that has since been wiped — and the key is
 * needed now. Until it existed the only answer was for the customer to write
 * in and for somebody to read a key out of the vault by hand, which is both
 * slower for them and riskier for everyone: a member of staff reading a key is
 * the act this system is built to make rare.
 *
 * Sign-in is a single-use link emailed to the address on the order, and there
 * is no password anywhere in the flow. The argument is worth stating plainly
 * because it decides the whole shape of this file: the licence was already
 * delivered to that mailbox, so anybody who controls the mailbox already has
 * the key. Requiring control of the mailbox is therefore exactly the bar that
 * handed the key over in the first place — not weaker, and not theatre. A
 * password, by contrast, would add a secret to steal without raising that bar,
 * and 218 customers migrated from WordPress have no hash to reuse anyway.
 *
 * What the flow does not do is widen anything:
 *
 *   - The list carries no secret. A key comes out one line at a time on a
 *     deliberate click, and each read writes a REVEAL row to the vault's
 *     access log with the customer as the actor — the same log that records a
 *     member of staff reading one, because "who has seen this key" must be
 *     answerable from one place.
 *   - Only delivered lines on the customer's own paid orders are readable.
 *   - The session is twelve hours, not thirty days. A cookie that can read
 *     licence keys is not a cookie to leave on a shared computer for a month,
 *     and asking for a new link costs ten seconds against the same mailbox
 *     check as before.
 *   - "Send me the email again" is offered beside every reveal, because for
 *     most people that is the better answer: it puts the key back where they
 *     expect it and shows it to nobody on the way.
 */
const LINK_MINUTES = 15;

/** One link a minute per address. A slower brake than the IP throttle, and a
 *  different one: it stops this route being used to mail-bomb a stranger. */
const LINK_COOLDOWN_SECONDS = 60;

export interface CustomerActor {
  customerId: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: VaultService,
    private readonly fulfillment: FulfillmentService,
    private readonly mail: MailService,
  ) {}

  private hash(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  // --- signing in -----------------------------------------------------------

  /**
   * Emails a sign-in link, and says nothing about whether the address is known.
   *
   * The answer is identical either way. Telling a stranger that an address is
   * not a customer turns this route into a customer-list oracle, and this
   * store's customer list is worth money to somebody — the legacy site's own
   * database is the reason that is not hypothetical.
   */
  async requestLink(input: {
    email: string;
    locale: 'ar' | 'en';
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void> {
    const customer = await this.prisma.client.customer.findUnique({
      where: { email: input.email },
      select: { id: true, locale: true, deletedAt: true },
    });

    // No such customer, or a closed account: the same silence, and no row.
    if (!customer || customer.deletedAt) {
      this.logger.log('Sign-in link requested for an address with no account.');
      return;
    }

    const recent = await this.prisma.client.customerLoginToken.findFirst({
      where: {
        customerId: customer.id,
        createdAt: { gt: new Date(Date.now() - LINK_COOLDOWN_SECONDS * 1000) },
      },
      select: { id: true },
    });
    if (recent) {
      this.logger.log('Sign-in link suppressed by the per-address cooldown.');
      return;
    }

    // 32 bytes, base64url: long enough that guessing is not a strategy, and
    // safe in a URL without escaping.
    const token = crypto.randomBytes(32).toString('base64url');

    await this.prisma.client.customerLoginToken.create({
      data: {
        customerId: customer.id,
        tokenHash: this.hash(token),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: new Date(Date.now() + LINK_MINUTES * 60 * 1000),
      },
    });

    const locale = input.locale;
    await this.mail.send({
      to: input.email,
      template: 'account.link',
      locale,
      customerId: customer.id,
      rendered: accountLink({
        locale,
        url: this.linkUrl(token, locale),
        minutes: LINK_MINUTES,
        supportEmail: this.mail.supportEmail,
      }),
      // Not the token. A NotificationLog row that carries the link is a
      // sign-in credential sitting in a table the admin panel can read.
      payload: { minutes: LINK_MINUTES },
    });
  }

  private linkUrl(token: string, locale: 'ar' | 'en'): string {
    const base = process.env.STOREFRONT_URL ?? 'http://localhost:3000';
    const prefix = locale === 'en' ? '/en' : '';
    const url = new URL(`${prefix}/account`, base);
    url.searchParams.set('token', token);
    return url.toString();
  }

  /**
   * Trades a link for a session.
   *
   * Single use, and the row is marked rather than deleted: it is the record
   * that the link was redeemed, and "when did somebody last sign in as this
   * customer" is a question a refund argument turns on.
   */
  async exchange(input: {
    token: string;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ sessionToken: string; expiresAt: Date; customer: CustomerMe }> {
    const row = await this.prisma.client.customerLoginToken.findUnique({
      where: { tokenHash: this.hash(input.token) },
      include: { customer: true },
    });

    // One message for every failure mode. A link that is unknown, expired or
    // already used are three different facts and none of them is the visitor's
    // business — the only useful next step is the same in all three.
    const invalid = new BadRequestException(
      'هذا الرابط لم يعد صالحاً. اطلب رابطاً جديداً — يعمل لمرّة واحدة ولمدّة ربع ساعة.',
    );
    if (!row || row.usedAt || row.expiresAt <= new Date() || row.customer.deletedAt) {
      throw invalid;
    }

    const sessionToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_HOURS * 3600 * 1000);

    await this.prisma.client.$transaction([
      this.prisma.client.customerLoginToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.client.customerSession.create({
        data: {
          customerId: row.customerId,
          tokenHash: this.hash(sessionToken),
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          expiresAt,
        },
      }),
      // A verified address, established by the click. Nothing else in the
      // system had a way to set this for a guest checkout.
      this.prisma.client.customer.update({
        where: { id: row.customerId },
        data: { emailVerifiedAt: row.customer.emailVerifiedAt ?? new Date() },
      }),
    ]);

    return {
      sessionToken,
      expiresAt,
      customer: this.toMe(row.customer, expiresAt),
    };
  }

  /** Resolves a session cookie, or nothing. Called on every account request. */
  async sessionFor(
    token: string | undefined,
  ): Promise<{ customerId: string; me: CustomerMe } | null> {
    if (!token) return null;

    const session = await this.prisma.client.customerSession.findUnique({
      where: { tokenHash: this.hash(token) },
      include: { customer: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    if (session.customer.deletedAt) return null;

    // Touched rather than rotated: a customer session is read-only and short,
    // and rotating a cookie on every request breaks two tabs at once.
    await this.prisma.client.customerSession.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });

    return {
      customerId: session.customerId,
      me: this.toMe(session.customer, session.expiresAt),
    };
  }

  async signOut(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.client.customerSession.updateMany({
      where: { tokenHash: this.hash(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private toMe(
    customer: { email: string; firstName: string | null; locale: Locale; orderCount: number },
    expiresAt: Date,
  ): CustomerMe {
    return {
      email: customer.email,
      firstName: customer.firstName,
      locale: customer.locale === Locale.EN ? 'en' : 'ar',
      orderCount: customer.orderCount,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // --- the licences ---------------------------------------------------------

  /**
   * Every line this customer has bought that is, or is becoming, a licence.
   *
   * Includes the lines still being prepared. Most of this catalog is ordered
   * from a supplier after payment, so "nothing here yet" is the normal state
   * for the first few hours — and a page that showed only finished lines would
   * look empty exactly when a customer is anxious about having paid.
   */
  async licences(customerId: string): Promise<LicenceList> {
    const items = await this.prisma.client.orderItem.findMany({
      where: {
        order: {
          customerId,
          status: {
            in: [
              OrderStatus.PAID,
              OrderStatus.FULFILLING,
              OrderStatus.FULFILLED,
              OrderStatus.COMPLETED,
            ],
          },
        },
      },
      // Delivered first and newest first. OrderItem carries no timestamp of
      // its own, so the order's does the tie-breaking.
      orderBy: [{ deliveredAt: 'desc' }, { order: { placedAt: 'desc' } }],
      include: {
        order: { select: { number: true, placedAt: true, locale: true } },
        variant: {
          select: {
            credentialKind: true,
            warrantyDays: true,
            product: {
              select: {
                slug: true,
                translations: { select: { locale: true, activationSteps: true } },
              },
            },
          },
        },
      },
    });

    const ids = items.map((item) => item.id);
    const readable = await this.vault.hasReadableSecret(ids);
    const deadlines = await this.vault.deadlines(ids);

    const rows = items.map((item) => {
      const translations = item.variant.product.translations;
      const translation =
        translations.find((entry) => entry.locale === item.order.locale) ?? translations[0];

      return {
        orderItemId: item.id,
        orderNumber: item.order.number,
        productName: item.productNameSnapshot,
        productSlug: item.variant.product.slug,
        sku: item.skuSnapshot,
        qty: item.qty,
        deliveredAt: item.deliveredAt?.toISOString() ?? null,
        placedAt: item.order.placedAt.toISOString(),
        state: item.fulfillmentState,
        credentialKind: item.variant.credentialKind,
        activationSteps: parseActivationSteps(translation?.activationSteps),
        warrantyDays: item.variant.warrantyDays,
        hasSecret: readable.has(item.id),
        expiresAt: deadlines.get(item.id)?.toISOString() ?? null,
      };
    });

    return {
      rows,
      waiting: rows.filter(
        (row) => row.state !== FulfillmentState.DELIVERED && row.state !== FulfillmentState.FAILED,
      ).length,
    };
  }

  /**
   * Reads one line's licences for the customer who bought them.
   *
   * The ownership check is here and not in the vault, because the vault has no
   * visibility of orders — and it is a check, not a filter: a line that is not
   * this customer's gets the same answer as a line that does not exist.
   */
  async reveal(input: { orderItemId: string; actor: CustomerActor }): Promise<CustomerSecret[]> {
    const item = await this.ownedItem(input.orderItemId, input.actor.customerId);

    const secrets = await this.vault.revealForCustomer({
      orderItemId: item.id,
      actor: {
        staffId: input.actor.customerId,
        kind: ActorType.CUSTOMER,
        // No challenge to be fresh: this path is guarded by ownership, and
        // `revealForCustomer` asks for no TOTP. The field is part of the staff
        // actor shape and is deliberately meaningless here.
        totpAt: 0,
        ip: input.actor.ip,
        userAgent: input.actor.userAgent,
      },
    });

    return secrets.map((secret) => ({
      kind: secret.kind,
      key: secret.key,
      username: secret.username,
      password: secret.password,
    }));
  }

  /**
   * Sends the licence email again, to the address on the order.
   *
   * To that address and no other. A "send it to this email instead" field
   * would turn a session into a way to redirect somebody's licence, which is
   * the one thing this page must not become.
   */
  async resend(input: { orderItemId: string; actor: CustomerActor }): Promise<{ to: string }> {
    const item = await this.ownedItem(input.orderItemId, input.actor.customerId);
    if (item.fulfillmentState !== FulfillmentState.DELIVERED) {
      throw new BadRequestException('لم يُسلَّم هذا البند بعد، فلا شيء لإعادة إرساله.');
    }

    return this.fulfillment.resendLicence({
      orderItemId: item.id,
      actor: {
        staffId: input.actor.customerId,
        kind: ActorType.CUSTOMER,
        totpAt: 0,
        ip: input.actor.ip,
        userAgent: input.actor.userAgent,
      },
    });
  }

  private async ownedItem(
    orderItemId: string,
    customerId: string,
  ): Promise<{ id: string; fulfillmentState: FulfillmentState }> {
    const item = await this.prisma.client.orderItem.findFirst({
      where: {
        id: orderItemId,
        order: {
          customerId,
          status: {
            in: [
              OrderStatus.PAID,
              OrderStatus.FULFILLING,
              OrderStatus.FULFILLED,
              OrderStatus.COMPLETED,
            ],
          },
        },
      },
      select: { id: true, fulfillmentState: true },
    });
    // Deliberately the same answer as a line that does not exist.
    if (!item) throw new NotFoundException('لا يوجد هذا البند في طلباتك.');
    return item;
  }
}
