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
    // Bounded, and retried by the SDK itself on network errors with the same
    // idempotency key — so a blip costs a retry, not a stuck checkout or a
    // webhook that outlives Stripe's patience.
    this.client = new Stripe(key, { timeout: 15_000, maxNetworkRetries: 2 });
    return this.client;
  }

  get configured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
  }

  get publishableKey(): string {
    return process.env.STRIPE_PUBLISHABLE_KEY ?? '';
  }

  /**
   * Whether a card payment can be finished, not merely started.
   *
   * Both keys, because they fail at different ends. The secret alone opens a
   * PaymentIntent the browser has nothing to confirm it with, which is the dead
   * end this checkout already had: a button, a client secret, and no card form.
   */
  get payable(): boolean {
    return this.configured && this.publishableKey !== '';
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
      // Same order and same amount, same intent, however many times the page
      // is refreshed. The amount is part of the key because the order is a
      // draft until it is paid: a shopper who goes back and changes the cart
      // needs a new intent at the new price, and reusing the key with a
      // different amount is an error from Stripe rather than a charge.
      {
        idempotencyKey: `order:${input.orderNumber}:${String(input.amountMinor)}:${input.currency.toUpperCase()}`,
      },
    );

    if (!intent.client_secret) {
      throw new BadRequestException('Stripe did not return a client secret.');
    }
    return { clientSecret: intent.client_secret, id: intent.id };
  }

  /**
   * Cancels an intent that no longer matches its order.
   *
   * Best effort by design. An intent that has already succeeded or been
   * cancelled refuses, and that is fine: the webhook compares what was taken
   * against the order in any case, so a stale intent that slips through lands
   * in review rather than releasing a key.
   */
  async cancelIntent(id: string): Promise<boolean> {
    try {
      await this.stripe().paymentIntents.cancel(id);
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not cancel PaymentIntent ${id}: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return false;
    }
  }

  /**
   * Refunds a succeeded intent in full.
   *
   * Keyed on the intent, so a double click refunds once. The order itself is
   * moved by the `charge.refunded` webhook this triggers — one path for a
   * refund made here and one made in Stripe's dashboard.
   */
  async refundIntent(intentId: string, orderNumber: string): Promise<string> {
    const refund = await this.stripe().refunds.create(
      {
        payment_intent: intentId,
        reason: 'requested_by_customer',
        metadata: { orderNumber },
      },
      { idempotencyKey: `refund:${intentId}` },
    );
    return refund.id;
  }

  /**
   * Radar's risk level for the charge behind an intent.
   *
   * The webhook's intent carries only the charge id, so the charge is fetched.
   * A failure here throws, and the webhook answers non-2xx so Stripe retries:
   * releasing a key without the fraud verdict is the one outcome to avoid.
   */
  async riskLevelOf(intent: Stripe.PaymentIntent): Promise<string | null> {
    const charge = intent.latest_charge;
    if (!charge) return null;
    const resolved =
      typeof charge === 'string' ? await this.stripe().charges.retrieve(charge) : charge;
    return resolved.outcome?.risk_level ?? null;
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
