import { Injectable } from '@nestjs/common';

import type { CatalogQuery, ForYou, ForYouItem, ForYouReason, Renewal } from '@da/contracts';
import { FulfillmentState, Locale, PublishStatus } from '@da/db';

import { CatalogService } from '../catalog/catalog.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * What to suggest to somebody who has bought here before.
 *
 * The shop already had a cross-sell: it reads the cart, offers a bundle, and
 * knows nothing about the person holding it. This reads what they own.
 *
 * Two kinds of suggestion, and the split is the whole design.
 *
 * A renewal is arithmetic. A one-year licence delivered on a known date runs
 * out on a known date, and the customer needs another one whether or not
 * anybody says so. That is the most useful thing this shop can tell a returning
 * customer and the only one that is not a guess, so it is dated, separated, and
 * put first.
 *
 * Everything under it is inference — same brand, same section — and is labelled
 * with its reason. A shelf of products with no stated reason is an
 * advertisement; one that says "because you bought Adobe Acrobat" is a
 * suggestion somebody can disagree with.
 */

/** How far ahead a renewal is worth raising. */
const RENEWAL_HORIZON_DAYS = 60;

/** And how long after it lapses before it stops being news. */
const LAPSED_GRACE_DAYS = 180;

const MAX_SUGGESTIONS = 12;

@Injectable()
export class ForYouService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  async forYou(customerId: string, query: CatalogQuery): Promise<ForYou> {
    const locale = query.locale === 'en' ? Locale.EN : Locale.AR;

    // Delivered lines only. A line still in the queue is not something the
    // customer owns yet, and suggesting its renewal would be absurd.
    const lines = await this.prisma.client.orderItem.findMany({
      where: {
        order: { customerId },
        fulfillmentState: FulfillmentState.DELIVERED,
        deliveredAt: { not: null },
      },
      orderBy: { deliveredAt: 'desc' },
      include: {
        order: { select: { number: true } },
        variant: {
          include: {
            product: {
              include: {
                brand: { include: { translations: { where: { locale } } } },
                categories: {
                  include: { category: { include: { translations: { where: { locale } } } } },
                },
              },
            },
          },
        },
      },
    });

    if (lines.length === 0) {
      return { purchases: 0, renewals: [], suggestions: [] };
    }

    const ownedProductIds = new Set(
      lines.flatMap((line) => (line.variant ? [line.variant.productId] : [])),
    );

