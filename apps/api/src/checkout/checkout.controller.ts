import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type CartQuery,
  type Checkout,
  type CheckoutStart,
  type OfferedPayment,
  type Order,
  type PaymentInstructions,
  ROUTES,
  type PaymentSession,
  cartQuerySchema,
  checkoutStartSchema,
  startPaymentSchema,
} from '@da/contracts';
import { PaymentProvider } from '@da/db';
import type { FastifyRequest } from 'fastify';
import type Stripe from 'stripe';
import { z } from 'zod';

import { orderLink, verifyOrderAccessKey } from '../common/order-link.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AccountService } from '../account/account.service.js';

import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { MailService } from '../mail/mail.service.js';
import { transferInstructions } from '../mail/templates.js';

import { riskFromStripe } from './charge.js';
import { CheckoutService } from './checkout.service.js';
import { PaymentSettingsService } from './payment-settings.service.js';
import { fromMinorUnits, StripeService, toMinorUnits } from './stripe.service.js';

@ApiTags('checkout')
@Controller()
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly stripe: StripeService,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly fulfillment: FulfillmentService,
    private readonly mail: MailService,
    private readonly account: AccountService,
  ) {}

  /**
   * What the shop can take money with, for pages with no checkout session.
   *
   * Providers only — never the bank details behind a manual method — so it is
   * safe unauthenticated. The product page and the cart draw payment marks from
   * this rather than from a hard-coded list, because a mark for a method the
   * shop cannot take is a promise made to somebody about to type a card number.
   */
  @Get('payment-methods')
  @ApiOperation({ summary: 'Payment providers the shop can currently take' })
  async offeredPayment(): Promise<OfferedPayment> {
    return { providers: await this.paymentSettings.offeredProviders() };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('checkout')
  @ApiOperation({ summary: 'Capture the email and draft the order' })
  async start(
    @Body(new ZodPipe(checkoutStartSchema)) body: CheckoutStart,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: FastifyRequest,
  ): Promise<Checkout> {
    const token = request.cookies?.da_cart;
    if (!token) throw new BadRequestException('لا توجد سلة.');
    return this.checkout.start(token, body, query, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  /**
   * One order, for whoever can show it is theirs.
   *
   * Three proofs, any one of which will do: the cart cookie of the browser
   * that placed it, the signed-in customer it belongs to, or the key carried
   * in the link the order emails send. The last two are what make that link
   * work on a phone, or a day later — before, only the first counted, and the
   * page with the licence on it answered 404 from anywhere else.
   */
  @Get('orders/:number')
  @ApiOperation({ summary: 'One order, for the cart, customer or emailed link that owns it' })
  async order(
    @Param('number') number: string,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Query('key') key: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<Order> {
    if (verifyOrderAccessKey(number, key)) {
      return this.checkout.renderOrder(number, query, { skipOwnerCheck: true });
    }
    const session = await this.account.sessionFor(request.cookies?.da_customer);
    return this.checkout.renderOrder(number, query, {
      cartToken: request.cookies?.da_cart,
      customerId: session?.customerId,
    });
  }

  /**
   * Opens a payment session for an order.
   *
   * The amount comes off the order row, never from the request. An amount the
   * client can name is an amount the client can change, and this is the one
   * number where that is not survivable.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('orders/:number/pay')
  @ApiOperation({ summary: 'Start a payment for an order' })
  async pay(
    @Param('number') number: string,
    @Body(new ZodPipe(startPaymentSchema)) body: z.infer<typeof startPaymentSchema>,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: FastifyRequest,
  ): Promise<PaymentSession> {
    const order = await this.checkout.renderOrder(number, query, {
      cartToken: request.cookies?.da_cart,
    });
    if (order.status !== 'PENDING_PAYMENT') {
      throw new BadRequestException('هذا الطلب لم يعد في انتظار الدفع.');
    }

    if (body.provider === 'STRIPE') {
      // Refused here rather than after the intent exists. Creating a payment
      // the browser has no publishable key to confirm leaves an open intent on
      // an order nobody can pay, and the shopper still ends up at a dead end.
      if (!this.stripe.payable) {
        throw new ServiceUnavailableException('الدفع بالبطاقة غير مهيّأ بعد.');
      }

      // From the order row: its currency and the rate frozen onto it at
      // checkout, never this request's `?currency=` or today's rate.
      const charge = await this.checkout.chargeForNumber(order.number);
      const intent = await this.stripe.intentFor({
        orderNumber: order.number,
        amountMinor: toMinorUnits(charge.amount, charge.currency),
        currency: charge.currency,
        email: order.email,
      });
      await this.checkout.recordOpenIntent({
        orderNumber: order.number,
        intentId: intent.id,
        amount: charge.amount,
        currency: charge.currency,
      });
      return {
        provider: 'STRIPE',
        clientSecret: intent.clientSecret,
        publishableKey: this.stripe.publishableKey,
        amount: { ...order.total, amount: charge.amount, currency: charge.currency },
      };
    }

    if (body.provider === 'BANK_TRANSFER' || body.provider === 'CRYPTO') {
      // Still not invented here. Bank details and wallet addresses are content
      // the owner maintains in the panel, and a hardcoded placeholder is how
      // money ends up in the wrong account — so an unfilled method is refused
      // outright rather than answered with a sentence and no account number.
      const instructions = await this.paymentSettings.instructionsFor(body.provider, order.locale);
      if (!instructions) {
        throw new ServiceUnavailableException('طريقة الدفع هذه غير متاحة حالياً.');
      }

      /**
       * The same details, in an email.
       *
       * Nobody does a bank transfer from the checkout page. They do it later,
       * from a banking app, and until this existed the account number appeared
       * on one screen once — `order.received` is sent when the money arrives,
       * which for a manual method is after the owner confirms it, so between
       * placing the order and paying for it the customer had nothing at all.
       *
       * Sent once per order, and never awaited into the response: a shopper
       * looking at the instructions on screen should not wait on SMTP, and a
       * mail server that is down must not take the checkout down with it. The
       * attempt is recorded either way, which is what makes "did they ever get
       * the account number" answerable.
       */
      void this.sendTransferInstructions(order, instructions);

      return { provider: body.provider, instructions, amount: order.total };
    }

    // PayPal has its own order/capture dance and its own webhook shape. It is
    // the agreed second provider and it is not wired yet; a stub returning a
    // dead URL would look like a working button.
    throw new ServiceUnavailableException('PayPal لم يُربط بعد. استخدم البطاقة حالياً.');
  }

  private async sendTransferInstructions(
    order: Order,
    instructions: PaymentInstructions,
  ): Promise<void> {
    try {
      const template = 'order.transfer-instructions';
      if (await this.mail.alreadySent({ template, to: order.email, orderNumber: order.number })) {
        return;
      }

      const locale = order.locale === 'en' ? 'en' : 'ar';
      await this.mail.send({
        to: order.email,
        template,
        locale,
        rendered: transferInstructions({
          locale,
          orderNumber: order.number,
          total: `${order.total.amount} ${order.total.currency}`,
          headline: instructions.headline,
          // Label and value only. `copyable` is a rendering hint for the page;
          // in an email every value is text somebody selects anyway.
          fields: instructions.fields.map((field) => ({
            label: field.label,
            value: field.value,
          })),
          afterPaying: instructions.afterPaying,
          /*
           * What the money is for.
           *
           * `supplyNote` is empty here on purpose: this email is sent before
           * payment, and "ordered from the supplier after purchase" is a
           * promise about a sale that has not happened yet. `order.received`
           * says it, once the money has actually arrived.
           */
          lines: order.lines.map((line) => ({
            productName: line.productName,
            sku: line.sku,
            qty: line.qty,
            lineTotal: `${line.lineTotal.amount} ${line.lineTotal.currency}`,
            supplyNote: '',
          })),
          // In the order's language and carrying its key: this email is read
          // later, from a banking app or another device, where the cart cookie
          // that placed the order is not.
          orderUrl: orderLink(
            process.env.STOREFRONT_URL ??
              process.env.NEXT_PUBLIC_SITE_URL ??
              'http://localhost:3000',
            `${order.locale === 'en' ? '/en' : ''}${ROUTES.order(encodeURIComponent(order.number))}`,
            order.number,
          ),
        }),
        // Never the account details: the log answers whether we tried, and the
        // message itself is where the numbers belong.
        payload: { orderNumber: order.number, fields: instructions.fields.length },
      });
    } catch {
      // A failed send must not fail the payment step. The shopper still has the
      // instructions on screen, and the absent log row is the record that this
      // did not reach them.
    }
  }

  /**
   * Stripe webhook.
   *
   * The signature is verified against the raw bytes Stripe sent, which is why
   * `rawBody` is enabled on the Fastify adapter — re-serialised JSON does not
   * verify. There is no path through here that skips it: an unverified webhook
   * is an open endpoint for marking any order paid.
   *
   * Not throttled. Stripe retries on a non-2xx, so rate limiting it would turn
   * a burst into a retry storm and, eventually, a paid order stuck unpaid.
   */
  @Post('webhooks/stripe')
  @ApiOperation({ summary: 'Stripe payment events' })
  async stripeWebhook(
    @Req() request: FastifyRequest & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const raw = request.rawBody;
    if (!raw) throw new BadRequestException('Raw body unavailable.');

    const event = this.stripe.constructEvent(raw, signature);

    const object = event.data.object as { id?: string; metadata?: Record<string, string> };
    const logged = await this.checkout.beginWebhook({
      provider: PaymentProvider.STRIPE,
      eventId: event.id,
      type: event.type,
      payload: { objectId: object.id ?? null, orderNumber: object.metadata?.orderNumber ?? null },
    });
    if (logged.processed) return { received: true };

    try {
      await this.handleStripeEvent(event);
      await this.checkout.finishWebhook(logged.id);
    } catch (error) {
      // Recorded, then rethrown: the non-2xx is what makes Stripe deliver the
      // event again, and the unprocessed row is what makes the next delivery
      // do the work instead of skipping it.
      await this.checkout.finishWebhook(logged.id, error);
      throw error;
    }

    // Anything else is acknowledged rather than acted on. Returning a non-2xx
    // for an event we do not handle makes Stripe retry it forever.
    return { received: true };
  }

  private async handleStripeEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        // Narrowed by the event type already; the union discriminates itself.
        const intent = event.data.object;
        const orderNumber = intent.metadata.orderNumber;
        if (!orderNumber) return;

        const applied = await this.checkout.markPaid({
          orderNumber,
          provider: 'STRIPE',
          providerRef: intent.id,
          amountCharged: fromMinorUnits(intent.amount_received, intent.currency),
          chargedCurrency: intent.currency.toUpperCase(),
          amountMinor: intent.amount_received,
          riskLevel: riskFromStripe(await this.stripe.riskLevelOf(intent)),
        });

        // Run on every delivery that reaches here, not only the one that moved
        // the order. Fulfilment is idempotent by line state and refuses
        // anything but PAID; the old "only if not already applied" meant a
        // failure after payment was recorded was never retried at all.
        if (applied.status === 'PAID') {
          await this.fulfillment.onOrderPaid(orderNumber);
        }
        return;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        await this.checkout.markPaymentFailed({
          providerRef: intent.id,
          failureCode: intent.last_payment_error?.code ?? null,
          failureMessage: intent.last_payment_error?.message ?? null,
        });
        return;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const intentId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : (charge.payment_intent?.id ?? null);
        if (!intentId) return;
        await this.checkout.applyRefund({
          paymentIntentId: intentId,
          chargeId: charge.id,
          amountRefundedMinor: charge.amount_refunded,
          amountMinor: charge.amount,
          fullyRefunded: charge.refunded,
        });
        return;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const intentId =
          typeof dispute.payment_intent === 'string'
            ? dispute.payment_intent
            : (dispute.payment_intent?.id ?? null);
        if (!intentId) return;
        await this.checkout.applyDispute({ paymentIntentId: intentId, reason: dispute.reason });
        return;
      }

      default:
        return;
    }
  }
}
