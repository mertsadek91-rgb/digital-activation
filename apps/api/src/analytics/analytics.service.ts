import { Injectable } from '@nestjs/common';
import type { AnalyticsSummary, RecordAnalyticsEvent } from '@da/contracts';

import { PrismaService } from '../prisma/prisma.service.js';

import { isBot, referrerHost, visitorId } from './pii.js';

/** Who the event is about, as the request carried it. Used, then dropped. */
export interface VisitorContext {
  ip?: string;
  userAgent?: string;
}

const SUMMARY_DAYS = 30;

/**
 * First-party analytics: writes browsing events and reads them back as counts.
 *
 * The row is built here and nowhere else, so this is the one place that
 * decides what is kept: a referrer host, a hashed visitor, a path, ids. The
 * address and user agent are used to compute the hash and not stored.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** False when the event was not recorded (a bot, a link previewer). */
  async record(
    event: RecordAnalyticsEvent,
    visitor: VisitorContext,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (isBot(visitor.userAgent)) return false;

    const client = this.prisma.client;
    const [product, category] = await Promise.all([
      event.productSlug
        ? client.product.findUnique({ where: { slug: event.productSlug }, select: { id: true } })
        : null,
      event.categorySlug
        ? client.category.findUnique({ where: { slug: event.categorySlug }, select: { id: true } })
        : null,
    ]);

    await client.analyticsEvent.create({
      data: {
        type: event.type,
        path: event.path,
        productId: product?.id ?? null,
        categoryId: category?.id ?? null,
        placement: event.type === 'WHATSAPP_CLICK' ? (event.placement ?? null) : null,
        locale: event.locale === 'en' ? 'EN' : 'AR',
        referrerHost: referrerHost(event.referrer),
        utmSource: event.utmSource ?? null,
        utmMedium: event.utmMedium ?? null,
        utmCampaign: event.utmCampaign ?? null,
        visitorId: visitorId(visitor.ip, visitor.userAgent, now),
        createdAt: now,
      },
    });
    return true;
  }

  /** Events and distinct daily visitors per type and UTC day, last 30 days. */
  async summary(now: Date = new Date()): Promise<AnalyticsSummary> {
    // `createdAt` is a UTC timestamp without zone, so its date is the UTC day.
    const since = new Date(now.getTime() - SUMMARY_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.client.$queryRaw<
      {
        day: string;
        type: AnalyticsSummary['days'][number]['type'];
        events: number;
        visitors: number;
      }[]
    >`
      SELECT to_char("createdAt", 'YYYY-MM-DD') AS day,
             "type"::text AS type,
             count(*)::int AS events,
             count(DISTINCT "visitorId")::int AS visitors
        FROM "public"."AnalyticsEvent"
       WHERE "createdAt" >= ${since}
       GROUP BY 1, 2
       ORDER BY 1, 2`;
    return {
      since: since.toISOString(),
      days: rows.map((row) => ({
        day: row.day,
        type: row.type,
        events: Number(row.events),
        visitors: Number(row.visitors),
      })),
    };
  }
}
