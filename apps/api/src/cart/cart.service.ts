import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import crypto from 'node:crypto';

import {
  type AddToCart,
  type Cart,
  type CartLine,
  type CartQuery,
  type OrderOfferSnapshot,
  type PromotionRules,
  MAX_LINE_QTY,
  promotionRulesSchema,
  RESERVATION_TTL_MINUTES,
} from '@da/contracts';
import {
  CartStage,
  FulfillmentMode,
  Locale,
  Prisma,
  PromotionType,
  PublishStatus,
  StockReservationState,
} from '@da/db';

import { convert, displayPrice, type FxTable } from '../catalog/pricing.js';
import { couponRefusal } from '../common/coupon-eligibility.js';
import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import {
  bestDiscount,
  nextTier,
  pairDiscount,
  tierFor,
  volumeDiscountUsd,
} from '../offers/offer-rules.js';
import { SalesService, saleBadge, saleFor, salePriced } from '../offers/sales.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { hold, releaseAll, renew } from './reservations.js';

/** What a cart row plus everything needed to render it looks like. */
const CART_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      variant: {
        include: {
          inventory: true,
          product: {
            include: {
              translations: true,
              // For matching seasonal sales scoped by category.
              categories: { select: { categoryId: true } },
              media: {
                where: { isHero: true },
                take: 1,
                include: { asset: { include: { alts: true } } },
              },
            },
          },
        },
      },
    },
  },
  reservations: { where: { state: StockReservationState.ACTIVE } },
} satisfies Prisma.CartInclude;

type CartRow = Prisma.CartGetPayload<{ include: typeof CART_INCLUDE }>;

