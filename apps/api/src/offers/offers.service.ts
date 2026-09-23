import { Injectable, NotFoundException } from '@nestjs/common';

import {
  type CartQuery,
  type OfferCatalogOptions,
  type OfferStatGroup,
  type OfferStats,
  type OfferSuggestionContext,
  type OfferSuggestions,
  type OrderSuggestions,
  type SalePreview,
  type SalePreviewInput,
  catalogQuerySchema,
  orderOfferSnapshotSchema,
} from '@da/contracts';
import { Locale, OrderStatus, Prisma, PublishStatus } from '@da/db';

import { CatalogService } from '../catalog/catalog.service.js';
import { CheckoutService } from '../checkout/checkout.service.js';
import { orderAccessKey } from '../common/order-link.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { saleCovers } from './offer-rules.js';
import { SalesService } from './sales.service.js';

/** At most this many suggestions at once: a row, not a second catalogue. */
const MAX_SUGGESTIONS = 4;

/** Paid and not undone: the orders an average order value is honest over. */
const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.FULFILLING,
  OrderStatus.FULFILLED,
  OrderStatus.COMPLETED,
  OrderStatus.PARTIALLY_REFUNDED,
];

const STATS_DAYS = 30;

/**
 * "Goes well with" suggestions, and the panel's offer figures.
 *
 * Suggestions come from the curated pairs only. There is no fallback to
 * "same category": on a licence store the rest of a shelf is substitutes —
 * another antivirus beside the antivirus just added — and offering a
 * substitute a second after somebody chose is noise, or a nudge to buy two of
 * the same thing. The product page already shows its shelf as "related".
 * No pairs configured means no suggestions, which is the honest answer.
 */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MarketingSettingsService,
    private readonly catalog: CatalogService,
    private readonly checkout: CheckoutService,
    private readonly sales: SalesService,
  ) {}

  async suggestions(
    slugs: string[],
    context: OfferSuggestionContext,
    query: CartQuery,
  ): Promise<OfferSuggestions> {
    const offers = await this.settings.get('offers');
    const empty: OfferSuggestions = { items: [], licenceNumber: offers.volumeLicenceNumber };
    const shown =
      context === 'added'
        ? offers.showAfterAddToCart
        : context === 'cart'
          ? offers.showInCart
          : offers.showOnConfirmation;
    if (!offers.enabled || !shown || slugs.length === 0 || offers.pairs.length === 0) return empty;

    const locale = query.locale === 'en' ? Locale.EN : Locale.AR;
    const anchors = await this.prisma.client.product.findMany({
      where: { slug: { in: slugs } },
      select: {
        id: true,
        slug: true,
        translations: { where: { locale }, select: { name: true } },
      },
    });
    // In the order asked for: the product just added, or the cart's first line, leads.
    anchors.sort((a, b) => slugs.indexOf(a.slug) - slugs.indexOf(b.slug));

    // Never suggest what is already there.
    const taken = new Set(anchors.map((anchor) => anchor.id));
    const picks: {
      productId: string;
      forProduct: { slug: string; name: string };
      pairPercent: number;
    }[] = [];
    for (const anchor of anchors) {
      const forProduct = { slug: anchor.slug, name: anchor.translations[0]?.name ?? anchor.slug };
      for (const pair of offers.pairs) {
        if (pair.productId !== anchor.id) continue;
        for (const productId of pair.suggestProductIds) {
          if (taken.has(productId)) continue;
          taken.add(productId);
          picks.push({ productId, forProduct, pairPercent: pair.discountPercent });
        }
      }
    }
    if (picks.length === 0) return empty;

    // Through the catalog's own cards: published only, the sale price
    // applied, the same stock line — a suggestion and the grid cannot
    // disagree about what something costs.
    const cards = await this.catalog.cardsForProducts(
      picks.map((pick) => pick.productId),
      catalogQuerySchema.parse({ locale: query.locale, currency: query.currency }),
    );

    const items = picks
      .flatMap((pick) => {
        const card = cards.get(pick.productId);
        // Never offer something that cannot be bought right now.
        return card && card.inStock
          ? [{ card, forProduct: pick.forProduct, pairPercent: pick.pairPercent }]
          : [];
      })
      .slice(0, MAX_SUGGESTIONS);

    return { items, licenceNumber: offers.volumeLicenceNumber };
  }

  /**
   * "Complete your setup", for the owner of a paid order.
   *
   * Nothing is charged from here. The suggestions add to a new cart — the
   * paid one is closed — and that cart is paid the ordinary way. The access
   * key comes along so the order page can keep opening once the new cart's
   * cookie replaces the one that proved ownership.
   */
  async forOrder(
    number: string,
    query: CartQuery,
    access: {
      cartToken?: string | undefined;
      customerId?: string | undefined;
      skipOwnerCheck?: boolean;
    },
  ): Promise<OrderSuggestions> {
    // Throws the same 404 as a missing order when the caller does not own it.
    const order = await this.checkout.renderOrder(number, query, access);
    if (
      order.status === 'PENDING_PAYMENT' ||
      order.status === 'CANCELLED' ||
      order.status === 'FAILED'
    ) {
      // Before payment the order page is about paying; suggesting more there
      // would compete with the one thing it has to get done.
      throw new NotFoundException(`لا توجد اقتراحات للطلب ${number}`);
    }
    const slugs = [
      ...new Set(
        order.lines.map((line) => line.productSlug).filter((slug): slug is string => !!slug),
      ),
    ];
    const suggestions = await this.suggestions(slugs, 'confirmation', query);
    return { ...suggestions, accessKey: orderAccessKey(number) };
  }

  // --- panel ----------------------------------------------------------------

  async catalogOptions(): Promise<OfferCatalogOptions> {
    const [products, categories] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { status: { not: PublishStatus.ARCHIVED } },
        orderBy: { slug: 'asc' },
        select: {
          id: true,
          slug: true,
          status: true,
          translations: { select: { locale: true, name: true } },
          categories: { select: { categoryId: true } },
        },
      }),
      this.prisma.client.category.findMany({
        orderBy: [{ parentId: 'asc' }, { position: 'asc' }],
        select: {
          id: true,
          slug: true,
          parentId: true,
          translations: { select: { locale: true, name: true } },
        },
      }),
    ]);

    const nameIn = (rows: { locale: Locale; name: string }[], locale: Locale) =>
      rows.find((row) => row.locale === locale)?.name ?? null;

    return {
      products: products.map((product) => ({
        id: product.id,
        slug: product.slug,
        nameAr: nameIn(product.translations, Locale.AR) ?? product.slug,
        nameEn: nameIn(product.translations, Locale.EN),
        status: product.status,
        categoryIds: product.categories.map((link) => link.categoryId),
      })),
      categories: categories.map((category) => ({
        id: category.id,
        slug: category.slug,
        nameAr: nameIn(category.translations, Locale.AR) ?? category.slug,
        nameEn: nameIn(category.translations, Locale.EN),
        parentId: category.parentId,
      })),
      timeZone: process.env.STORE_TIMEZONE ?? 'Asia/Riyadh',
    };
  }

  /** How many published products a sale scope would price — the same matcher the storefront uses. */
  async salePreview(input: SalePreviewInput): Promise<SalePreview> {
    const [scope, products] = await Promise.all([
      this.sales.scopeOf(input),
      this.prisma.client.product.findMany({
        where: { status: PublishStatus.PUBLISHED },
        select: { id: true, categories: { select: { categoryId: true } } },
      }),
    ]);
    const covered = products.filter((product) =>
      saleCovers(scope, {
        id: product.id,
        categoryIds: product.categories.map((link) => link.categoryId),
      }),
    );
    return { products: covered.length, of: products.length };
  }

  /**
   * Paid orders in the last 30 days, by the offer they used, with their
   * average order value against the orders that used none.
   *
   * Read from the snapshot written when each order was drafted, not worked
   * out again from today's settings — a pair removed last week still counts
   * for the orders that had it.
   */
  async stats(now: Date = new Date()): Promise<OfferStats> {
    const since = new Date(now.getTime() - STATS_DAYS * 24 * 3600 * 1000);
    const orders = await this.prisma.client.order.findMany({
      where: { status: { in: PAID_STATUSES }, paidAt: { gte: since } },
      select: { totalUsd: true, offerSnapshot: true },
    });

    const groups = {
      volume: [] as Prisma.Decimal[],
      pair: [] as Prisma.Decimal[],
      sale: [] as Prisma.Decimal[],
      others: [] as Prisma.Decimal[],
    };
    let untracked = 0;
    for (const order of orders) {
      const parsed = orderOfferSnapshotSchema.safeParse(order.offerSnapshot);
      if (!parsed.success) {
        untracked += 1;
        continue;
      }
      const snapshot = parsed.data;
      const volume = snapshot.discount === 'volume';
      const pair = snapshot.discount === 'pair' || snapshot.pairMatched;
      const sale = snapshot.saleIds.length > 0;
      if (volume) groups.volume.push(order.totalUsd);
      if (pair) groups.pair.push(order.totalUsd);
      if (sale) groups.sale.push(order.totalUsd);
      if (!volume && !pair && !sale) groups.others.push(order.totalUsd);
    }

    const summarise = (totals: Prisma.Decimal[]): OfferStatGroup => {
      const revenue = totals.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
      return {
        orders: totals.length,
        revenueUsd: revenue.toFixed(2),
        averageUsd: totals.length > 0 ? revenue.dividedBy(totals.length).toFixed(2) : null,
      };
    };

    return {
      since: since.toISOString(),
      days: STATS_DAYS,
      volume: summarise(groups.volume),
      pair: summarise(groups.pair),
      sale: summarise(groups.sale),
      others: summarise(groups.others),
      untracked,
    };
  }
}
