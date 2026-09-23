import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  MARKETING_FEATURES,
  MARKETING_SCHEMAS,
  type MarketingFeature,
  type MarketingSettings,
  type PublicMarketing,
  marketingSettingKey,
} from '@da/contracts';
import type { Prisma } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Every marketing feature's configuration, in the `Setting` table.
 *
 * One row per feature (`marketing.renewals`, `marketing.offers`, …), each
 * validated against its schema in `@da/contracts` on the way in and on the way
 * out. A row that no longer parses — an older shape, a hand edit — reads as
 * the feature's defaults, which are all "off", and says so in the log: a
 * marketing feature half-configured is worse than one not running.
 *
 * Read on hot paths (every cart render reads `offers`), so values are cached in
 * memory for a short while. A write clears the cache on this replica; others
 * see it within the TTL.
 */
const CACHE_MS = 30_000;

@Injectable()
export class MarketingSettingsService {
  private readonly logger = new Logger(MarketingSettingsService.name);
  private readonly cache = new Map<MarketingFeature, { at: number; value: unknown }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<F extends MarketingFeature>(feature: F): Promise<MarketingSettings[F]> {
    const hit = this.cache.get(feature);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as MarketingSettings[F];

    const schema = MARKETING_SCHEMAS[feature];
    const row = await this.prisma.client.setting.findUnique({
      where: { key: marketingSettingKey(feature) },
    });
    let value: unknown = schema.parse({});
    if (row) {
      const parsed = schema.safeParse(row.value);
      if (parsed.success) value = parsed.data;
      else
        this.logger.error(
          `Setting ${marketingSettingKey(feature)} does not parse; using defaults (off).`,
        );
    }
    this.cache.set(feature, { at: Date.now(), value });
    return value as MarketingSettings[F];
  }

  async all(): Promise<MarketingSettings> {
    const entries = await Promise.all(
      MARKETING_FEATURES.map(async (feature) => [feature, await this.get(feature)] as const),
    );
    return Object.fromEntries(entries) as MarketingSettings;
  }

  /** Replaces one feature's document, and records who changed what. */
  async set<F extends MarketingFeature>(
    feature: F,
    input: unknown,
    actor: { staffId: string; ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<MarketingSettings[F]> {
    const parsed = MARKETING_SCHEMAS[feature].safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        message: `Invalid ${feature} settings.`,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const value = parsed.data as MarketingSettings[F];
    const before = await this.get(feature);
    const key = marketingSettingKey(feature);

    await this.prisma.client.setting.upsert({
      where: { key },
      update: { value: value as Prisma.InputJsonValue },
      create: { key, value: value as Prisma.InputJsonValue },
    });
    this.cache.delete(feature);

    await this.audit.record({
      actorId: actor.staffId,
      entity: 'Setting',
      entityId: key,
      action: 'marketing.settings-changed',
      before: before as Prisma.InputJsonValue,
      after: value as Prisma.InputJsonValue,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return value;
  }

  /** The display parts the storefront reads, with disabled features as null. */
  async publicView(now: Date = new Date()): Promise<PublicMarketing> {
    const [trust, offers, socialProof, welcome, business, referral, seasonal] = await Promise.all([
      this.get('trust'),
      this.get('offers'),
      this.get('socialProof'),
      this.get('welcome'),
      this.get('business'),
      this.get('referral'),
      this.get('seasonal'),
    ]);

    return {
      trust: trust.enabled
        ? {
            enabled: true,
            guarantee: trust.guarantee,
            instantDeliveryText: trust.instantDeliveryText,
            commercialRegistration: trust.commercialRegistration,
            vatNumber: trust.vatNumber,
            maroofUrl: trust.maroofUrl,
            showOnProduct: trust.showOnProduct,
            showOnCheckout: trust.showOnCheckout,
          }
        : null,
      offers: offers.enabled
        ? {
            volumeTiers: offers.volumeTiers,
            volumeLicenceNumber: offers.volumeLicenceNumber,
            showAfterAddToCart: offers.showAfterAddToCart,
            showInCart: offers.showInCart,
            showOnConfirmation: offers.showOnConfirmation,
            showProgressBar: offers.showProgressBar,
          }
        : null,
      socialProof: socialProof.enabled
        ? {
            intervalSeconds: socialProof.intervalSeconds,
            maxPerPage: socialProof.maxPerPage,
            showCountry: socialProof.showCountry,
          }
        : null,
      welcome: welcome.enabled
        ? {
            trigger: welcome.trigger,
            delaySeconds: welcome.delaySeconds,
            frequencyDays: welcome.frequencyDays,
            headline: welcome.headline,
            discountPercent: welcome.discountPercent,
          }
        : null,
      business: business.enabled ? { minSeats: business.minSeats } : null,
      referral: referral.enabled ? { friendPercent: referral.friendPercent } : null,
      activeSales: seasonal.enabled
        ? seasonal.sales
            .filter((sale) => new Date(sale.startsAt) <= now && new Date(sale.endsAt) > now)
            .map((sale) => ({
              id: sale.id,
              name: sale.name,
              endsAt: sale.endsAt,
              percent: sale.percent,
              productIds: sale.productIds,
              categoryIds: sale.categoryIds,
              licenceNumber: sale.licenceNumber,
              showCountdown: sale.showCountdown,
            }))
        : [],
    };
  }
}
