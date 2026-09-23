import { z } from 'zod';

import { cartSchema } from './cart.js';
import { catalogImageSchema, credentialKindSchema, displayPriceSchema } from './catalog.js';
import { i18nStringSchema, localeSchema, slugSchema } from './primitives.js';
import { normalizeWhatsappPhone } from './whatsapp.js';

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

export const checkoutStartSchema = z
  .object({
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
    /**
     * A number for WhatsApp, as typed. Read against `country` when it is in a
     * local format and normalised to E.164 below; anything that is not a mobile
     * number is refused rather than stored, because a wrong number here is a
     * stranger receiving somebody's cart.
     */
    whatsappPhone: z.string().trim().max(32).optional(),
    /** WhatsApp consent: a channel of its own, asked for separately, default no. */
    whatsappOptIn: z.boolean().default(false),
  })
  .transform((value, ctx) => {
    const typed = value.whatsappPhone ?? '';
    if (typed === '') {
      if (value.whatsappOptIn) {
        ctx.addIssue({
          code: 'custom',
          path: ['whatsappPhone'],
          message:
            'اكتب رقم واتساب لتصلك الرسائل عليه — Enter a WhatsApp number to get messages there.',
        });
        return z.NEVER;
      }
      return { ...value, whatsappPhone: undefined };
    }
    const whatsappPhone = normalizeWhatsappPhone(typed, value.country);
    if (!whatsappPhone) {
      ctx.addIssue({
        code: 'custom',
        path: ['whatsappPhone'],
        message: 'رقم واتساب غير صالح — Enter a valid WhatsApp mobile number.',
      });
      return z.NEVER;
    }
    return { ...value, whatsappPhone };
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

  /**
   * Whether this line arrives as a key or as an account, so the page can say
   * what to expect in the inbox instead of the customer finding out.
   */
  credentialKind: credentialKindSchema,

  /**
   * The activation how-to, in the order's own locale.
   *
   * The same lines the licence email carries. A customer who lost the email —
   * or read it on a phone and is now at the machine they are activating —
   * needs the steps without writing in for them. The licence itself is not
   * here: it is in the email and in the vault, and an order page reachable
   * with a cart cookie is not where a key belongs.
   */
  activationSteps: z.array(z.string()),
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

// --- payment ----------------------------------------------------------------

export const paymentProviderSchema = z.enum(['STRIPE', 'PAYPAL', 'BANK_TRANSFER', 'CRYPTO']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

/**
 * What the shop can actually take money with, for any page that wants to say so.
 *
 * Carries providers and nothing else — no bank account, no key, no field the
 * manual methods hold — so it is safe to serve to anybody, which is the point:
 * it is read by the product page, the cart and the footer, none of which have a
 * checkout session to ask.
 *
 * It exists because a payment badge is a promise. The product page, the cart
 * and the checkout all grew a row of mada, Apple Pay, Visa and Mastercard marks
 * while the store had no payment method configured at all — on the checkout
 * page the badges sat directly beneath the sentence "لا توجد طريقة دفع متاحة
 * الآن", contradicting it. A mark appears here only when the method behind it
 * can take an order.
 */
export const offeredPaymentSchema = z.object({
  providers: z.array(paymentProviderSchema),
});
export type OfferedPayment = z.infer<typeof offeredPaymentSchema>;

/**
 * The methods whose details a person maintains rather than an integration.
 *
 * A bank account and a wallet address are content, and content nobody has
 * written yet is why this pair is modelled apart from the providers that
 * configure themselves out of environment variables.
 */
export const manualPaymentProviderSchema = z.enum(['BANK_TRANSFER', 'CRYPTO']);
export type ManualPaymentProvider = z.infer<typeof manualPaymentProviderSchema>;

export const startPaymentSchema = z.object({
  provider: paymentProviderSchema,
});

/**
 * One line of a manual payment instruction — an IBAN, a wallet address, the
 * name the account is held in.
 *
 * `copyable` separates the values that must be reproduced exactly from the ones
 * that only have to be read. A transposed digit in an IBAN sends the money to
 * nobody and support cannot get it back, so those get a copy button and a
 * monospace face; "Emirates NBD, Deira branch" needs neither.
 */
export const paymentDetailSchema = z.object({
  /** Already resolved to the shopper's locale by the API. */
  label: z.string(),
  value: z.string(),
  copyable: z.boolean(),
});
export type PaymentDetail = z.infer<typeof paymentDetailSchema>;

/**
 * What a shopper is told when they choose a manual method.
 *
 * `fields` is non-empty by construction: a method with nothing to transfer to
 * is never offered, because a payment button leading to a page with no account
 * number on it is worse than a method that is absent.
 */
export const paymentInstructionsSchema = z.object({
  /** May be empty. The numbers are the part that may not be. */
  headline: z.string(),
  fields: z.array(paymentDetailSchema).min(1),
  afterPaying: z.string(),
});
export type PaymentInstructions = z.infer<typeof paymentInstructionsSchema>;

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
    provider: manualPaymentProviderSchema,
    /** Shown to the shopper; the order waits for a human to approve proof. */
    instructions: paymentInstructionsSchema,
    amount: displayPriceSchema,
  }),
]);
export type PaymentSession = z.infer<typeof paymentSessionSchema>;

