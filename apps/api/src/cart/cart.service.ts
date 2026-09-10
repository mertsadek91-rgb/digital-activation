import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import crypto from 'node:crypto';

import {
  type AddToCart,
  type Cart,
  type CartLine,
  type CartQuery,
  type PromotionRules,
  promotionRulesSchema,
  RESERVATION_TTL_MINUTES,
} from '@da/contracts';
import {
  CartStage,
  Locale,
  Prisma,
  PromotionType,
  PublishStatus,
  StockReservationState,
} from '@da/db';

import { convert, displayPrice, type FxTable } from '../catalog/pricing.js';
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
  constructor(private readonly prisma: PrismaService) {}

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
      include: { product: true },
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
            unitPriceUsd: variant.priceUsd,
            fromCrossSell: input.fromCrossSell,
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

    return this.render(cart.token, query, adjustments);
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

    if (!promotion || !promotion.isActive) return refuse('هذا الكود غير صحيح.');

    const now = new Date();
    if (promotion.startsAt && promotion.startsAt > now) return refuse('هذا الكود لم يبدأ بعد.');
    if (promotion.endsAt && promotion.endsAt < now) return refuse('انتهت صلاحية هذا الكود.');
    if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
      return refuse('استُهلك هذا الكود بالكامل.');
    }

    const rules = this.rulesOf(promotion.rules);
    const subtotalUsd = cart.items.reduce(
      (total, item) => total.plus(item.unitPriceUsd.times(item.qty)),
      new Prisma.Decimal(0),
    );

    if (rules.minTotalUsd !== undefined && subtotalUsd.lessThan(rules.minTotalUsd)) {
      return refuse(`هذا الكود يبدأ من ${rules.minTotalUsd} دولاراً.`);
    }
    if (
      rules.requiresAllVariantIds &&
      rules.requiresAllVariantIds.length > 0 &&
      !rules.requiresAllVariantIds.every((id) => cart.items.some((item) => item.variantId === id))
    ) {
      return refuse('هذا الكود يشترط وجود منتجات محدّدة في السلة.');
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
    const cart = await this.prisma.client.cart.findUnique({
      where: { token },
      include: CART_INCLUDE,
    });
    if (!cart) throw new NotFoundException('لا توجد سلة بهذا الرمز.');

    const locale = this.localeFor(query);
    const fx = await this.fxTable();

    const lines: CartLine[] = cart.items.map((item) => {
      const variant = item.variant;
      const translation =
        variant.product.translations.find((entry) => entry.locale === locale) ??
        variant.product.translations[0];
      const hero = variant.product.media[0];

      const lineTotalUsd = item.unitPriceUsd.times(item.qty);
      const nowUsd = variant.priceUsd;
      const moved = !nowUsd.equals(item.unitPriceUsd);

      // Headroom, not availability. This cart's own qty is already inside
      // `reserved`, so what is left over is exactly how much more it could add.
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
        availableToAdd: Math.max(0, onHand - reserved),
        fromCrossSell: item.fromCrossSell,
      };
    });

    const subtotalUsd = cart.items.reduce(
      (total, item) => total.plus(item.unitPriceUsd.times(item.qty)),
      new Prisma.Decimal(0),
    );

    const { discountUsd, coupon } = await this.discountFor(cart, subtotalUsd, query, fx);
    const totalUsd = Prisma.Decimal.max(new Prisma.Decimal(0), subtotalUsd.minus(discountUsd));

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

    return {
      token: cart.token,
      locale: query.locale,
      currency: query.currency,
      lines,
      itemCount: cart.items.reduce((total, item) => total + item.qty, 0),
      subtotal: displayPrice(subtotalUsd, null, query.currency, fx),
      discount: displayPrice(discountUsd, null, query.currency, fx),
      total: displayPrice(totalUsd, null, query.currency, fx),
      coupon,
      couponError: null,
      reservationExpiresAt: expiry ? expiry.toISOString() : null,
      adjustments,
    };
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

    // Which lines the coupon may touch. An empty rule set means all of them.
    const eligible = cart.items.filter((item) => {
      if (rules.excludeProductIds?.includes(item.variant.productId)) return false;
      if (rules.variantIds && rules.variantIds.length > 0) {
        return rules.variantIds.includes(item.variantId);
      }
      if (rules.productIds && rules.productIds.length > 0) {
        return rules.productIds.includes(item.variant.productId);
      }
      if (rules.excludeDiscounted && item.variant.compareAtUsd !== null) return false;
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
