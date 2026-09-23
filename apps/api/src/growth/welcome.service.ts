import crypto from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { type WelcomeStats, promotionRulesSchema } from '@da/contracts';
import { Prisma, PromotionType } from '@da/db';

import type { Rendered } from '../mail/templates.js';
import { MailService } from '../mail/mail.service.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { WELCOME_CODE_PREFIX, randomCode, welcomeCodeDecision } from './rules.js';
import { codeEmail, welcomeConfirm } from './templates.js';

/** Serialises two clicks on the same confirmation link, per address. */
const MINT_LOCK = 761_205_102;
const STATS_DAYS = 90;

/**
 * The welcome window's side of the newsletter.
 *
 * The window posts to the ordinary newsletter subscribe with `source:
 * 'welcome'`, so consent works exactly as it does from the footer: nothing is
 * recorded and nothing is sent but the confirmation until its link is
 * followed (PDPL wants the yes to be the person's, not the form's). The code,
 * when there is one, is minted here, after that click — never at capture —
 * single-use, issued to that customer, first order only, and expiring after
 * `discountValidDays`.
 */
@Injectable()
export class WelcomeService {
  private readonly logger = new Logger(WelcomeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly settings: MarketingSettingsService,
  ) {}

  private get storefront(): string {
    return process.env.STOREFRONT_URL ?? 'http://localhost:3000';
  }

  /** The confirmation, which says whether a code follows the click. */
  async confirmation(locale: 'ar' | 'en', confirmUrl: string): Promise<Rendered> {
    const settings = await this.settings.get('welcome');
    return welcomeConfirm({
      locale,
      confirmUrl,
      discountPercent: settings.enabled ? settings.discountPercent : 0,
    });
  }

  /** Called once the welcome confirmation link has been followed. */
  async onConfirmed(email: string, locale: 'ar' | 'en'): Promise<{ minted: boolean }> {
    const settings = await this.settings.get('welcome');
    const customer = await this.prisma.client.customer.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!customer) return { minted: false };

    const now = new Date();
    const minted = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MINT_LOCK}::int, hashtext(${email}))`;

      const [priorPaidOrders, alreadyIssued] = await Promise.all([
        tx.order.count({
          where: { paidAt: { not: null }, OR: [{ customerId: customer.id }, { email }] },
        }),
        tx.promotion.count({
          where: { issuedToId: customer.id, code: { startsWith: WELCOME_CODE_PREFIX } },
        }),
      ]);
      const decision = welcomeCodeDecision({
        enabled: settings.enabled,
        discountPercent: settings.discountPercent,
        discountValidDays: settings.discountValidDays,
        priorPaidOrders,
        alreadyIssued: alreadyIssued > 0,
        now,
      });
      if (!decision.mint) return null;

      const code = `${WELCOME_CODE_PREFIX}${randomCode(8, crypto.randomBytes)}`;
      await tx.promotion.create({
        data: {
          code,
          type: PromotionType.PERCENT,
          value: new Prisma.Decimal(settings.discountPercent),
          name: `Welcome code ${String(settings.discountPercent)}%`,
          description: settings.discountLicenceNumber
            ? `Discount licence ${settings.discountLicenceNumber}`
            : null,
          rules: promotionRulesSchema.parse({ firstOrderOnly: true }),
          endsAt: decision.expiresAt,
          usageLimit: 1,
          perCustomerLimit: 1,
          singleUse: true,
          issuedToId: customer.id,
        },
      });
      return { code, expiresAt: decision.expiresAt };
    });
    if (!minted) return { minted: false };

    const prefix = locale === 'en' ? '/en' : '';
    await this.mail.send({
      to: email,
      template: 'welcome.code',
      locale,
      kind: 'marketing',
      customerId: customer.id,
      rendered: codeEmail({
        locale,
        kind: 'welcome',
        code: minted.code,
        amount: `${String(settings.discountPercent)}%`,
        expiresAt: minted.expiresAt,
        licenceNumber: settings.discountLicenceNumber,
        storeUrl: `${this.storefront}${prefix}/store`,
      }),
      // The code is a discount, not a secret, but it is still not repeated
      // into a log row that many people read.
      payload: { percent: settings.discountPercent },
    });
    this.logger.log('Welcome code minted after confirmation.');
    return { minted: true };
  }

  /** Captures, confirmations and codes over the last 90 days, for the panel. */
  async stats(): Promise<WelcomeStats> {
    const since = new Date(Date.now() - STATS_DAYS * 86_400_000);
    const codeWhere = { code: { startsWith: WELCOME_CODE_PREFIX }, createdAt: { gte: since } };
    const [captures, confirmedRows, codesIssued, codesRedeemed] = await Promise.all([
      this.prisma.client.notificationLog.count({
        where: { template: 'welcome.confirm', sentAt: { gte: since } },
      }),
      // An address counts as confirmed once its customer row carries consent;
      // the confirmation itself writes nothing else.
      this.prisma.client.$queryRaw<{ count: bigint }[]>`
        select count(distinct n."toAddress") as count
        from "public"."NotificationLog" n
        join "public"."Customer" c on c."email" = n."toAddress"
        where n."template" = 'welcome.confirm'
          and n."sentAt" >= ${since}
          and c."marketingOptInAt" is not null`,
      this.prisma.client.promotion.count({ where: codeWhere }),
      this.prisma.client.promotion.count({ where: { ...codeWhere, usageCount: { gt: 0 } } }),
    ]);
    return {
      captures,
      confirmations: Number(confirmedRows[0]?.count ?? 0),
      codesIssued,
      codesRedeemed,
      sinceDays: STATS_DAYS,
    };
  }
}