    return {
      purchases: lines.length,
      renewals: await this.renewals(lines, query),
      suggestions: await this.suggestions(lines, ownedProductIds, locale, query),
    };
  }

  /**
   * Licences running out, or already out.
   *
   * A lifetime licence never appears here, which is most of this catalog — and
   * that is the point: the ones that do appear are the handful that genuinely
   * expire, so the section stays short and true instead of listing everything
   * somebody ever bought.
   */
  private async renewals(
    lines: Awaited<ReturnType<ForYouService['linesQuery']>>,
    query: CatalogQuery,
  ): Promise<Renewal[]> {
    const now = Date.now();
    const found: { productId: string; renewal: Omit<Renewal, 'product'> }[] = [];
    const seen = new Set<string>();

    for (const line of lines) {
      const variant = line.variant;
      const deliveredAt = line.deliveredAt;
      if (!variant || !deliveredAt) continue;
      if (variant.licensePeriodUnit === 'LIFETIME' || variant.licensePeriodValue === null) continue;

      // The most recent purchase of a product wins: buying a second year in
      // March does not leave last March's expiry on the page.
      if (seen.has(variant.productId)) continue;
      seen.add(variant.productId);

      const expires = addTerm(deliveredAt, variant.licensePeriodUnit, variant.licensePeriodValue);
      const daysLeft = Math.round((expires.getTime() - now) / 86_400_000);
      if (daysLeft > RENEWAL_HORIZON_DAYS || daysLeft < -LAPSED_GRACE_DAYS) continue;

      found.push({
        productId: variant.productId,
        renewal: {
          orderNumber: line.order.number,
          startedAt: deliveredAt.toISOString(),
          expiresAt: expires.toISOString(),
          daysLeft,
          termLabel: `${String(variant.licensePeriodValue)} ${variant.licensePeriodUnit.toLowerCase()}`,
        },
      });
    }

    // Soonest first — including the ones already past, which are the most
    // urgent thing on the page.
    found.sort((a, b) => a.renewal.daysLeft - b.renewal.daysLeft);

    const cards = await this.catalog.cardsForProducts(
      found.map((entry) => entry.productId),
      query,
    );

    // A product unpublished since it was bought has no card. The renewal is
    // still true and there is nothing to link to, so it is dropped rather than
    // drawn as a dead tile.
    return found.flatMap((entry) => {
      const card = cards.get(entry.productId);
      return card ? [{ product: card, ...entry.renewal }] : [];
    });
  }

  /**
   * Products from the brands and sections this customer already buys.
   *
   * Brand first, because in this catalog it is the stronger signal: somebody
   * with Adobe Acrobat is far more likely to want Photoshop than to want the
   * other thing in "subscriptions". Anything already owned is excluded — a
   * lifetime licence is not bought twice.
   */
  private async suggestions(
    lines: Awaited<ReturnType<ForYouService['linesQuery']>>,
    ownedProductIds: Set<string>,
    locale: Locale,
    query: CatalogQuery,
  ): Promise<ForYouItem[]> {
    const brands = new Map<string, string>();
    const categories = new Map<string, string>();

    for (const line of lines) {
      const product = line.variant?.product;
      if (!product) continue;
      if (product.brand) {
        brands.set(product.brand.id, product.brand.translations[0]?.name ?? product.brand.name);
      }
      for (const link of product.categories) {
        categories.set(
          link.category.id,
          link.category.translations[0]?.name ?? link.category.slug,
        );
      }
    }

    const picked = new Map<string, { reason: ForYouReason; becauseOf: string }>();

    const take = async (
      where: Parameters<PrismaService['client']['product']['findMany']>[0],
      reason: ForYouReason,
      label: (productId: string) => string,
    ): Promise<void> => {
      if (picked.size >= MAX_SUGGESTIONS) return;
      const rows = await this.prisma.client.product.findMany({
        ...where,
        take: MAX_SUGGESTIONS,
        // Most sold first. With no personal signal to separate two products
        // from the same brand, what other customers bought is the honest
        // tiebreak rather than whichever row the planner returns.
        orderBy: { salesCount: 'desc' },
        select: { id: true },
      });
      for (const row of rows) {
        if (picked.size >= MAX_SUGGESTIONS) break;
        if (ownedProductIds.has(row.id) || picked.has(row.id)) continue;
        picked.set(row.id, { reason, becauseOf: label(row.id) });
      }
    };

    if (brands.size > 0) {
      for (const [brandId, brandName] of brands) {
        await take(
          {
            where: {
              status: PublishStatus.PUBLISHED,
              brandId,
              id: { notIn: [...ownedProductIds] },
            },
          },
          'sameBrand',
          () => brandName,
        );
      }
    }

    if (categories.size > 0) {
      for (const [categoryId, categoryName] of categories) {
        await take(
          {
            where: {
              status: PublishStatus.PUBLISHED,
              categories: { some: { categoryId } },
              id: { notIn: [...ownedProductIds] },
            },
          },
          'sameCategory',
          () => categoryName,
        );
      }
    }

    const ids = [...picked.keys()];
    const cards = await this.catalog.cardsForProducts(ids, query);

    return ids.flatMap((id) => {
      const card = cards.get(id);
      const meta = picked.get(id);
      return card && meta
        ? [{ product: card, reason: meta.reason, becauseOf: meta.becauseOf }]
        : [];
    });
  }

  /** Only here to give the two private methods above a type for their input. */
  private linesQuery() {
    return this.prisma.client.orderItem.findMany({
      include: {
        order: { select: { number: true } },
        variant: {
          include: {
            product: {
              include: {
                brand: { include: { translations: true } },
                categories: { include: { category: { include: { translations: true } } } },
              },
            },
          },
        },
      },
    });
  }
}

/**
 * The end of a licence term.
 *
 * Calendar arithmetic, not 365 days: a year from 29 February lands on 28
 * February, and `setMonth` handles that the way a person expects. A customer
 * told their licence ends on the wrong day by one is a customer who writes in.
 */
function addTerm(from: Date, unit: 'DAY' | 'MONTH' | 'YEAR' | 'LIFETIME', value: number): Date {
  const end = new Date(from);
  if (unit === 'DAY') end.setDate(end.getDate() + value);
  else if (unit === 'MONTH') end.setMonth(end.getMonth() + value);
  else if (unit === 'YEAR') end.setFullYear(end.getFullYear() + value);
  return end;
}
