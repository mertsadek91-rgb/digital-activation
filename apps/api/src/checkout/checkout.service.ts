import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import {
  type CartQuery,
  type Checkout,
  type CheckoutStart,
  type CrossSell,
  type Order,
  CROSS_SELL_MAX,
  CROSS_SELL_MIN_SAVE_PERCENT,
} from '@da/contracts';
import {
  CartStage,
  FulfillmentMode,
  FulfillmentState,
  Locale,
  OrderStatus,
  Prisma,
  PromotionType,
  PublishStatus,
  RiskLevel,
} from '@da/db';

import { CartService } from '../cart/cart.service.js';
import { displayPrice, type FxTable } from '../catalog/pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { consumeHolds, nextOrderNumber } from './orders.js';

/**
 * Checkout.
 *
 * The email is captured before payment on purpose: a cart that reaches this
 * step and stops is the most valuable abandoned cart there is, and without an
 * email there is nobody to write to. That single field is what promotes a cart
 * from anonymous to recoverable.
 *
 * Nothing is delivered here. Payment succeeding moves the order to PAID and
 * turns the stock hold into a sale; releasing a licence key happens after, and
 * behind the fraud check, because a digital key cannot be recalled once sent.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
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

  /**
   * Captures the email and drafts the order.
   *
   * Re-running it on the same cart updates the existing draft rather than
   * making a second one. A shopper who goes back to fix a typo in their email
   * must not leave two orders behind, and refreshing the payment page must not
   * either.
   */
  async start(
    token: string,
    input: CheckoutStart,
    query: CartQuery,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<Checkout> {
    const cart = await this.cart.resolve(token, query);
    if (cart.items.length === 0) throw new BadRequestException('السلة فارغة.');

    // Re-render first: it re-prices the lines, re-checks the coupon and writes
    // the totals back, so the order is drafted from what the shopper is looking
    // at rather than from whatever the row last said.
    const rendered = await this.cart.render(cart.token, query, []);
    const fresh = await this.prisma.client.cart.findUniqueOrThrow({
      where: { id: cart.id },
      include: { items: { include: { variant: { include: { product: true } } } } },
    });

    const unsellable = fresh.items.filter(
      (item) =>
        item.variant.status !== PublishStatus.PUBLISHED ||
        item.variant.product.status !== PublishStatus.PUBLISHED,
    );
    if (unsellable.length > 0) {
      throw new BadRequestException(
        `لم يبقَ متاحاً: ${unsellable.map((item) => item.variant.sku).join('، ')}`,
      );
    }

    // Refused, not guessed. A licence issued against the wrong address is a
    // key nobody can use and a supplier order that cannot be reversed, so the
    // checkout stops here rather than quietly using the order email.
    const bindingLines = fresh.items.filter((item) => item.variant.requiresActivationEmail);
    const activationEmailRequired = bindingLines.length > 0;
    if (activationEmailRequired && !input.activationEmail) {
      throw new BadRequestException(
        `يجب تحديد البريد الإلكتروني الذي يُفعَّل عليه الترخيص لـ: ${bindingLines
          .map((item) => item.variant.sku)
          .join('، ')}`,
      );
    }

    const locale = this.localeFor(query);
    const customer = await this.upsertCustomer(input, locale, query.currency);

    const existing = await this.prisma.client.order.findFirst({
      where: { cartId: cart.id, status: OrderStatus.PENDING_PAYMENT },
    });

    const promotion = fresh.couponCode
      ? await this.prisma.client.promotion.findFirst({
          where: { code: fresh.couponCode, isActive: true },
          select: { id: true },
        })
      : null;

    const shared = {
      email: input.email,
      customerId: customer.id,
      locale,
      currency: query.currency,
      fxRate: fresh.fxRate,
      subtotalUsd: fresh.subtotalUsd,
      discountUsd: fresh.discountUsd,
      // Zero, and not silently: VAT treatment for GCC and EU sales is a
      // decision about registration and place of supply, not a rate to
      // hardcode here. The column exists so the day it is answered nothing
      // else has to move.
      taxUsd: new Prisma.Decimal(0),
      totalUsd: fresh.totalUsd,
      promotionId: promotion?.id ?? null,
      couponCode: fresh.couponCode,
      billingName: input.name ?? null,
      billingCompany: input.company ?? null,
      billingVat: input.vatNumber ?? null,
      billingCountry: input.country ?? null,
      activationEmail: activationEmailRequired ? (input.activationEmail ?? null) : null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    };

    const order = await this.prisma.client.$transaction(async (tx) => {
      if (existing) {
        // The lines are rewritten rather than diffed. The draft is not a
        // document anyone has acted on yet, and a rewrite cannot leave a stale
        // line behind the way a partial update can.
        await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
        await tx.order.update({ where: { id: existing.id }, data: shared });
        await this.writeLines(tx, existing.id, fresh.items);
        return tx.order.findUniqueOrThrow({
          where: { id: existing.id },
          include: { items: true },
        });
      }

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const number = await nextOrderNumber(tx, new Date());
        try {
          const created = await tx.order.create({
            data: { ...shared, number, cartId: cart.id, status: OrderStatus.PENDING_PAYMENT },
          });
          await this.writeLines(tx, created.id, fresh.items);
          return tx.order.findUniqueOrThrow({
            where: { id: created.id },
            include: { items: true },
          });
        } catch (error) {
          // P2002 is the unique index on `number` doing its job: somebody else
          // took that number between the read and the write. Read again.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002' &&
            attempt < 4
          ) {
            continue;
          }
          throw error;
        }
      }
      throw new BadRequestException('تعذّر إنشاء رقم طلب. أعد المحاولة.');
    });

    // An email on the cart is what the recovery ladder looks for.
    await this.prisma.client.cart.update({
      where: { id: cart.id },
      data: { email: input.email, customerId: customer.id, lastActivityAt: new Date() },
    });

    return {
      order: await this.renderOrder(order.number, query),
      cart: rendered,
      crossSell: await this.crossSellFor(
        fresh.items.map((item) => item.variantId),
        query,
      ),
      activationEmailRequired,
    };
  }

  private async writeLines(
    tx: Prisma.TransactionClient,
    orderId: string,
    items: Prisma.CartItemGetPayload<{
      include: { variant: { include: { product: true } } };
    }>[],
  ): Promise<void> {
    for (const item of items) {
      const translation = await tx.productTranslation.findFirst({
        where: { productId: item.variant.productId },
        orderBy: { locale: 'asc' },
        select: { name: true },
      });

      await tx.orderItem.create({
        data: {
          orderId,
          variantId: item.variantId,
          // Snapshots. A product can be renamed or repriced later; an invoice
          // must not change retroactively.
          productNameSnapshot: translation?.name ?? item.variant.product.slug,
          skuSnapshot: item.variant.sku,
          variantSpecSnapshot: {
            licensePeriodValue: item.variant.licensePeriodValue,
            licensePeriodUnit: item.variant.licensePeriodUnit,
            deviceCount: item.variant.deviceCount,
            platform: item.variant.platform,
            activationMethod: item.variant.activationMethod,
          },
          qty: item.qty,
          unitPriceUsd: item.unitPriceUsd,
          lineTotalUsd: item.unitPriceUsd.times(item.qty),
          // A made-to-order line has no key to assign: somebody has to place
          // the supplier order. Starting it in MANUAL_QUEUE puts it on a
          // person's list instead of waiting for an automation that would
          // never find a key to hand over.
          fulfillmentState:
            item.variant.fulfillmentMode === FulfillmentMode.FROM_STOCK
              ? FulfillmentState.PENDING
              : FulfillmentState.MANUAL_QUEUE,
        },
      });
    }
  }

  private async upsertCustomer(
    input: CheckoutStart,
    locale: Locale,
    currency: string,
  ): Promise<{ id: string }> {
    const [firstName, ...rest] = (input.name ?? '').trim().split(/\s+/).filter(Boolean);

    return this.prisma.client.customer.upsert({
      where: { email: input.email },
      // A returning guest keeps whatever they already told us. Overwriting a
      // filled-in name with a blank because this checkout skipped the field
      // loses information for no reason.
      update: {
        ...(firstName ? { firstName, lastName: rest.join(' ') || null } : {}),
        ...(input.company ? { company: input.company } : {}),
        ...(input.vatNumber ? { vatNumber: input.vatNumber } : {}),
        ...(input.marketingOptIn ? { marketingOptInAt: new Date() } : {}),
        locale,
        currency,
      },
      create: {
        email: input.email,
        firstName: firstName ?? null,
        lastName: rest.join(' ') || null,
        company: input.company ?? null,
        vatNumber: input.vatNumber ?? null,
        marketingOptInAt: input.marketingOptIn ? new Date() : null,
        locale,
        currency,
      },
      select: { id: true },
    });
  }

  // --- cross-sell -----------------------------------------------------------

  /**
   * Add-ons offered at the payment step.
   *
   * Driven by BUNDLE_DISCOUNT promotions, not by a "customers also bought"
   * guess — this catalog has too few orders for a co-occurrence model to say
   * anything, and an offer nobody configured is an offer nobody can defend.
   * A promotion qualifies when the cart already holds everything it requires
   * except one variant, and that variant is the thing to offer.
   */
  async crossSellFor(variantIds: string[], query: CartQuery): Promise<CrossSell[]> {
    if (variantIds.length === 0) return [];

    const bundles = await this.prisma.client.promotion.findMany({
      where: {
        type: PromotionType.BUNDLE_DISCOUNT,
        isActive: true,
        OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
      },
    });
    if (bundles.length === 0) return [];

    const locale = this.localeFor(query);
    const fx = await this.fxTable();
    const inCart = new Set(variantIds);
    const offers: CrossSell[] = [];

    for (const bundle of bundles) {
      const rules = bundle.rules as { requiresAllVariantIds?: string[] } | null;
      const required = rules?.requiresAllVariantIds ?? [];
      if (required.length < 2) continue;

      const missing = required.filter((id) => !inCart.has(id));
      // Exactly one thing away from qualifying. Two away is not an add-on, it
      // is a different shopping trip.
      if (missing.length !== 1) continue;

      const savePercent = Math.round(Number(bundle.value));
      if (savePercent < CROSS_SELL_MIN_SAVE_PERCENT) continue;

      const variantId = missing[0];
      if (variantId === undefined) continue;

      const variant = await this.prisma.client.variant.findFirst({
        where: { id: variantId, status: PublishStatus.PUBLISHED },
        include: {
          inventory: true,
          product: {
            include: {
              translations: { where: { locale } },
              media: {
                where: { isHero: true },
                take: 1,
                include: { asset: { include: { alts: { where: { locale } } } } },
              },
            },
          },
        },
      });
      if (!variant || variant.product.status !== PublishStatus.PUBLISHED) continue;

      // Never offer something that cannot be delivered.
      const available = (variant.inventory?.onHand ?? 0) - (variant.inventory?.reserved ?? 0);
      if (available <= 0) continue;

      const hero = variant.product.media[0];
      const bundleUsd = variant.priceUsd
        .times(100 - savePercent)
        .dividedBy(100)
        .toDecimalPlaces(2);

      offers.push({
        variantId: variant.id,
        sku: variant.sku,
        productSlug: variant.product.slug,
        productName: variant.product.translations[0]?.name ?? variant.product.slug,
        image: hero
          ? {
              url: this.assetUrl(hero.asset.key),
              alt: hero.asset.alts[0]?.alt ?? variant.product.slug,
              width: hero.asset.width,
              height: hero.asset.height,
            }
          : null,
        price: displayPrice(variant.priceUsd, null, query.currency, fx),
        bundlePrice: displayPrice(bundleUsd, null, query.currency, fx),
        savePercent,
        promotionCode: bundle.code ?? '',
      });

      if (offers.length >= CROSS_SELL_MAX) break;
    }

    return offers;
  }

  // --- payment application --------------------------------------------------

  /**
   * Marks an order paid, and turns its stock hold into a sale.
   *
   * This is the one transition that must survive being run twice: payment
   * webhooks are delivered at least once, not exactly once. Idempotence comes
   * from state rather than from a flag — an order already past
   * PENDING_PAYMENT is left alone, and `consumeHolds` only touches ACTIVE
   * reservations, so the second delivery finds nothing to do.
   *
   * A HIGH risk score lands in PAYMENT_REVIEW instead of PAID. The money is
   * taken either way; what is held back is the key, because that is the only
   * part that cannot be undone.
   */
  async markPaid(input: {
    orderNumber: string;
    provider: 'STRIPE' | 'PAYPAL' | 'BANK_TRANSFER' | 'CRYPTO';
    providerRef: string;
    amountCharged: string;
    chargedCurrency: string;
  }): Promise<{ status: OrderStatus; alreadyApplied: boolean; consumed: number }> {
    return this.prisma.client.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { number: input.orderNumber },
        // totalUsd is read here rather than passed in: the provider charged in
        // the presentation currency, and dividing that by 100 again would file
        // an AED figure as dollars — the same class of mistake that put an AED
        // price in the legacy store's USD structured data.
        select: { id: true, status: true, cartId: true, riskLevel: true, totalUsd: true },
      });
      if (!order) throw new NotFoundException(`No order ${input.orderNumber}`);

      // The payment row is recorded even on a repeat delivery, because the
      // unique index on (provider, providerRef) makes that safe and the
      // absence of a row is worse than a duplicate attempt.
      await tx.payment.upsert({
        where: {
          provider_providerRef: { provider: input.provider, providerRef: input.providerRef },
        },
        update: { state: 'SUCCEEDED' },
        create: {
          orderId: order.id,
          provider: input.provider,
          state: 'SUCCEEDED',
          providerRef: input.providerRef,
          amountCharged: input.amountCharged,
          chargedCurrency: input.chargedCurrency,
          amountUsd: order.totalUsd,
        },
      });

      if (order.status !== OrderStatus.PENDING_PAYMENT) {
        return { status: order.status, alreadyApplied: true, consumed: 0 };
      }

      const held = order.riskLevel === RiskLevel.HIGH || order.riskLevel === RiskLevel.BLOCKED;
      const status = held ? OrderStatus.PAYMENT_REVIEW : OrderStatus.PAID;

      const consumed = await consumeHolds(tx, { cartId: order.cartId, orderId: order.id });

      await tx.order.update({
        where: { id: order.id },
        data: { status, paidAt: new Date() },
      });

      if (order.cartId) {
        await tx.cart.update({
          where: { id: order.cartId },
          data: { stage: CartStage.CLOSED, recoveredOrderId: order.id },
        });
      }

      await tx.customer.updateMany({
        where: { orders: { some: { id: order.id } } },
        data: { lastOrderAt: new Date(), orderCount: { increment: 1 } },
      });

      return { status, alreadyApplied: false, consumed: consumed.consumed };
    });
  }

  // --- reading --------------------------------------------------------------

  async renderOrder(number: string, query: CartQuery): Promise<Order> {
    const order = await this.prisma.client.order.findUnique({
      where: { number },
      include: {
        items: { include: { variant: { select: { product: { select: { slug: true } } } } } },
      },
    });
    if (!order) throw new NotFoundException(`لا يوجد طلب بالرقم ${number}`);

    const fx = await this.fxTable();
    const price = (usd: Prisma.Decimal) => displayPrice(usd, null, query.currency, fx);

    return {
      number: order.number,
      status: order.status,
      email: order.email,
      activationEmail: order.activationEmail,
      locale: order.locale === Locale.EN ? 'en' : 'ar',
      currency: query.currency,
      lines: order.items.map((item) => ({
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        productSlug: item.variant.product.slug,
        qty: item.qty,
        unitPrice: price(item.unitPriceUsd),
        lineTotal: price(item.lineTotalUsd),
        fulfillmentState: item.fulfillmentState,
      })),
      subtotal: price(order.subtotalUsd),
      discount: price(order.discountUsd),
      tax: price(order.taxUsd),
      total: price(order.totalUsd),
      couponCode: order.couponCode,
      placedAt: order.placedAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
    };
  }

  private assetUrl(key: string): string {
    const base = process.env.S3_PUBLIC_BASE_URL;
    return base ? new URL(key, base).toString() : `/media/${key}`;
  }
}
