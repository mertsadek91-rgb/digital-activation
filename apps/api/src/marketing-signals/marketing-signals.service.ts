import { Injectable } from '@nestjs/common';

import type { ReviewRequestStats, SocialProof, SocialProofPreview } from '@da/contracts';
import { PublishStatus } from '@da/db';

import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import {
  PAID_STATUSES,
  aggregateSocialProof,
  emptyProof,
  previewSocialProof,
} from './social-proof.js';

/**
 * Five minutes. A product page is fetched by every visitor and the answer
 * moves by one order at a time; nobody is misled by a count that is a few
 * minutes old, and the orders table is not asked the same question per view.
 */
const CACHE_MS = 5 * 60_000;

/**
 * The slug comes from the browser, so the cache is bounded: a script walking
 * made-up slugs must not grow this map without limit.
 */
const CACHE_MAX = 1_000;

/**
 * Upper bound on orders read for one product. A lower bound on a count is
 * still true ("at least"); an inflated one would not be, so truncating is the
 * safe direction. No product here comes near it inside a 30-day window.
 */
const MAX_ROWS = 5_000;

const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class MarketingSignalsService {
  private readonly cache = new Map<string, { at: number; value: SocialProof }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MarketingSettingsService,
  ) {}

  /** What a product page may say about its recent paid orders. */
  async socialProof(slug: string, now: Date = new Date()): Promise<SocialProof> {
    const settings = await this.settings.get('socialProof');
    if (!settings.enabled) return emptyProof(settings.windowHours);

    // The settings are part of the key, so a change on the panel shows on the
    // next request rather than after the cache runs out.
    const key = [
      slug,
      settings.windowHours,
      settings.minOrders,
      settings.showCountry,
      settings.intervalSeconds,
      settings.maxPerPage,
    ].join('|');
    const hit = this.cache.get(key);
    if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value;

    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: { id: true, status: true },
    });

    let value = emptyProof(settings.windowHours);
    // A draft has no public page to show a notice on, and no business being
    // described from the outside.
    if (product && product.status === PublishStatus.PUBLISHED) {
      const rows = await this.prisma.client.order.findMany({
        where: {
          status: { in: PAID_STATUSES },
          paidAt: { gte: new Date(now.getTime() - settings.windowHours * HOUR_MS) },
          items: { some: { variant: { productId: product.id } } },
        },
        // Two columns and nothing else. Name, email, city and number never
        // leave the database for this feature, so they cannot leak from it.
        select: { paidAt: true, billingCountry: true },
        orderBy: { paidAt: 'desc' },
        take: MAX_ROWS,
      });
      value = aggregateSocialProof(
        rows.flatMap((row) =>
          row.paidAt ? [{ paidAt: row.paidAt, billingCountry: row.billingCountry }] : [],
        ),
        settings,
        now,
      );
    }

    if (this.cache.size >= CACHE_MAX) {
      // Oldest insertion first; Map keeps insertion order.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: now.getTime(), value });
    return value;
  }

  /** Every product with paid orders in the window, and whether it clears the floor. */
  async socialProofPreview(now: Date = new Date()): Promise<SocialProofPreview> {
    const settings = await this.settings.get('socialProof');
    const lines = await this.prisma.client.orderItem.findMany({
      where: {
        order: {
          status: { in: PAID_STATUSES },
          paidAt: { gte: new Date(now.getTime() - settings.windowHours * HOUR_MS) },
        },
      },
      select: {
        orderId: true,
        productNameSnapshot: true,
        variant: { select: { product: { select: { id: true, slug: true } } } },
      },
      take: 50_000,
    });

    return previewSocialProof(
      lines.map((line) => ({
        orderId: line.orderId,
        productId: line.variant.product.id,
        slug: line.variant.product.slug,
        name: line.productNameSnapshot,
      })),
      settings,
    );
  }

  /** Review invitations sent in the last `days`, by stage, and how many were answered. */
  async reviewRequestStats(days = 30, now: Date = new Date()): Promise<ReviewRequestStats> {
    const since = new Date(now.getTime() - days * 24 * HOUR_MS);
    const [byStage, responded] = await Promise.all([
      this.prisma.client.reviewInvite.groupBy({
        by: ['stage'],
        where: { sentAt: { gte: since } },
        _count: { _all: true },
        orderBy: { stage: 'asc' },
      }),
      this.prisma.client.reviewInvite.count({
        where: { sentAt: { gte: since }, respondedAt: { not: null } },
      }),
    ]);

    const stages = byStage.map((row) => ({ stage: row.stage, sent: row._count._all }));
    return {
      days,
      sent: stages.reduce((sum, row) => sum + row.sent, 0),
      byStage: stages,
      responded,
    };
  }
}
