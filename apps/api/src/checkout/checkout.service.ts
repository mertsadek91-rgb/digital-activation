import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

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
  PaymentProvider,
  PaymentState,
  Prisma,
  PromotionType,
  PublishStatus,
  RiskLevel,
} from '@da/db';

import { CartService } from '../cart/cart.service.js';
import { parseActivationSteps } from '../common/activation-steps.js';
import { customerCouponMessage, customerCouponRefusal } from '../common/coupon-customer.js';
import { displayPrice, type FxTable } from '../catalog/pricing.js';
import { SalesService, saleFor, salePriced } from '../offers/sales.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { chargeMatches, orderCharge } from './charge.js';
import {
  consumeHolds,
  countSale,
  lockOrderNumbers,
  nextOrderNumber,
  sellUnheld,
} from './orders.js';
import { PaymentSettingsService } from './payment-settings.service.js';
import { StripeService } from './stripe.service.js';

type Db = Prisma.TransactionClient | PrismaService['client'];

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
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly stripe: StripeService,
    private readonly sales: SalesService,
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
    // at rather than from whatever the row last said. That includes a sale that
    // has ended since a line was added — its price comes back here — and the
    // one cart discount (coupon, volume tier or pair), already in the totals
    // the charge is computed from.
    const { cart: rendered, offers } = await this.cart.renderWithOffers(cart.token, query, []);
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

    // A coupon that lost to an automatic offer is attached but not applied, so
    // the order does not carry it: it must not spend a use of the code, nor be
    // refused for a per-customer limit on a discount it is not getting.
    const couponApplied = fresh.couponCode !== null && !rendered.couponSuperseded;
    const promotion =
      couponApplied && fresh.couponCode
        ? await this.prisma.client.promotion.findFirst({
            where: { code: fresh.couponCode, isActive: true },
            select: { id: true, perCustomerLimit: true, issuedToId: true, rules: true },
          })
        : null;

    // Who is paying decides the rest: a code issued to somebody else, a
    // first-order code on a repeat buyer, a referrer on their own link.
    if (promotion) {
      const refusal = await customerCouponRefusal(this.prisma.client, promotion, {
        customerId: customer.id,
        email: input.email,
        excludeOrderId: existing?.id,
      });
      if (refusal) {
        throw new BadRequestException(customerCouponMessage(refusal, query.locale));
      }
    }

    // Refused before payment rather than discovered after it. `markPaid`
    // checks again — two tabs can race past this — but the shopper who has
    // simply used the code before should hear it here, not from a held order.
    if (promotion && promotion.perCustomerLimit !== null) {
      const used = await this.prisma.client.promotionUsage.count({
        where: {
          promotionId: promotion.id,
          OR: [{ customerId: customer.id }, { order: { email: input.email } }],
        },
      });
      if (used >= promotion.perCustomerLimit) {
        throw new BadRequestException(
          query.locale === 'en'
            ? 'You have already used this coupon.'
            : 'سبق أن استخدمت هذا الكود.',
        );
      }
    }

    // The currency the shopper was actually shown. A currency with no rate
    // loaded renders in dollars, and recording the requested code beside a
    // rate of 1 would later charge dollars' worth of dirhams.
    const currency = rendered.total.currency;
    const fxRate = currency === 'USD' ? new Prisma.Decimal(1) : fresh.fxRate;

    const shared = {
      email: input.email,
      customerId: customer.id,
      locale,
      currency,
      fxRate,
      subtotalUsd: fresh.subtotalUsd,
      discountUsd: fresh.discountUsd,
      // Zero, and not silently: VAT treatment for GCC and EU sales is a
      // decision about registration and place of supply, not a rate to
      // hardcode here. The column exists so the day it is answered nothing
      // else has to move.
      taxUsd: new Prisma.Decimal(0),
      totalUsd: fresh.totalUsd,
      promotionId: promotion?.id ?? null,
      couponCode: couponApplied ? fresh.couponCode : null,
      offerSnapshot: offers,
      billingName: input.name ?? null,
      billingCompany: input.company ?? null,
      billingVat: input.vatNumber ?? null,
      billingCountry: input.country ?? null,
      activationEmail: activationEmailRequired ? (input.activationEmail ?? null) : null,
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    };

    if (existing) {
      // A rewritten draft costs something new, so whatever intent was opened
      // for the old total must not stay payable. The webhook would catch the
      // mismatch anyway; cancelling it means there is nothing to catch.
      await this.cancelOpenIntents(existing.id);
    }

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

      // Serialised rather than retried. Retrying a unique violation inside the
      // same transaction cannot work in Postgres — the first error aborts the
      // transaction and every later statement fails with it — so two
      // concurrent checkouts now take turns at the number instead.
      await lockOrderNumbers(tx);
      const number = await nextOrderNumber(tx, new Date());
      const created = await tx.order.create({
        data: { ...shared, number, cartId: cart.id, status: OrderStatus.PENDING_PAYMENT },
      });
      await this.writeLines(tx, created.id, fresh.items);
      return tx.order.findUniqueOrThrow({
        where: { id: created.id },
        include: { items: true },
      });
    });

    // An email on the cart is what the recovery ladder looks for.
    await this.prisma.client.cart.update({
      where: { id: cart.id },
      data: { email: input.email, customerId: customer.id, lastActivityAt: new Date() },
    });

    return {
      order: await this.renderOrder(order.number, query, { skipOwnerCheck: true }),
      cart: rendered,
      crossSell: await this.crossSellFor(
        fresh.items.map((item) => item.variantId),
        query,
      ),
      activationEmailRequired,
      // Decided here, once, rather than by a page guessing from a row of
      // hardcoded buttons. A method whose details nobody has filled in is
      // absent, so the shopper never reaches a payment step with nothing on it.
      paymentMethods: await this.paymentSettings.offeredProviders(),
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

      // One order line per licence. Every step after payment — the vault's
      // one-key-per-line binding, the supplier queue, the delivery email, the
      // review — counts a line as one key, and a single line of quantity three
      // was delivered as one key with the line marked done. Splitting here
      // gives each licence its own line to be assigned, queued and delivered.
      for (let unit = 0; unit < item.qty; unit += 1) {
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
            qty: 1,
            unitPriceUsd: item.unitPriceUsd,
            lineTotalUsd: item.unitPriceUsd,
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
  }

  private async upsertCustomer(
    input: CheckoutStart,
    locale: Locale,
    currency: string,
  ): Promise<{ id: string }> {
    const [firstName, ...rest] = (input.name ?? '').trim().split(/\s+/).filter(Boolean);

    const existing = await this.prisma.client.customer.findUnique({
      where: { email: input.email },
      select: { id: true, firstName: true, company: true, vatNumber: true },
    });

    if (existing) {
      // Filled in, never overwritten. The email typed at checkout is not
      // verified, so anybody can type somebody else's — and before, doing so
      // replaced that customer's name, company and VAT number with whatever
      // the stranger entered. Blank fields still get completed; a returning
      // guest who skipped the name last time loses nothing.
      await this.prisma.client.customer.update({
        where: { id: existing.id },
        data: {
          ...(firstName && !existing.firstName
            ? { firstName, lastName: rest.join(' ') || null }
            : {}),
          ...(input.company && !existing.company ? { company: input.company } : {}),
          ...(input.vatNumber && !existing.vatNumber ? { vatNumber: input.vatNumber } : {}),
        },
      });
      return { id: existing.id };
    }

    try {
      return await this.prisma.client.customer.create({
        data: {
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
    } catch (error) {
      // Two tabs checking out with a new address at once: the other one made
      // the row between the read and here, and it is the same person.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.client.customer.findUniqueOrThrow({
          where: { email: input.email },
          select: { id: true },
        });
      }
      throw error;
    }
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
    const [fx, sales] = await Promise.all([this.fxTable(), this.sales.live()]);
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
              categories: { select: { categoryId: true } },
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
      // The price the cart will add it at, sale included — the offer must
      // quote the number the next screen shows. The bundle takes its percent
      // off that, as the coupon it is would.
      const shelfUsd = salePriced(
        variant,
        saleFor(sales, {
          id: variant.productId,
          categoryIds: variant.product.categories.map((link) => link.categoryId),
        }),
      ).priceUsd;
      const bundleUsd = shelfUsd
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
        price: displayPrice(shelfUsd, null, query.currency, fx),
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
   * What an order costs in the money it will be paid in — see `orderCharge`.
   *
   * Takes a client so `markPaid` can ask inside its own transaction.
   */
  async chargeFor(
    order: { totalUsd: Prisma.Decimal; currency: string; fxRate: Prisma.Decimal },
    db: Db = this.prisma.client,
  ): Promise<{ amount: string; currency: string }> {
    const row =
      order.currency === 'USD'
        ? null
        : await db.currency.findUnique({
            where: { code: order.currency },
            select: { decimals: true, roundingRule: true },
          });
    return orderCharge(order, row);
  }

  /** The charge for an order, by number. */
  async chargeForNumber(number: string): Promise<{ amount: string; currency: string }> {
    const order = await this.prisma.client.order.findUniqueOrThrow({
      where: { number },
      select: { totalUsd: true, currency: true, fxRate: true },
    });
    return this.chargeFor(order);
  }

  /**
   * Records the intent a card payment is being made against.
   *
   * The row is what lets a later checkout find and cancel it, and what lets
   * the admin see an attempt that never completed. Keyed on the intent, so a
   * refresh that returns the same intent records nothing new.
   */
  async recordOpenIntent(input: {
    orderNumber: string;
    intentId: string;
    amount: string;
    currency: string;
  }): Promise<void> {
    const order = await this.prisma.client.order.findUniqueOrThrow({
      where: { number: input.orderNumber },
      select: { id: true, totalUsd: true },
    });
    await this.prisma.client.payment.upsert({
      where: {
        provider_providerRef: { provider: PaymentProvider.STRIPE, providerRef: input.intentId },
      },
      update: {},
      create: {
        orderId: order.id,
        provider: PaymentProvider.STRIPE,
        state: PaymentState.PROCESSING,
        providerRef: input.intentId,
        amountCharged: input.amount,
        chargedCurrency: input.currency,
        amountUsd: order.totalUsd,
      },
    });
    // A new amount means a new intent; the one for the old amount goes.
    await this.cancelOpenIntents(order.id, input.intentId);
  }

  /**
   * Cancels every open card intent on an order except `keep`.
   *
   * Called when a draft is rewritten and when a new intent is opened at a
   * different amount: exactly one intent should ever be payable for an order,
   * and it should be the one for what the order costs now.
   */
  async cancelOpenIntents(orderId: string, keep?: string): Promise<void> {
    const open = await this.prisma.client.payment.findMany({
      where: {
        orderId,
        provider: PaymentProvider.STRIPE,
        state: PaymentState.PROCESSING,
        ...(keep ? { NOT: { providerRef: keep } } : {}),
      },
      select: { id: true, providerRef: true },
    });
    for (const payment of open) {
      if (!payment.providerRef) continue;
      if (!this.stripe.configured) break;
      if (await this.stripe.cancelIntent(payment.providerRef)) {
        await this.prisma.client.payment.updateMany({
          where: { id: payment.id, state: PaymentState.PROCESSING },
          data: { state: PaymentState.CANCELLED },
        });
      }
    }
  }

  /**
   * Marks an order paid, and turns its stock hold into a sale.
   *
   * This is the one transition that must survive being run twice: payment
   * webhooks are delivered at least once, not exactly once, and a webhook can
   * race an admin confirming the same order by hand. Idempotence comes from a
   * compare-and-set on the status — only the delivery whose update actually
   * moves the order out of PENDING_PAYMENT goes on to touch stock, coupons and
   * the customer. A read-then-write here let two concurrent deliveries both
   * see PENDING_PAYMENT and both take the stock.
   *
   * Three things send the order to PAYMENT_REVIEW instead of PAID. The money
   * is taken either way; what is held back is the key, because that is the
   * only part that cannot be undone:
   *
   *  - a HIGH or BLOCKED risk level;
   *  - a card payment whose amount or currency is not what the order costs —
   *    the old intent for a cheaper draft, confirmed after the cart grew;
   *  - a coupon that ran out, or that this customer had already used, between
   *    checkout and payment.
   */
  async markPaid(input: {
    orderNumber: string;
    provider: 'STRIPE' | 'PAYPAL' | 'BANK_TRANSFER' | 'CRYPTO';
    providerRef: string;
    amountCharged: string;
    chargedCurrency: string;
    /** What the provider says it took, in minor units. Checked when present. */
    amountMinor?: number;
    riskLevel?: RiskLevel;
  }): Promise<{ status: OrderStatus; alreadyApplied: boolean; consumed: number }> {
    return this.prisma.client.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { number: input.orderNumber },
        // totalUsd is read here rather than passed in: the provider charged in
        // the presentation currency, and dividing that by 100 again would file
        // an AED figure as dollars — the same class of mistake that put an AED
        // price in the legacy store's USD structured data.
        select: {
          id: true,
          status: true,
          cartId: true,
          riskLevel: true,
          totalUsd: true,
          currency: true,
          fxRate: true,
          email: true,
          customerId: true,
          promotionId: true,
          discountUsd: true,
        },
      });
      if (!order) throw new NotFoundException(`No order ${input.orderNumber}`);

      // The payment row is recorded even on a repeat delivery, because the
      // unique index on (provider, providerRef) makes that safe and the
      // absence of a row is worse than a duplicate attempt.
      await tx.payment.upsert({
        where: {
          provider_providerRef: { provider: input.provider, providerRef: input.providerRef },
        },
        update: {
          state: PaymentState.SUCCEEDED,
          amountCharged: input.amountCharged,
          chargedCurrency: input.chargedCurrency,
        },
        create: {
          orderId: order.id,
          provider: input.provider,
          state: PaymentState.SUCCEEDED,
          providerRef: input.providerRef,
          amountCharged: input.amountCharged,
          chargedCurrency: input.chargedCurrency,
          amountUsd: order.totalUsd,
        },
      });

      if (order.status !== OrderStatus.PENDING_PAYMENT) {
        return { status: order.status, alreadyApplied: true, consumed: 0 };
      }

      const reasons: string[] = [];

      if (input.amountMinor !== undefined) {
        const expected = await this.chargeFor(order, tx);
        const matches = chargeMatches(expected, {
          amountMinor: input.amountMinor,
          currency: input.chargedCurrency,
        });
        if (!matches) {
          reasons.push(
            `Charged ${input.amountCharged} ${input.chargedCurrency}, but the order costs ${expected.amount} ${expected.currency}.`,
          );
        }
      }

      const riskLevel = input.riskLevel ?? order.riskLevel;
      if (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.BLOCKED) {
        reasons.push(`Payment risk level is ${riskLevel}.`);
      }

      // Read before the transition and written after it. The per-customer
      // count is by customer and by email, because a guest checking out twice
      // with the same address is the same person.
      let promotion: {
        id: string;
        usageLimit: number | null;
        perCustomerLimit: number | null;
        issuedToId: string | null;
        rules: Prisma.JsonValue;
      } | null = null;
      if (order.promotionId) {
        promotion = await tx.promotion.findUnique({
          where: { id: order.promotionId },
          select: {
            id: true,
            usageLimit: true,
            perCustomerLimit: true,
            issuedToId: true,
            rules: true,
          },
        });
        const buyerRefusal = promotion
          ? await customerCouponRefusal(tx, promotion, {
              customerId: order.customerId,
              email: order.email,
              excludeOrderId: order.id,
            })
          : null;
        if (buyerRefusal) {
          reasons.push(`Coupon refused for this buyer at payment (${buyerRefusal}).`);
        }
        if (promotion?.perCustomerLimit !== null && promotion?.perCustomerLimit !== undefined) {
          const used = await tx.promotionUsage.count({
            where: {
              promotionId: promotion.id,
              OR: [
                ...(order.customerId ? [{ customerId: order.customerId }] : []),
                { order: { email: order.email } },
              ],
            },
          });
          if (used >= promotion.perCustomerLimit) {
            reasons.push('This customer had already used the coupon on this order.');
          }
        }
      }

      let status: OrderStatus = reasons.length > 0 ? OrderStatus.PAYMENT_REVIEW : OrderStatus.PAID;

      const moved = await tx.order.updateMany({
        where: { id: order.id, status: OrderStatus.PENDING_PAYMENT },
        data: { status, paidAt: new Date(), riskLevel },
      });
      if (moved.count !== 1) {
        // Somebody else applied this payment between the read and here.
        const current = await tx.order.findUniqueOrThrow({
          where: { id: order.id },
          select: { status: true },
        });
        return { status: current.status, alreadyApplied: true, consumed: 0 };
      }

      if (promotion) {
        await tx.promotionUsage.upsert({
          where: { promotionId_orderId: { promotionId: promotion.id, orderId: order.id } },
          update: {},
          create: {
            promotionId: promotion.id,
            orderId: order.id,
            customerId: order.customerId,
            discountUsd: order.discountUsd,
          },
        });
        // Conditional, so two payments landing together cannot both take the
        // last use of a capped code.
        const counted = await tx.promotion.updateMany({
          where: {
            id: promotion.id,
            ...(promotion.usageLimit !== null ? { usageCount: { lt: promotion.usageLimit } } : {}),
          },
          data: { usageCount: { increment: 1 } },
        });
        if (counted.count === 0 && status === OrderStatus.PAID) {
          status = OrderStatus.PAYMENT_REVIEW;
          reasons.push('The coupon reached its usage limit before this payment arrived.');
          await tx.order.update({ where: { id: order.id }, data: { status } });
        }
      }

      if (reasons.length > 0) {
        await tx.orderNote.create({
          data: {
            orderId: order.id,
            body: `Held for review: ${reasons.join(' ')}`,
            isCustomerVisible: false,
          },
        });
        this.logger.warn(`Order ${input.orderNumber} held for review: ${reasons.join(' ')}`);
      }

      const consumed = await consumeHolds(tx, { cartId: order.cartId, orderId: order.id });
      await sellUnheld(tx, { orderId: order.id, held: consumed.byVariant });
      // Counted on the transition only, which the compare-and-set above makes
      // exactly once per order.
      await countSale(tx, order.id, 1);

      if (order.cartId) {
        // RECOVERED only when a recovery email actually went to this cart
        // (not a held-out step), so the ladder is credited with the carts it
        // wrote to and nothing else.
        const emailed = await tx.cartRecoveryEvent.count({
          where: { cartId: order.cartId, heldOut: false },
        });
        await tx.cart.update({
          where: { id: order.cartId },
          data: {
            stage: emailed > 0 ? CartStage.RECOVERED : CartStage.CLOSED,
            recoveredOrderId: order.id,
          },
        });
      }

      await tx.customer.updateMany({
        where: { orders: { some: { id: order.id } } },
        data: { lastOrderAt: new Date(), orderCount: { increment: 1 } },
      });

      return { status, alreadyApplied: false, consumed: consumed.consumed };
    });
  }

  /** Records a card payment that failed, so the attempt is not invisible. */
  async markPaymentFailed(input: {
    providerRef: string;
    failureCode: string | null;
    failureMessage: string | null;
  }): Promise<void> {
    await this.prisma.client.payment.updateMany({
      where: {
        provider: PaymentProvider.STRIPE,
        providerRef: input.providerRef,
        state: { in: [PaymentState.PROCESSING, PaymentState.REQUIRES_ACTION] },
      },
      data: {
        state: PaymentState.FAILED,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
      },
    });
  }

  /**
   * Applies a refund Stripe reports.
   *
   * The order moves to REFUNDED or PARTIALLY_REFUNDED, which is enough to stop
   * anything not yet delivered: both delivery paths refuse an order that is
   * not PAID or FULFILLING. A key already sent cannot be recalled from here,
   * so the note says so and names the lines, for somebody to deactivate with
   * the supplier.
   */
  async applyRefund(input: {
    paymentIntentId: string;
    chargeId: string;
    amountRefundedMinor: number;
    amountMinor: number;
    fullyRefunded: boolean;
  }): Promise<void> {
    const payment = await this.prisma.client.payment.findFirst({
      where: { provider: PaymentProvider.STRIPE, providerRef: input.paymentIntentId },
      select: {
        id: true,
        orderId: true,
        amountUsd: true,
        order: { select: { items: { select: { skuSnapshot: true, deliveredAt: true } } } },
      },
    });
    if (!payment) {
      this.logger.warn(`Refund for unknown PaymentIntent ${input.paymentIntentId}`);
      return;
    }

    const fraction =
      input.amountMinor > 0
        ? input.amountRefundedMinor / input.amountMinor
        : input.fullyRefunded
          ? 1
          : 0;
    const refundedUsd = payment.amountUsd.times(fraction).toDecimalPlaces(2);
    const delivered = payment.order.items
      .filter((item) => item.deliveredAt !== null)
      .map((item) => item.skuSnapshot);

    await this.prisma.client.$transaction(async (tx) => {
      // One row per charge, updated as further partial refunds arrive, so a
      // replayed event cannot count the same money twice.
      const existing = await tx.refund.findFirst({
        where: { paymentId: payment.id, providerRef: input.chargeId },
        select: { id: true },
      });
      if (existing) {
        await tx.refund.update({ where: { id: existing.id }, data: { amountUsd: refundedUsd } });
      } else {
        await tx.refund.create({
          data: {
            paymentId: payment.id,
            amountUsd: refundedUsd,
            providerRef: input.chargeId,
            reason: 'Refunded in Stripe',
          },
        });
      }

      if (input.fullyRefunded) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { state: PaymentState.REFUNDED },
        });
      }
      // Conditional, so the sale is given back once however many refund
      // events arrive for the same order.
      const becameRefunded = input.fullyRefunded
        ? (
            await tx.order.updateMany({
              where: { id: payment.orderId, NOT: { status: OrderStatus.REFUNDED } },
              data: { status: OrderStatus.REFUNDED },
            })
          ).count === 1
        : false;
      if (!input.fullyRefunded) {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: OrderStatus.PARTIALLY_REFUNDED },
        });
      }
      if (becameRefunded) await countSale(tx, payment.orderId, -1);
      await tx.orderNote.create({
        data: {
          orderId: payment.orderId,
          body:
            `Refunded in Stripe (${input.fullyRefunded ? 'full' : 'partial'}).` +
            (delivered.length > 0
              ? ` Already delivered, deactivate with the supplier: ${delivered.join(', ')}.`
              : ' Nothing had been delivered.'),
          isCustomerVisible: false,
        },
      });
    });
  }

  /**
   * Refunds an order from the panel.
   *
   * A card payment is refunded through Stripe, and the order moves when
   * Stripe's `charge.refunded` webhook arrives — the same path a refund made
   * in Stripe's own dashboard takes, so the two cannot drift. A bank transfer
   * or crypto payment is returned outside this system; here it is recorded,
   * which is all this system can truthfully do.
   *
   * Either way the order stops being deliverable: PAID and FULFILLING are the
   * only states the delivery paths accept, and a refunded order is neither.
   */
  async refundOrder(input: {
    number: string;
    reason: string;
    staffId: string;
  }): Promise<{ status: OrderStatus; via: 'stripe' | 'recorded' }> {
    const order = await this.prisma.client.order.findUnique({
      where: { number: input.number },
      select: {
        id: true,
        status: true,
        payments: {
          where: { state: PaymentState.SUCCEEDED },
          select: { id: true, provider: true, providerRef: true, amountUsd: true },
        },
      },
    });
    if (!order) throw new NotFoundException(`No order ${input.number}`);

    const refundable: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.PAYMENT_REVIEW,
      OrderStatus.FULFILLING,
      OrderStatus.FULFILLED,
      OrderStatus.COMPLETED,
      OrderStatus.PARTIALLY_REFUNDED,
    ];
    if (!refundable.includes(order.status)) {
      throw new BadRequestException(
        `Order ${input.number} is ${order.status}; there is nothing to refund.`,
      );
    }
    const payment = order.payments[0];
    if (!payment) throw new BadRequestException(`Order ${input.number} has no succeeded payment.`);

    await this.prisma.client.orderNote.create({
      data: {
        orderId: order.id,
        authorId: input.staffId || null,
        body: `Refund requested: ${input.reason}`,
        isCustomerVisible: false,
      },
    });

    if (payment.provider === PaymentProvider.STRIPE && payment.providerRef) {
      await this.stripe.refundIntent(payment.providerRef, input.number);
      return { status: order.status, via: 'stripe' };
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountUsd: payment.amountUsd,
          reason: input.reason,
          createdById: input.staffId || null,
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: { state: PaymentState.REFUNDED },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.REFUNDED },
      });
      await countSale(tx, order.id, -1);
    });
    return { status: OrderStatus.REFUNDED, via: 'recorded' };
  }

  /**
   * Applies a dispute Stripe reports.
   *
   * The order is blocked rather than refunded — a dispute can still be won —
   * and BLOCKED is what both delivery paths refuse, so no further key leaves
   * while it is open.
   */
  async applyDispute(input: { paymentIntentId: string; reason: string }): Promise<void> {
    const payment = await this.prisma.client.payment.findFirst({
      where: { provider: PaymentProvider.STRIPE, providerRef: input.paymentIntentId },
      select: { orderId: true },
    });
    if (!payment) {
      this.logger.warn(`Dispute for unknown PaymentIntent ${input.paymentIntentId}`);
      return;
    }
    await this.prisma.client.$transaction([
      this.prisma.client.order.update({
        where: { id: payment.orderId },
        data: { riskLevel: RiskLevel.BLOCKED },
      }),
      this.prisma.client.orderNote.create({
        data: {
          orderId: payment.orderId,
          body: `Card dispute opened in Stripe (${input.reason}). Delivery is blocked until it is resolved.`,
          isCustomerVisible: false,
        },
      }),
    ]);
  }

  // --- webhook log ----------------------------------------------------------

  /**
   * Records a provider event before acting on it.
   *
   * The row is the idempotency record and the retry ledger. An event already
   * processed is answered without doing anything; one that failed before is
   * processed again, which is what makes a Stripe retry worth receiving — the
   * old path skipped fulfilment on every retry, because the first attempt had
   * already moved the order.
   *
   * The payload is kept to ids. The full event carries the customer's email
   * and card details, and none of that is needed to replay the work.
   */
  async beginWebhook(input: {
    provider: PaymentProvider;
    eventId: string;
    type: string;
    payload: Prisma.InputJsonValue;
  }): Promise<{ id: string; processed: boolean }> {
    const row = await this.prisma.client.webhookEvent.upsert({
      where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
      update: { attempts: { increment: 1 } },
      create: {
        provider: input.provider,
        eventId: input.eventId,
        type: input.type,
        payload: input.payload,
        signatureVerified: true,
        attempts: 1,
      },
      select: { id: true, processedAt: true },
    });
    return { id: row.id, processed: row.processedAt !== null };
  }

  async finishWebhook(id: string, error?: unknown): Promise<void> {
    await this.prisma.client.webhookEvent.update({
      where: { id },
      data: error
        ? { error: error instanceof Error ? error.message.slice(0, 1000) : 'unknown' }
        : { processedAt: new Date(), error: null },
    });
  }

  // --- reading --------------------------------------------------------------

  /**
   * One order, by its number — for whoever placed it.
   *
   * `cartToken` is not optional in practice. Order numbers are sequential by
   * design, so DA-2026-00001 tells a guesser that DA-2026-00002 exists; with
   * no check the confirmation route hands any passer-by somebody else's email,
   * items and total by counting upwards. The cart that placed the order is the
   * proof of ownership a guest has, and guest checkout is most of this store.
   *
   * `skipOwnerCheck` is for a caller that has already established who is
   * asking — the checkout, rendering an order it just drafted.
   */
  async renderOrder(
    number: string,
    query: CartQuery,
    access?: {
      cartToken?: string | undefined;
      customerId?: string | undefined;
      skipOwnerCheck?: boolean;
    },
  ): Promise<Order> {
    const order = await this.prisma.client.order.findUnique({
      where: { number },
      include: {
        cart: { select: { token: true } },
        items: {
          include: {
            variant: {
              select: {
                credentialKind: true,
                product: {
                  select: {
                    slug: true,
                    // The order's own locale, with the other as the fallback:
                    // a store that has written the steps in Arabic only should
                    // still show them to an English order rather than nothing.
                    translations: { select: { locale: true, activationSteps: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) throw new NotFoundException(`لا يوجد طلب بالرقم ${number}`);

    if (access?.skipOwnerCheck !== true) {
      const token = access?.cartToken;
      const byCart = Boolean(token) && order.cart?.token === token;
      const byCustomer = Boolean(access?.customerId) && order.customerId === access?.customerId;
      if (!byCart && !byCustomer) {
        // The same answer as a missing order, deliberately. Telling a guesser
        // that DA-2026-00042 exists but is not theirs still tells them how
        // many orders the store has taken.
        throw new NotFoundException(`لا يوجد طلب بالرقم ${number}`);
      }
    }

    // In the order's own currency, at the rate frozen onto it — the money it
    // is paid in, not whatever `?currency=` the page asked for today. The
    // confirmation page, the email and the card form must show one figure.
    const currencyRow =
      order.currency === 'USD'
        ? null
        : await this.prisma.client.currency.findUnique({
            where: { code: order.currency },
            select: { decimals: true, roundingRule: true },
          });
    const orderCurrency = currencyRow ? order.currency : 'USD';
    const fx: FxTable = currencyRow
      ? { [order.currency]: { rate: order.fxRate, ...currencyRow } }
      : {};
    const price = (usd: Prisma.Decimal) => displayPrice(usd, null, orderCurrency, fx);

    return {
      number: order.number,
      status: order.status,
      email: order.email,
      activationEmail: order.activationEmail,
      locale: order.locale === Locale.EN ? 'en' : 'ar',
      currency: orderCurrency,
      lines: order.items.map((item) => ({
        sku: item.skuSnapshot,
        productName: item.productNameSnapshot,
        productSlug: item.variant.product.slug,
        qty: item.qty,
        unitPrice: price(item.unitPriceUsd),
        lineTotal: price(item.lineTotalUsd),
        fulfillmentState: item.fulfillmentState,
        credentialKind: item.variant.credentialKind,
        activationSteps: parseActivationSteps(
          (
            item.variant.product.translations.find((entry) => entry.locale === order.locale) ??
            item.variant.product.translations[0]
          )?.activationSteps,
        ),
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
