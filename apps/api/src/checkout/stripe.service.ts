import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Stripe from 'stripe';

/**
 * Stripe.
 *
 * Two decisions worth stating.
 *
 * The client is constructed lazily and its absence is a 503, not a boot
 * failure. The catalog, the cart and the admin all work without payment keys,
 * and refusing to start the whole API because a Stripe secret is missing would
 * make the store unbrowsable over a credential it does not need to browse.
 *
 * The amount charged is derived on the server from the order row, never taken
 * from the request. An amount the client can name is an amount the client can
 * change, and this is the one number where that matters.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private client: Stripe | undefined;

  private stripe(): Stripe {
    if (this.client) return this.client;

    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new ServiceUnavailableException('الدفع بالبطاقة غير مهيّأ بعد. أضف STRIPE_SECRET_KEY.');
    }
    this.client = new Stripe(key);
    return this.client;
  }

  get configured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  }

  get publishableKey(): string {
    return process.env.STRIPE_PUBLISHABLE_KEY ?? '';
  }

  /**
   * Creates or reuses a PaymentIntent for one order.
   *
   * Keyed on the order number, so a shopper refreshing the payment page or
   * clicking twice gets the same intent rather than a second one — two open
   * intents on one order is how a double charge starts.
   *
   * `zeroDecimal` handling matters: Stripe wants the smallest currency unit,
   * which is 1/100 for USD and AED but 1/1 for JPY and KWD-style currencies.
   * Multiplying by 100 unconditionally overcharges by a hundred times.
   */
  async intentFor(input: {
    orderNumber: string;
    amountMinor: number;
    currency: string;
    email: string;
  }): Promise<{ clientSecret: string; id: string }> {
    const stripe = this.stripe();

    const intent = await stripe.paymentIntents.create(
      {
        amount: input.amountMinor,
        currency: input.currency.toLowerCase(),
        receipt_email: input.email,
        // The order number is the join back to our side, and it is what the
        // webhook reads. Without it a succeeded payment cannot be matched.
        metadata: { orderNumber: input.orderNumber },
        automatic_payment_methods: { enabled: true },
      },
      // Same order, same intent, however many times the page is refreshed.
      { idempotencyKey: `order:${input.orderNumber}` },
    );

    if (!intent.client_secret) {
      throw new BadRequestException('Stripe did not return a client secret.');
    }
    return { clientSecret: intent.client_secret, id: intent.id };
  }

  /**
   * Verifies a webhook signature and returns the event.
   *
   * The raw body is required — parsed-and-restringified JSON does not verify,
   * because the signature covers the exact bytes Stripe sent. An unverified
   * webhook is an open endpoint for marking any order paid, so there is no
   * path through here that skips this.
   */
  constructEvent(rawBody: Buffer | string, signature: string | undefined): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET is not set.');
    }
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header.');
    }

    try {
      return this.stripe().webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      this.logger.warn(
        `Rejected a Stripe webhook: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw new BadRequestException('Invalid webhook signature.');
    }
  }
}

/**
 * Currencies Stripe counts in whole units rather than hundredths.
 *
 * The list is short and stable enough to hold here; getting it wrong in either
 * direction is a hundred-fold error on a real charge.
 */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/** Currencies Stripe counts in thousandths, and requires to end in 0. */
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** Converts Stripe's smallest currency unit back into a decimal string. */
export function fromMinorUnits(minor: number, currency: string): string {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL.has(code)) return String(minor);
  if (THREE_DECIMAL.has(code)) return (minor / 1000).toFixed(3);
  return (minor / 100).toFixed(2);
}

/** Converts a decimal amount string into Stripe's smallest currency unit. */
export function toMinorUnits(amount: string, currency: string): number {
  const code = currency.toUpperCase();
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    throw new BadRequestException(`Cannot charge "${amount}".`);
  }

  if (ZERO_DECIMAL.has(code)) return Math.round(value);
  if (THREE_DECIMAL.has(code)) {
    // Stripe requires the last digit to be zero for these.
    return Math.round((value * 1000) / 10) * 10;
  }
  return Math.round(value * 100);
}
