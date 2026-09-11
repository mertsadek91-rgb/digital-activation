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
  type Order,
  type PaymentSession,
  cartQuerySchema,
  checkoutStartSchema,
  startPaymentSchema,
} from '@da/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ZodPipe } from '../common/zod.pipe.js';

import { FulfillmentService } from '../fulfillment/fulfillment.service.js';

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
  ) {}

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

  @Get('orders/:number')
  @ApiOperation({ summary: 'One order, for the cart that placed it' })
  order(
    @Param('number') number: string,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: FastifyRequest,
  ): Promise<Order> {
    return this.checkout.renderOrder(number, query, { cartToken: request.cookies?.da_cart });
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

      const intent = await this.stripe.intentFor({
        orderNumber: order.number,
        amountMinor: toMinorUnits(order.total.amount, order.total.currency),
        currency: order.total.currency,
        email: order.email,
      });
      return {
        provider: 'STRIPE',
        clientSecret: intent.clientSecret,
        publishableKey: this.stripe.publishableKey,
        amount: order.total,
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

      return { provider: body.provider, instructions, amount: order.total };
    }

    // PayPal has its own order/capture dance and its own webhook shape. It is
    // the agreed second provider and it is not wired yet; a stub returning a
    // dead URL would look like a working button.
    throw new ServiceUnavailableException('PayPal لم يُربط بعد. استخدم البطاقة حالياً.');
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

    if (event.type === 'payment_intent.succeeded') {
      // Narrowed by the event type already; the union discriminates itself.
      const intent = event.data.object;
      const orderNumber = intent.metadata.orderNumber;
      if (orderNumber) {
        const applied = await this.checkout.markPaid({
          orderNumber,
          provider: 'STRIPE',
          providerRef: intent.id,
          amountCharged: fromMinorUnits(intent.amount_received, intent.currency),
          chargedCurrency: intent.currency.toUpperCase(),
        });

        // Fulfilment runs only on the delivery that actually moved the order.
        // It is idempotent anyway, but running it on a replay would write a
        // second set of queue transitions for no reason.
        if (!applied.alreadyApplied) {
          await this.fulfillment.onOrderPaid(orderNumber);
        }
      }
    }

    // Anything else is acknowledged rather than acted on. Returning a non-2xx
    // for an event we do not handle makes Stripe retry it forever.
    return { received: true };
  }
}