/**
 * The cart.
 *
 * Server-side and durable, which is the point: the legacy store kept the cart
 * in the browser, so an abandoned one left nothing behind and could not be
 * recovered. Every cart here has a row from the first item added, and gains an
 * email at checkout — and it is the presence of that email that promotes it
 * from anonymous to recoverable.
 *
 * Money is USD throughout and converted once at the edge, for the same reason
 * the catalog does it: the legacy product page printed an AED figure and
 * labelled it USD in its structured data.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly marketing: MarketingSettingsService,
  ) {}

  private localeFor(query: CartQuery): Locale {
    return query.locale === 'en' ? Locale.EN : Locale.AR;
  }

  private async fxTable(): Promise<FxTable> {
    const currencies = await this.prisma.client.currency.findMany({
      where: { isActive: true },
      include: { rates: { orderBy: { fetchedAt: 'desc' }, take: 1 } },
    });
    const table: FxTable = {};
    for (const currency of currencies) {
      const latest = currency.rates[0];
      if (!latest) continue;
      table[currency.code] = {
        rate: latest.rate,
        decimals: currency.decimals,
        roundingRule: currency.roundingRule,
      };
    }
    return table;
  }

  /** 32 bytes of randomness. The token is the only thing guarding the cart. */
  private newToken(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  // --- reading --------------------------------------------------------------

  /**
   * Loads a cart by token, or makes one.
   *
   * A missing or unknown token gets a fresh cart rather than a 404: the token
   * lives in a cookie, and a cleared cookie is a normal thing that happens to
   * shoppers, not an error to show them.
   */
  async resolve(token: string | undefined, query: CartQuery): Promise<CartRow> {
    if (token) {
      const existing = await this.prisma.client.cart.findUnique({
        where: { token },
        include: CART_INCLUDE,
      });
      if (existing && existing.stage !== CartStage.CLOSED) return existing;
    }

    return this.prisma.client.cart.create({
      data: {
        token: this.newToken(),
        locale: this.localeFor(query),
        currency: query.currency,
      },
      include: CART_INCLUDE,
    });
  }

  // --- writing --------------------------------------------------------------

  async add(token: string | undefined, input: AddToCart, query: CartQuery): Promise<Cart> {
    const cart = await this.resolve(token, query);

    const variant = await this.prisma.client.variant.findUnique({
      where: { id: input.variantId },
      include: { product: { include: { categories: { select: { categoryId: true } } } } },
    });
    if (!variant) throw new NotFoundException('لا يوجد هذا المتغيّر.');

    // A draft is reachable in preview, but it must not be sellable. Preview is
    // for looking at work in progress, not for buying it.
    if (
      variant.status !== PublishStatus.PUBLISHED ||
      variant.product.status !== PublishStatus.PUBLISHED
    ) {
      throw new BadRequestException('هذا المنتج غير متاح للشراء حالياً.');
    }

    const existing = cart.items.find((item) => item.variantId === input.variantId);
    const wanted = (existing?.qty ?? 0) + input.qty;

    // The shelf price, sale included, is what the line is added at. A line
    // already in the cart keeps its own price here; `render` reconciles it
    // with any sale that has started or ended since.
    const sale = saleFor(await this.sales.live(), {
      id: variant.productId,
      categoryIds: variant.product.categories.map((link) => link.categoryId),
    });
    const shelf = salePriced(variant, sale);

    const granted = await this.prisma.client.$transaction(async (tx) => {
      const result = await hold(tx, {
        variantId: input.variantId,
        cartId: cart.id,
        qty: wanted,
        ttlMinutes: RESERVATION_TTL_MINUTES,
      });

      if (result.granted === 0) {
        throw new BadRequestException('نفدت الكمية من هذا المتغيّر.');
      }

      if (existing) {
        await tx.cartItem.update({
          where: { id: existing.id },
          data: { qty: result.granted },
        });
      } else {
        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            variantId: input.variantId,
            qty: result.granted,
            // Snapshot, so a repricing mid-session cannot move the total under
            // somebody who is already deciding.
            unitPriceUsd: shelf.priceUsd,
            fromCrossSell: input.fromCrossSell,
            // Except a sale price, which was advertised with an end date.
            saleId: sale?.id ?? null,
            saleEndsAt: sale?.endsAt ?? null,
          },
        });
      }

      await renew(tx, cart.id, RESERVATION_TTL_MINUTES);
      await tx.cart.update({
        where: { id: cart.id },
        data: { lastActivityAt: new Date() },
      });

      return result.granted;
    });

    // Say so when less was granted than asked for. Adding two and getting one
    // without being told is how a shopper ends up surprised at checkout.
    const adjustments: Cart['adjustments'] =
      granted < wanted ? [{ sku: variant.sku, requestedQty: wanted, grantedQty: granted }] : [];

    await this.applyEarnedBundle(cart.id);

    return this.render(cart.token, query, adjustments);
  }

  /**
   * Attaches a bundle the cart has just completed, when no coupon is on it.
   *
   * The checkout offers "add this and save N%" from BUNDLE_DISCOUNT promotions
   * and shows the bundle price — and then charged full price, because the
   * discount only applied if the shopper also typed the promotion's code,
   * which the offer never showed them. Completing the bundle is now enough:
   * whichever way the last item arrived, the cart takes the best bundle it
   * qualifies for.
   *
   * A coupon the shopper chose is never replaced; one discount per cart is
   * the rule everywhere else, and swapping theirs for ours would be a
   * surprise even when ours is larger.
   */
  private async applyEarnedBundle(cartId: string): Promise<void> {
    const cart = await this.prisma.client.cart.findUnique({
      where: { id: cartId },
      include: { items: true },
    });
    if (!cart || cart.couponCode || cart.items.length < 2) return;

    const variantIds = cart.items.map((item) => item.variantId);
    const subtotalUsd = cart.items.reduce(
      (total, item) => total.plus(item.unitPriceUsd.times(item.qty)),
      new Prisma.Decimal(0),
    );

    const bundles = await this.prisma.client.promotion.findMany({
      where: { type: PromotionType.BUNDLE_DISCOUNT, isActive: true, code: { not: null } },
      orderBy: { value: 'desc' },
    });

    const earned = bundles.find((bundle) => {
      const rules = this.rulesOf(bundle.rules);
      const required = rules.requiresAllVariantIds ?? [];
      return (
        required.length >= 2 && couponRefusal(bundle, rules, { subtotalUsd, variantIds }) === null
      );
    });
    if (!earned?.code) return;

    await this.prisma.client.cart.updateMany({
      where: { id: cart.id, couponCode: null },
      data: { couponCode: earned.code },
    });
  }

  async setQty(token: string, variantId: string, qty: number, query: CartQuery): Promise<Cart> {
    const cart = await this.resolve(token, query);
    const line = cart.items.find((item) => item.variantId === variantId);
    if (!line) throw new NotFoundException('هذا السطر غير موجود في السلة.');

    const granted = await this.prisma.client.$transaction(async (tx) => {
      const result = await hold(tx, {
        variantId,
        cartId: cart.id,
        qty,
        ttlMinutes: RESERVATION_TTL_MINUTES,
      });

      if (result.granted === 0) {
        await tx.cartItem.delete({ where: { id: line.id } });
      } else {
        await tx.cartItem.update({ where: { id: line.id }, data: { qty: result.granted } });
      }

      await renew(tx, cart.id, RESERVATION_TTL_MINUTES);
      await tx.cart.update({ where: { id: cart.id }, data: { lastActivityAt: new Date() } });

      return result.granted;
    });

    // The sku comes off the line loaded before the transaction, which may have
    // deleted it. A quantity of zero is a removal, not a shortfall.
    const adjustments: Cart['adjustments'] =
      qty > 0 && granted < qty
        ? [{ sku: line.variant.sku, requestedQty: qty, grantedQty: granted }]
        : [];

    return this.render(cart.token, query, adjustments);
  }

  async clear(token: string, query: CartQuery): Promise<Cart> {
    const cart = await this.resolve(token, query);
    await this.prisma.client.$transaction(async (tx) => {
      await releaseAll(tx, cart.id);
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.cart.update({
        where: { id: cart.id },
        data: { couponCode: null, lastActivityAt: new Date() },
      });
    });
    return this.render(cart.token, query, []);
  }

  // --- coupons --------------------------------------------------------------

  /**
   * Applies a code, or says why not.
   *
   * A refused coupon returns a rendered cart carrying `couponError` rather than
   * throwing. The shopper mistyping a code is not an exceptional condition, and
   * a 400 would lose the cart body the page still needs to draw.
   */
  async applyCoupon(token: string, code: string, query: CartQuery): Promise<Cart> {
    const cart = await this.resolve(token, query);

    const promotion = await this.prisma.client.promotion.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
    });

    // A refusal reports the error and leaves the cart as it was — including a
    // coupon already working on it. Blanking that out would make a mistyped
    // second code look as though it had cancelled the first.
    const refuse = async (reason: string): Promise<Cart> => {
      const rendered = await this.render(cart.token, query, []);
      return { ...rendered, couponError: reason };
    };

    if (!promotion) return refuse('هذا الكود غير صحيح.');

    const subtotalUsd = cart.items.reduce(
      (total, item) => total.plus(item.unitPriceUsd.times(item.qty)),
      new Prisma.Decimal(0),
    );
    const refusal = couponRefusal(promotion, this.rulesOf(promotion.rules), {
      subtotalUsd,
      variantIds: cart.items.map((item) => item.variantId),
    });
    if (refusal) {
      switch (refusal.reason) {
        case 'INACTIVE':
          return refuse('هذا الكود غير صحيح.');
        case 'NOT_STARTED':
          return refuse('هذا الكود لم يبدأ بعد.');
        case 'EXPIRED':
          return refuse('انتهت صلاحية هذا الكود.');
        case 'EXHAUSTED':
          return refuse('استُهلك هذا الكود بالكامل.');
        case 'BELOW_MINIMUM':
          return refuse(`هذا الكود يبدأ من ${String(refusal.minTotalUsd)} دولاراً.`);
        case 'MISSING_REQUIRED':
          return refuse('هذا الكود يشترط وجود منتجات محدّدة في السلة.');
      }
    }

    await this.prisma.client.cart.update({
      where: { id: cart.id },
      data: { couponCode: promotion.code, lastActivityAt: new Date() },
    });

    return this.render(cart.token, query, []);
  }

  async removeCoupon(token: string, query: CartQuery): Promise<Cart> {
    const cart = await this.resolve(token, query);
    await this.prisma.client.cart.update({
      where: { id: cart.id },
      data: { couponCode: null },
    });
    return this.render(cart.token, query, []);
  }

  private rulesOf(value: Prisma.JsonValue): PromotionRules {
    const parsed = promotionRulesSchema.safeParse(value ?? {});
    return parsed.success ? parsed.data : promotionRulesSchema.parse({});
  }

  // --- rendering ------------------------------------------------------------

  /**
   * Builds the cart the storefront draws, and writes the totals back.
   *
   * The totals live on the Cart row as well as in the response because the
   * abandoned-cart ladder and the manager queue both need to know what a cart
   * was worth without replaying its lines.
   */
  async render(token: string, query: CartQuery, adjustments: Cart['adjustments']): Promise<Cart> {
    return (await this.renderWithOffers(token, query, adjustments)).cart;
  }

  /**
   * `render`, plus the record of which offers the totals used — what the
   * checkout writes onto the order it drafts from this cart.
   */
  async renderWithOffers(
    token: string,
    query: CartQuery,
    adjustments: Cart['adjustments'],
  ): Promise<{ cart: Cart; offers: OrderOfferSnapshot }> {
    const cart = await this.prisma.client.cart.findUnique({
      where: { token },
      include: CART_INCLUDE,
    });
    if (!cart) throw new NotFoundException('لا توجد سلة بهذا الرمز.');

    const locale = this.localeFor(query);
    const now = new Date();
    const [fx, sales, offerSettings] = await Promise.all([
      this.fxTable(),
      this.sales.live(now),
      this.marketing.get('offers'),
    ]);

    // Seasonal sales first, because they are prices, not discounts: every
    // total below is computed from the reconciled line prices.
    const saleOf = new Map<string, ReturnType<typeof saleFor>>();
    const saleEnded = new Set<string>();
    for (const item of cart.items) {
      const sale = saleFor(sales, {
        id: item.variant.productId,
        categoryIds: item.variant.product.categories.map((link) => link.categoryId),
      });
      saleOf.set(item.id, sale);
      const shelfUsd = salePriced(item.variant, sale).priceUsd;

      // Priced by a sale that is no longer in force — it reached its end, or
      // was switched off — so the price it was advertised with has come back.
      const lapsed = item.saleId !== null && (sale === null || sale.id !== item.saleId);
      // A sale running now that beats the line's price: nobody pays more
      // than the price on the shelf beside them.
      const undercut = sale !== null && shelfUsd.lessThan(item.unitPriceUsd);
      if (!lapsed && !undercut) continue;

      if (lapsed && shelfUsd.greaterThan(item.unitPriceUsd)) saleEnded.add(item.id);
      item.unitPriceUsd = shelfUsd;
      item.saleId = sale?.id ?? null;
      item.saleEndsAt = sale?.endsAt ?? null;
      await this.prisma.client.cartItem.update({
        where: { id: item.id },
        data: { unitPriceUsd: shelfUsd, saleId: item.saleId, saleEndsAt: item.saleEndsAt },
      });
    }

    const lines: CartLine[] = cart.items.map((item) => {
      const variant = item.variant;
      const translation =
        variant.product.translations.find((entry) => entry.locale === locale) ??
        variant.product.translations[0];
      const hero = variant.product.media[0];
      const sale = saleOf.get(item.id) ?? null;

      const lineTotalUsd = item.unitPriceUsd.times(item.qty);
      // The shelf price now, sale included — so a line on sale is not
      // reported as "the price has changed" merely for being on sale.
      const nowUsd = salePriced(variant, sale).priceUsd;
      const moved = !nowUsd.equals(item.unitPriceUsd);

      // Headroom, not availability. This cart's own qty is already inside
      // `reserved`, so what is left over is exactly how much more it could add.
      //
      // For a made-to-order line there is no headroom to report, only the
      // per-line cap — the supply is the supplier's, and a number here would
      // be an invention.
      const stocked = variant.fulfillmentMode === FulfillmentMode.FROM_STOCK;
      const onHand = variant.inventory?.onHand ?? 0;
      const reserved = variant.inventory?.reserved ?? 0;

      return {
        id: item.id,
        variantId: variant.id,
        sku: variant.sku,
        productSlug: variant.product.slug,
        productName: translation?.name ?? variant.product.slug,
        licensePeriodValue: variant.licensePeriodValue,
        licensePeriodUnit: variant.licensePeriodUnit,
        deviceCount: variant.deviceCount,
        activationMethod: variant.activationMethod,
        deliverySlaSeconds: variant.deliverySlaSeconds,
        image: hero
          ? {
              url: this.assetUrl(hero.asset.key),
              alt:
                hero.asset.alts.find((alt) => alt.locale === locale)?.alt ??
                translation?.name ??
                variant.product.slug,
              width: hero.asset.width,
              height: hero.asset.height,
            }
          : null,
        qty: item.qty,
        unitPrice: displayPrice(item.unitPriceUsd, null, query.currency, fx),
        lineTotal: displayPrice(lineTotalUsd, null, query.currency, fx),
        priceChanged: moved
          ? {
              nowUsd: nowUsd.toFixed(2),
              direction: nowUsd.greaterThan(item.unitPriceUsd) ? 'up' : 'down',
            }
          : null,
        availableToAdd: stocked ? Math.max(0, onHand - reserved) : MAX_LINE_QTY - item.qty,
        fulfillmentMode: variant.fulfillmentMode,
        requiresActivationEmail: variant.requiresActivationEmail,
        fromCrossSell: item.fromCrossSell,
        sale: sale && item.saleId === sale.id ? saleBadge(sale, query.locale) : null,
        saleEnded: saleEnded.has(item.id),
      };
    });

    const subtotalUsd = cart.items.reduce(
      (total, item) => total.plus(item.unitPriceUsd.times(item.qty)),
      new Prisma.Decimal(0),
    );
    const itemCount = cart.items.reduce((total, item) => total + item.qty, 0);

    const couponResult = await this.discountFor(cart, subtotalUsd, query, fx);

    // One discount per cart: the best of the coupon, the volume tier and the
    // pair discount — see `bestDiscount` and the rules in @da/contracts/offers.
    const offersOn = offerSettings.enabled && cart.items.length > 0;
    const tier = offersOn ? tierFor(offerSettings.volumeTiers, itemCount) : null;
    const pair = offersOn
      ? pairDiscount(
          cart.items.map((item) => ({
            productId: item.variant.productId,
            qty: item.qty,
            unitPriceUsd: item.unitPriceUsd,
          })),
          offerSettings.pairs,
        )
      : null;

    const best = bestDiscount([
      { kind: 'coupon', amountUsd: couponResult.discountUsd },
      { kind: 'volume', amountUsd: volumeDiscountUsd(subtotalUsd, tier) },
      { kind: 'pair', amountUsd: pair?.discountUsd ?? new Prisma.Decimal(0) },
    ]);
    const discountUsd = Prisma.Decimal.min(
      best?.amountUsd ?? new Prisma.Decimal(0),
      subtotalUsd,
    ).toDecimalPlaces(2);
    const totalUsd = Prisma.Decimal.max(new Prisma.Decimal(0), subtotalUsd.minus(discountUsd));

    const automaticPercent =
      best?.kind === 'volume'
        ? (tier?.percent ?? null)
        : best?.kind === 'pair'
          ? (pair?.percent ?? null)
          : null;
    const automatic =
      best && best.kind !== 'coupon'
        ? {
            kind: best.kind,
            percent: automaticPercent ?? 0,
            amount: displayPrice(discountUsd, null, query.currency, fx),
            // The offers carry one licence number, for tiers and pairs alike.
            licenceNumber: offerSettings.volumeLicenceNumber,
          }
        : null;

    await this.prisma.client.cart.update({
      where: { id: cart.id },
      data: {
        subtotalUsd,
        discountUsd,
        totalUsd,
        currency: query.currency,
        locale,
        fxRate: fx[query.currency]?.rate ?? new Prisma.Decimal(1),
      },
    });

    const expiry = cart.reservations
      .map((entry) => entry.expiresAt)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    const rendered: Cart = {
      token: cart.token,
      locale: query.locale,
      currency: query.currency,
      lines,
      itemCount,
      subtotal: displayPrice(subtotalUsd, null, query.currency, fx),
      discount: displayPrice(discountUsd, null, query.currency, fx),
      total: displayPrice(totalUsd, null, query.currency, fx),
      coupon: couponResult.coupon,
      couponError: null,
      automaticDiscount: automatic,
      // Attached, worth something, and not the one applied.
      couponSuperseded: couponResult.coupon !== null && automatic !== null,
      volume:
        offersOn && offerSettings.volumeTiers.length > 0
          ? {
              applied: tier ? { minItems: tier.minItems, percent: tier.percent } : null,
              next: nextTier(offerSettings.volumeTiers, itemCount),
              showProgressBar: offerSettings.showProgressBar,
              licenceNumber: offerSettings.volumeLicenceNumber,
            }
          : null,
      reservationExpiresAt: expiry ? expiry.toISOString() : null,
      adjustments,
    };

    const offers: OrderOfferSnapshot = {
      discount: best?.kind ?? null,
      percent: automaticPercent,
      licenceNumber: automatic ? offerSettings.volumeLicenceNumber : '',
      saleIds: [
        ...new Set(cart.items.map((item) => item.saleId).filter((id): id is string => !!id)),
      ],
      pairMatched: pair?.matched ?? false,
    };

    return { cart: rendered, offers };
  }

  /**
   * What the attached coupon is actually worth on this cart.
   *
   * The headline value and the amount taken off are different numbers — 20%
   * capped at $10 on a $200 cart is $10 — and it is the second one that has to
   * appear on the page and in the order.
   */
  private async discountFor(
    cart: CartRow,
    subtotalUsd: Prisma.Decimal,
    query: CartQuery,
    fx: FxTable,
  ): Promise<{ discountUsd: Prisma.Decimal; coupon: Cart['coupon'] }> {
    const zero = { discountUsd: new Prisma.Decimal(0), coupon: null };
    if (!cart.couponCode || cart.items.length === 0) return zero;

    const promotion = await this.prisma.client.promotion.findFirst({
      where: { code: cart.couponCode, isActive: true },
    });
    if (!promotion) return zero;

    const rules = this.rulesOf(promotion.rules);

    // Asked again on every render, not only when the code was typed: a coupon
    // that has since expired, hit its cap, or lost the items that qualified
    // the cart is worth nothing now, whatever it was worth when applied.
    if (
      couponRefusal(promotion, rules, {
        subtotalUsd,
        variantIds: cart.items.map((item) => item.variantId),
      })
    ) {
      return zero;
    }

    // Which lines the coupon may touch. An empty rule set means all of them.
    // A bundle discounts the bundle. Without this, a BUNDLE_DISCOUNT carrying
    // only `requiresAllVariantIds` took its percentage off every line in the
    // cart — completing a two-item bundle beside a third, unrelated licence
    // discounted all three.
    const bundleOnly =
      promotion.type === PromotionType.BUNDLE_DISCOUNT &&
      !(rules.variantIds && rules.variantIds.length > 0) &&
      !(rules.productIds && rules.productIds.length > 0) &&
      (rules.requiresAllVariantIds?.length ?? 0) > 0
        ? new Set(rules.requiresAllVariantIds)
        : null;

    const eligible = cart.items.filter((item) => {
      if (bundleOnly && !bundleOnly.has(item.variantId)) return false;
      if (rules.excludeProductIds?.includes(item.variant.productId)) return false;
      if (rules.variantIds && rules.variantIds.length > 0) {
        return rules.variantIds.includes(item.variantId);
      }
      if (rules.productIds && rules.productIds.length > 0) {
        return rules.productIds.includes(item.variant.productId);
      }
      // A line on a seasonal sale is discounted as much as one with a
      // compare-at; `render` has already reconciled `saleId` to the sale in
      // force, so this is the sale the shopper is looking at.
      if (rules.excludeDiscounted && (item.variant.compareAtUsd !== null || item.saleId !== null)) {
        return false;
      }
      return true;
    });

    const eligibleUsd = eligible.reduce(
      (total, item) => total.plus(item.unitPriceUsd.times(item.qty)),
      new Prisma.Decimal(0),
    );
    if (eligibleUsd.isZero()) return zero;

    let discountUsd: Prisma.Decimal;
    switch (promotion.type) {
      case PromotionType.PERCENT:
        discountUsd = eligibleUsd.times(promotion.value).dividedBy(100);
        break;
      case PromotionType.FIXED:
        discountUsd = Prisma.Decimal.min(promotion.value, eligibleUsd);
        break;
      case PromotionType.BUNDLE_DISCOUNT:
        discountUsd = eligibleUsd.times(promotion.value).dividedBy(100);
        break;
      default:
        // FREE_ITEM changes what is delivered, not the arithmetic here. It is
        // zero until the fulfilment side can add the free line, rather than
        // guessed at as a discount.
        discountUsd = new Prisma.Decimal(0);
    }

    if (rules.maxDiscountUsd !== undefined) {
      discountUsd = Prisma.Decimal.min(discountUsd, new Prisma.Decimal(rules.maxDiscountUsd));
    }
    discountUsd = Prisma.Decimal.min(discountUsd, subtotalUsd).toDecimalPlaces(2);

    return {
      discountUsd,
      coupon: {
        code: promotion.code ?? cart.couponCode,
        name: promotion.name,
        discount: displayPrice(discountUsd, null, query.currency, fx),
      },
    };
  }

  private assetUrl(key: string): string {
    const base = process.env.S3_PUBLIC_BASE_URL;
    return base ? new URL(key, base).toString() : `/media/${key}`;
  }

  /** Exposed for the checkout module, which needs the same conversion. */
  async convertUsd(
    usd: Prisma.Decimal,
    currency: string,
  ): Promise<{ amount: string; currency: string }> {
    return convert(usd, currency, await this.fxTable());
  }
}