// --- payment settings -------------------------------------------------------

/**
 * The `Setting` row the manual methods live under.
 *
 * One row for both rather than one each: the checkout reads them on every draft
 * it makes, and two queries for a pair of small objects buys nothing.
 */
export const PAYMENT_SETTINGS_KEY = 'payments.manual';

export const paymentFieldSettingSchema = z.object({
  label: i18nStringSchema,
  /**
   * Not localised, deliberately. An IBAN is the same string in both languages,
   * and a second copy of it is a second chance to mistype one digit of it.
   */
  value: z.string().trim().max(200),
  copyable: z.boolean(),
});
export type PaymentFieldSetting = z.infer<typeof paymentFieldSettingSchema>;

export const manualPaymentSettingSchema = z.object({
  /**
   * Kept apart from "has details filled in". Taking bank transfer off the
   * checkout for a fortnight should not mean deleting the account number and
   * typing it back in afterwards from memory.
   */
  isEnabled: z.boolean(),
  headline: i18nStringSchema,
  afterPaying: i18nStringSchema,
  fields: z.array(paymentFieldSettingSchema).max(12),
});
export type ManualPaymentSetting = z.infer<typeof manualPaymentSettingSchema>;

export const paymentSettingsSchema = z.object({
  BANK_TRANSFER: manualPaymentSettingSchema,
  CRYPTO: manualPaymentSettingSchema,
});
export type PaymentSettings = z.infer<typeof paymentSettingsSchema>;

export const paymentMethodStatusSchema = z.object({
  provider: paymentProviderSchema,
  isOffered: z.boolean(),
  /** Arabic, for the panel. Null when the method is offered. */
  blocker: z.string().nullable(),
  /**
   * Something wrong with an offered method, which a blocker cannot express.
   *
   * The gate needs one labelled field to offer a bank transfer, and one is
   * enough to be correct and not enough to be usable: a shop that has entered
   * an IBAN and nothing else is offering a transfer that many banks will
   * reject, because the sending form asks for the beneficiary name and the
   * receiving bank and refuses a mismatch. Before this the screen said nothing
   * at all once a method went live, so the difference between "offered" and
   * "offered and workable" was invisible.
   *
   * A warning, never a blocker. The shop may have a reason for one field, and
   * refusing to take money over a heuristic would be worse than the gap.
   */
  warning: z.string().nullable(),
});
export type PaymentMethodStatus = z.infer<typeof paymentMethodStatusSchema>;

/**
 * The settings, plus what they currently amount to at the checkout.
 *
 * Whoever is filling this screen in cannot see the storefront's payment step
 * from it, so the screen states outright which methods a shopper is being
 * offered and, for each one that is not, the single reason why.
 */
export const paymentSettingsViewSchema = z.object({
  settings: paymentSettingsSchema,
  methods: z.array(paymentMethodStatusSchema),
});
export type PaymentSettingsView = z.infer<typeof paymentSettingsViewSchema>;

// --- the checkout page ------------------------------------------------------

export const checkoutSchema = z.object({
  order: orderSchema,
  cart: cartSchema,
  crossSell: z.array(crossSellSchema),
  /** True when the cart needs an activation email, so the form can ask. */
  activationEmailRequired: z.boolean(),

  /**
   * The methods a shopper may actually start, decided by the server.
   *
   * A method whose details nobody has written — a bank transfer with no account
   * number behind it — is absent from this list rather than present and broken.
   * The page draws its buttons from here, so there is one answer to "can this
   * be paid?" instead of a fixed row of buttons with a 503 behind one of them.
   */
  paymentMethods: z.array(paymentProviderSchema),
});
export type Checkout = z.infer<typeof checkoutSchema>;

/**
 * Below this, a cross-sell is not worth the interruption.
 *
 * A checkout page that asks a question earns its keep or gets in the way, and
 * an add-on saving 3% is in the way.
 */
export const CROSS_SELL_MIN_SAVE_PERCENT = 5;
/** More than three choices at the payment step is a delay, not an upsell. */
export const CROSS_SELL_MAX = 3;
