import { z } from 'zod';

import { cartSchema } from './cart.js';
import { catalogImageSchema, displayPriceSchema } from './catalog.js';
import { localeSchema, slugSchema } from './primitives.js';

/**
 * Checkout contracts.
 *
 * The order of events matters more than the shapes. An email is captured
 * before payment, because the presence of an email is what turns an abandoned
 * cart into one that can be recovered — and a cart abandoned at the payment
 * step is the most valuable one there is.
 *
 * Nothing is delivered here. Payment succeeding moves the order to PAID and
 * consumes the stock hold; releasing a licence key is a separate step behind
 * the fraud check, because a digital key cannot be clawed back once sent.
 */

export const checkoutStartSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  /** Optional at this step. A guest can buy without naming themselves. */
  name: z.string().trim().max(120).optional(),
  company: z.string().trim().max(160).optional(),
  vatNumber: z.string().trim().max(40).optional(),
  /** ISO-3166 alpha-2. Drives VAT treatment on GCC and EU sales. */
  country: z.string().trim().length(2).toUpperCase().optional(),
  /**
   * The address a licence should be activated against.
   *
   * Required when any line in the cart binds to one, and asked for separately
   * from the order email because they are often different: people order from a
   * work address and want the licence on a personal Microsoft account. The
   * server refuses the checkout rather than guessing, because guessing produces
   * a key nobody can use and a supplier order that cannot be reversed.
   */
  activationEmail: z.string().trim().toLowerCase().email().max(200).optional(),
  /** Marketing consent is asked for separately and defaults to no. */
  marketingOptIn: z.boolean().default(false),
});
export type CheckoutStart = z.infer<typeof checkoutStartSchema>;

/**
 * A cross-sell offered at checkout.
 *
 * Priced as a saving on the pair, not as a discount on the add-on alone, so
 * the number the shopper sees is the number they actually save by buying both.
 */
export const crossSellSchema = z.object({
  variantId: z.string(),
  sku: z.string(),
  productSlug: slugSchema,
  productName: z.string(),
  image: catalogImageSchema.nullable(),
  price: displayPriceSchema,
  /** What this add-on costs when bought together. */
  bundlePrice: displayPriceSchema,
  savePercent: z.number().int().min(1).max(90),
  /** The promotion that will apply it, so the order records what was used. */
  promotionCode: z.string(),
});
export type CrossSell = z.infer<typeof crossSellSchema>;

export const orderStatusSchema = z.enum([
  'PENDING_PAYMENT',
  'PAYMENT_REVIEW',
  'PAID',
  'FULFILLING',
  'FULFILLED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'FAILED',
]);

export const orderLineSchema = z.object({
  sku: z.string(),
  productName: z.string(),
  productSlug: slugSchema.nullable(),
  qty: z.number().int().min(1),
  unitPrice: displayPriceSchema,
  lineTotal: displayPriceSchema,
  fulfillmentState: z.enum(['PENDING', 'AUTO_ASSIGNED', 'MANUAL_QUEUE', 'DELIVERED', 'FAILED']),
});

export const orderSchema = z.object({
  number: z.string(),
  status: orderStatusSchema,
  email: z.string(),
  /** Set only when a line binds the licence to an address. */
  activationEmail: z.string().nullable(),
  locale: localeSchema,
  currency: z.string().length(3),

  lines: z.array(orderLineSchema),
  subtotal: displayPriceSchema,
  discount: displayPriceSchema,
  tax: displayPriceSchema,
  total: displayPriceSchema,

  couponCode: z.string().nullable(),
  placedAt: z.string(),
  paidAt: z.string().nullable(),
});
export type Order = z.infer<typeof orderSchema>;

export const checkoutSchema = z.object({
  order: orderSchema,
  cart: cartSchema,
  crossSell: z.array(crossSellSchema),
  /** True when the cart needs an activation email, so the form can ask. */
  activationEmailRequired: z.boolean(),
});
export type Checkout = z.infer<typeof checkoutSchema>;

// --- payment ----------------------------------------------------------------

export const paymentProviderSchema = z.enum(['STRIPE', 'PAYPAL', 'BANK_TRANSFER', 'CRYPTO']);

export const startPaymentSchema = z.object({
  provider: paymentProviderSchema,
});

/**
 * What the storefront needs to hand over to the provider.
 *
 * A discriminated union rather than a bag of optional fields: Stripe needs a
 * client secret to confirm in the page, PayPal needs a URL to send the shopper
 * to, and a manual method needs instructions to display. Collapsing those into
 * one optional-everything object is how a checkout ends up rendering a blank
 * payment step.
 */
export const paymentSessionSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('STRIPE'),
    clientSecret: z.string(),
    publishableKey: z.string(),
    amount: displayPriceSchema,
  }),
  z.object({
    provider: z.literal('PAYPAL'),
    approveUrl: z.string(),
    providerOrderId: z.string(),
    amount: displayPriceSchema,
  }),
  z.object({
    provider: z.enum(['BANK_TRANSFER', 'CRYPTO']),
    /** Shown to the shopper; the order waits for a human to approve proof. */
    instructions: z.string(),
    amount: displayPriceSchema,
  }),
]);
export type PaymentSession = z.infer<typeof paymentSessionSchema>;

/**
 * Below this, a cross-sell is not worth the interruption.
 *
 * A checkout page that asks a question earns its keep or gets in the way, and
 * an add-on saving 3% is in the way.
 */
export const CROSS_SELL_MIN_SAVE_PERCENT = 5;
/** More than three choices at the payment step is a delay, not an upsell. */
export const CROSS_SELL_MAX = 3;
