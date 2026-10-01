import { z } from 'zod';

import { credentialKindSchema } from './catalog.js';
import { adminFpOrderPaymentSchema, fpRefundStatusSchema } from './final-processor.js';
import { localeSchema, moneySchema, slugSchema } from './primitives.js';

/**
 * Admin contracts, and the publish gate.
 *
 * ON THE GATE — a correction to an earlier, sloppier claim of mine. I first
 * said a product could not publish without "a hero image with alt text in both
 * locales". That is maximalism, not a standard: Google indexes and ranks pages
 * without images, and enforcing it today would mean nothing in the catalog
 * could ever be published, since the 192 legacy attachments have not been
 * migrated yet. A gate that blocks everything gets switched off, and then it
 * guards nothing.
 *
 * So the blocking requirements are the ones whose absence did measurable harm
 * to the store this replaces:
 *
 *   43 of 101 products shipped with no SEO title and no meta description
 *   every category page shipped with no meta description, and across 178 days
 *     not one of the sixteen earned a single search impression
 *   product bodies ran to a 300-word median, with the best copy inside a PNG
 *
 * Images are a warning instead. A product page without one converts worse, and
 * the admin says so loudly, but it is a conversion problem rather than the
 * indexing problem the blockers describe.
 */

export const READINESS_RULES = {
  seoTitleMinLength: 20,
  seoDescriptionMinLength: 70,
  bodyMinWords: 120,
} as const;

/**
 * Where a search result is cut, as opposed to where the gate refuses.
 *
 * READINESS_RULES carries floors only, because an absent description is what
 * cost the legacy store its impressions — a long one still ranks. These are
 * the ceilings the SERP truncates at, and they are advice: the editor shows
 * them as a hint beside the counter and `pnpm db:seo` sizes what it proposes
 * to fit, but nothing refuses a publish over them. The 33 Arabic titles that
 * came through the import run from 42 to 83 characters, so this is guidance
 * the catalog does not yet meet rather than a rule it is being held to.
 */
export const SEO_LENGTH_GUIDE = {
  seoTitleMax: 60,
  seoDescriptionMax: 160,
} as const;

/**
 * The gate's word counter, in one place.
 *
 * The panel counts words as somebody types and the API decides the publish on
 * a count of its own — and if the two disagree by a single word, the number on
 * screen is wrong at exactly the moment it is being trusted. So there is one
 * rule and two callers: the readiness check flattens a block document to text
 * and hands it here, the editor hands it the contents of the textarea.
 *
 * Single characters do not count. Arabic prose is full of one-letter words
 * ("و", "ب", "ل") and counting them would let a body clear 120 on particles.
 */
export function countBodyWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 1).length;
}

export const readinessCheckSchema = z.object({
  /** Stable key, so the UI can label and order these itself. */
  key: z.enum([
    'seoTitle',
    'seoDescription',
    'body',
    'primaryCategory',
    'sku',
    'price',
    'heroImage',
    'englishName',
  ]),
  /** Blockers refuse the publish; warnings are shown and allowed. */
  severity: z.enum(['blocker', 'warning']),
  passed: z.boolean(),
  /**
   * What is wrong, in the words an editor needs to act on — and `null` when
   * nothing is. A passing check used to carry a sentence too ("the body is 340
   * words"), which reads as a complaint to anything that renders `detail`
   * without also reading `passed`.
   */
  detail: z.string().nullable(),
});
export type ReadinessCheck = z.infer<typeof readinessCheckSchema>;

export const readinessSchema = z.object({
  locale: localeSchema,
  publishable: z.boolean(),
  checks: z.array(readinessCheckSchema),
});
export type Readiness = z.infer<typeof readinessSchema>;

// --- product list -----------------------------------------------------------

export const adminProductRowSchema = z.object({
  slug: slugSchema,
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']),
  kind: z.enum(['KEY', 'ACCOUNT', 'PANEL', 'BUNDLE', 'SERVICE']),
  brand: z.string().nullable(),
  primaryCategory: z.string().nullable(),
  variantCount: z.number().int().min(0),
  /** Sum of on-hand across variants. */
  /**
   * Stock across the product's FROM_STOCK variants. Null when none of them is
   * stocked, which is most of this catalog — those are made to order, and a
   * zero there would read as "sold out" when nothing is sold out.
   */
  stock: z.number().int().min(0).nullable(),
  /** How many of the product's variants are held in hand. */
  stockedVariantCount: z.number().int().min(0),
  priceFromUsd: moneySchema.nullable(),
  hasGoldenWarranty: z.boolean(),
  salesCount: z.number().int().min(0),
  imageCount: z.number().int().min(0),
  /**
   * How many activation steps are written, per locale.
   *
   * A count rather than the text: the list is a list. Zero is the number worth
   * seeing — a product with no steps delivers a licence with no instructions,
   * which is the support ticket this field exists to prevent.
   */
  activationSteps: z.object({ ar: z.number().int().min(0), en: z.number().int().min(0) }),
  /** Counts only, so the list stays cheap; the detail view explains them. */
  blockers: z.number().int().min(0),
  warnings: z.number().int().min(0),
});
export type AdminProductRow = z.infer<typeof adminProductRowSchema>;

export const adminProductListSchema = z.object({
  rows: z.array(adminProductRowSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
  counts: z.object({
    all: z.number().int(),
    draft: z.number().int(),
    published: z.number().int(),
    /** Stocked products with nothing left. Made-to-order products cannot be. */
    outOfStock: z.number().int(),
    blocked: z.number().int(),
    /**
     * Drafts with nothing wrong with them.
     *
     * The complement of `blocked` within the drafts, and the number this
     * screen was missing: the catalog held 73 products, 2 of them published
     * and 30 finished — priced, described, categorised, imaged, and invisible.
     * Nothing on the panel said so, because "blocked" answers what needs work
     * and nothing answered what needs a decision.
     */
    ready: z.number().int(),
  }),
});
export type AdminProductList = z.infer<typeof adminProductListSchema>;

export const adminProductQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['all', 'draft', 'published', 'out-of-stock', 'blocked', 'ready']).default('all'),
  q: z.string().trim().max(120).optional(),
  locale: localeSchema.default('ar'),
});
export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;

// --- mutations --------------------------------------------------------------

export const setStatusSchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  /** The locale whose readiness is checked when publishing. */
  locale: localeSchema.default('ar'),
});

/**
 * How a variant is delivered.
 *
 * The owner's choice, not something derived: the activation method describes
 * how a licence is used, which is a different question from what arrives in
 * the customer's inbox. Changing it changes the import box, the supplier paste
 * box, the licence email and the order page together.
 */
export const setCredentialKindSchema = z.object({
  credentialKind: credentialKindSchema,
});

/**
 * The activation how-to, as plain lines.
 *
 * One step per line rather than a rich editor: it is delivered in an email
 * body and on an order page, and both of those need text that cannot carry
 * markup. Empty means "no steps", which is honest — a product with no
 * instructions should show none rather than a heading with nothing under it.
 */
export const setActivationStepsSchema = z.object({
  locale: localeSchema.default('ar'),
  steps: z.array(z.string().trim().min(3).max(500)).max(12),
});

/**
 * A product's copy in one locale, as the editor loads it.
 *
 * The readiness for that same locale rides along, because the entire point of
 * this screen is to clear what the gate refuses — 35 of the 73 products are
 * held back by nothing but a missing SEO title and meta description, and until
 * now the panel had no box to type either one into. Sending the fields without
 * the refusal beside them would mean opening two drawers to answer one
 * question.
 */
export const productCopySchema = z.object({
  locale: localeSchema,
  /** Shown as context, not edited here: the name is the page's H1. */
  name: z.string(),
  shortDesc: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  /**
   * The body as the HTML its `richText` block holds, not as plain text. Every
   * one of the 73 imported Arabic bodies is a single richText block of
   * WooCommerce markup, and a plain-text box would flatten its headings and
   * lists the first time anybody pressed save.
   */
  body: z.string(),
  /**
   * False when the body holds blocks this box cannot put back. An `faq` or a
   * `specTable` is the copy most likely to be quoted by a search or answer
   * engine; dropping one to save a meta description would be a bad trade made
   * silently, so the editor refuses the body and takes the rest.
   */
  bodyEditable: z.boolean(),
  /** The block types that made it uneditable, so the refusal can name them. */
  otherBlocks: z.array(z.string()),
  readiness: readinessSchema,
});
export type ProductCopy = z.infer<typeof productCopySchema>;

/**
 * Writing that copy back.
 *
 * Empty strings are allowed and mean "clear this", which the gate then refuses
 * to publish — that is the honest outcome, and better than a field that cannot
 * be undone. `body` is optional instead: omitting it leaves the body exactly
 * as it is, which is what the editor sends when the body is not editable.
 */
export const setProductCopySchema = z.object({
  locale: localeSchema.default('ar'),
  seoTitle: z.string().trim().max(200),
  seoDescription: z.string().trim().max(500),
  shortDesc: z.string().trim().max(200),
  body: z.string().max(60_000).optional(),
});
export type SetProductCopy = z.infer<typeof setProductCopySchema>;

export const setInventorySchema = z.object({
  onHand: z.number().int().min(0).max(1_000_000),
  /** Recorded on the StockMovement row, so a count change has a stated reason. */
  reason: z.enum(['IMPORT', 'MANUAL_ADJUSTMENT', 'REFUND', 'REVOKED', 'EXPIRED']),
  note: z.string().trim().max(280).optional(),
});

// --- auth -------------------------------------------------------------------

export const staffLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
  /** Six digits from the authenticator, once TOTP is enrolled. */
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'six digits')
    .optional(),
});

export const staffMeSchema = z.object({
  email: z.string(),
  name: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'CATALOG', 'MARKETING', 'SUPPORT', 'FULFILLMENT', 'READONLY']),
  totpEnrolled: z.boolean(),
  /**
   * True while the account is still on the password pnpm db:staff generated
   * and printed. The session exists, and every route but the change-password
   * one refuses, so the panel routes straight there.
   */
  mustChangePassword: z.boolean(),
});

/**
 * Setting a password of one's own.
 *
 * The current password is required even though the session already proves who
 * this is: it stops a borrowed screen becoming a permanent takeover, and it is
 * the one thing an attacker holding a session cookie does not have.
 */
/**
 * Re-clearing the TOTP challenge on a live session.
 *
 * No password: the session already proves identity, and what a step-up asks is
 * whether the person is at the keyboard right now.
 */
export const stepUpSchema = z.object({
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'six digits'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    // Length over composition rules. A 12-character passphrase beats an
    // 8-character one with a digit and a symbol bolted on, and the rules only
    // ever teach people to write Password1!.
    newPassword: z.string().min(12).max(200),
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'The new password must differ from the current one.',
    path: ['newPassword'],
  });
export type ChangePassword = z.infer<typeof changePasswordSchema>;
export type StaffMe = z.infer<typeof staffMeSchema>;

/**
 * Login outcomes.
 *
 * `totp_required` and `totp_enrollment_required` are separate states on
 * purpose. Every staff account must carry TOTP — an admin session can reveal a
 * licence key, which is the product itself — so an account without it is not
 * refused, it is walked through enrolment before it can do anything.
 */
export const staffLoginResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('ok'), staff: staffMeSchema }),
  z.object({ outcome: z.literal('totp_required') }),
  z.object({
    outcome: z.literal('totp_enrollment_required'),
    secret: z.string(),
    otpauthUrl: z.string(),
    /** PNG data URI of the otpauth URL, so enrolment is a scan not a retype. */
    qrDataUrl: z.string(),
  }),
]);
export type StaffLoginResult = z.infer<typeof staffLoginResultSchema>;

// --- orders -----------------------------------------------------------------

/**
 * An order as the panel lists it.
 *
 * Money is shown in the currency the customer was charged *and* in USD,
 * because the store's books are in USD and the charge was not: an order list
 * that reports only one of the two is a list somebody has to do arithmetic on
 * before it means anything.
 */
export const adminOrderRowSchema = z.object({
  number: z.string(),
  status: z.enum([
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
  ]),
  email: z.string(),
  customerName: z.string().nullable(),
  currency: z.string(),
  total: moneySchema,
  totalUsd: moneySchema,
  itemCount: z.number().int().min(0),
  /** How many lines are still waiting on somebody. */
  waitingLines: z.number().int().min(0),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKED']),
  placedAt: z.string(),
  paidAt: z.string().nullable(),
  /** The providers that have a row against this order, succeeded or not. */
  payments: z.array(
    z.object({
      provider: z.enum(['STRIPE', 'PAYPAL', 'BANK_TRANSFER', 'CRYPTO', 'FINAL_PROCESSOR']),
      /** A sandbox payment (Final Processor test mode): no real money moved. */
      testMode: z.boolean(),
      state: z.string(),
      /** Null for a row the provider never gave one for. */
      reference: z.string().nullable(),
      amount: moneySchema,
      currency: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type AdminOrderRow = z.infer<typeof adminOrderRowSchema>;

export const adminOrderLineSchema = z.object({
  orderItemId: z.string(),
  sku: z.string(),
  productName: z.string(),
  qty: z.number().int().min(1),
  unitPrice: moneySchema,
  lineTotal: moneySchema,
  fulfillmentState: z.enum(['PENDING', 'AUTO_ASSIGNED', 'MANUAL_QUEUE', 'DELIVERED', 'FAILED']),
  deliveredAt: z.string().nullable(),
  /** What the supplier hands back for this line, so the paste box takes the right shape. */
  credentialKind: credentialKindSchema,
  /** When a time-limited licence ends, from its delivery; null for lifetime or undelivered. */
  expiresAt: z.string().nullable(),
});

/**
 * One status change, as the order's timeline shows it.
 *
 * `actor` is a staff member's name for STAFF, the provider's reference for
 * PROVIDER, and null for SYSTEM (a sweep, or the delivery pipeline).
 */
export const adminOrderEventSchema = z.object({
  id: z.string(),
  /** Null only for an order's first recorded status. */
  from: adminOrderRowSchema.shape.status.nullable(),
  to: adminOrderRowSchema.shape.status,
  actorType: z.enum(['SYSTEM', 'STAFF', 'PROVIDER']),
  actor: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminOrderEvent = z.infer<typeof adminOrderEventSchema>;

/**
 * The person behind the order, as the order page shows them.
 *
 * Null for a guest checkout that never became an account. The spend and the
 * count are computed live from paid orders, like the customers screen does —
 * the denormalised columns on the customer row are not kept current.
 */
export const adminOrderCustomerSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  whatsappPhone: z.string().nullable(),
  company: z.string().nullable(),
  locale: localeSchema,
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKED']),
  paidOrders: z.number().int().min(0),
  totalSpentUsd: moneySchema,
  marketingEmail: z.enum(['OPTED_IN', 'OPTED_OUT', 'NONE']),
  whatsappOptIn: z.boolean(),
  createdAt: z.string(),
});
export type AdminOrderCustomer = z.infer<typeof adminOrderCustomerSchema>;

export const adminOrderDetailSchema = adminOrderRowSchema.extend({
  customer: adminOrderCustomerSchema.nullable(),
  /** What the invoice says, as typed at checkout. */
  billing: z.object({
    name: z.string().nullable(),
    company: z.string().nullable(),
    vat: z.string().nullable(),
    country: z.string().nullable(),
  }),
  /**
   * The order's arithmetic, in USD, and what was actually charged.
   *
   * `charged` is the succeeded payment row's own amount and currency — never
   * `totalUsd × fxRate`: a transfer or a Final Processor payment is charged
   * in USD whatever currency the shopper browsed in, and a conversion the
   * shop never collected is not a fact about the order. Null until a payment
   * succeeds. `currency` and `fxRate` are what the checkout showed.
   */
  amounts: z.object({
    subtotalUsd: moneySchema,
    discountUsd: moneySchema,
    taxUsd: moneySchema,
    totalUsd: moneySchema,
    currency: z.string(),
    fxRate: z.string(),
    charged: z.object({ amount: moneySchema, currency: z.string() }).nullable(),
  }),
  /** Where the order came from; the risk screen's raw material. */
  client: z.object({ ip: z.string().nullable(), userAgent: z.string().nullable() }),
  /**
   * Status history, oldest first. Empty for orders placed before it was
   * recorded; the timeline then starts from `placedAt` alone.
   */
  history: z.array(adminOrderEventSchema),
  activationEmail: z.string().nullable(),
  couponCode: z.string().nullable(),
  locale: localeSchema,
  lines: z.array(adminOrderLineSchema),
  notes: z.array(
    z.object({
      id: z.string(),
      body: z.string(),
      author: z.string().nullable(),
      isCustomerVisible: z.boolean(),
      createdAt: z.string(),
    }),
  ),
  /**
   * Every message this order caused, and whether it arrived.
   *
   * The half of "I never got my key" that is answerable without touching the
   * vault: a row here saying the licence email went to that address at that
   * time settles it, and a row carrying an error says the opposite. Carries no
   * message body and never could — `NotificationLog.payload` is template
   * variables only, and a licence key is not one of them.
   */
  emails: z.array(
    z.object({
      template: z.string(),
      to: z.string(),
      sentAt: z.string(),
      /** Null until the transport confirms it; an error means it never will. */
      deliveredAt: z.string().nullable(),
      bouncedAt: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
  /**
   * The Final Processor payment behind this order (B.4), or null when it was
   * not paid through Final Processor. Refunds made in the processor's own
   * admin arrive by webhook and appear here too.
   */
  finalProcessor: adminFpOrderPaymentSchema.nullable(),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;

export const adminOrderListSchema = z.object({
  rows: z.array(adminOrderRowSchema),
  /** 1-based. The list used to stop at the newest fifty, with no way past. */
  page: z.number().int().min(1),
  hasMore: z.boolean(),
  counts: z.object({
    all: z.number().int().min(0),
    awaitingPayment: z.number().int().min(0),
    paid: z.number().int().min(0),
    inReview: z.number().int().min(0),
  }),
});
export type AdminOrderList = z.infer<typeof adminOrderListSchema>;

/**
 * Confirming a payment that arrived outside the store.
 *
 * A bank transfer and a crypto payment both land in somebody's account and
 * nowhere near this system, so releasing the key is a human saying "the money
 * is here". The reference is required and is the only thing that ties the row
 * to the statement it came from — a confirmation with no reference is an
 * assertion nobody can check later.
 */
export const confirmPaymentSchema = z.object({
  provider: z.enum(['BANK_TRANSFER', 'CRYPTO']),
  reference: z.string().trim().min(3).max(200),
});

/**
 * Lifting a hold: an order in PAYMENT_REVIEW, or one blocked by its risk level.
 *
 * The reason is required for the same cause the payment reference is: the
 * hold was put there by a rule, and the only record of why a person overrode
 * it is what they write here.
 */
export const releaseHoldSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

/**
 * Refunding an order. The reason is kept on the order, like a hold release's,
 * because it is the only record of why the money went back.
 *
 * An amount is for Final Processor payments only (full or partial, B.4), in
 * USD — the currency the order was charged in — and at most what was paid
 * less what is already refunded or still pending. Give it as a decimal
 * (`amount: "12.50"`) or in cents (`amountMinor: "1250"`), not both. Omitted,
 * the whole remaining balance is refunded. Other providers refund in full and
 * refuse an amount.
 */
export const refundOrderSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    amount: z
      .string()
      .trim()
      .regex(/^\d{1,10}(\.\d{1,2})?$/, 'expected a USD amount such as 12.50')
      .optional(),
    amountMinor: z
      .string()
      .trim()
      .regex(/^\d{1,12}$/, 'expected a whole number of cents')
      .optional(),
  })
  .refine((body) => body.amount === undefined || body.amountMinor === undefined, {
    message: 'give amount or amountMinor, not both',
    path: ['amountMinor'],
  });
export type RefundOrder = z.infer<typeof refundOrderSchema>;

/** What `POST /v1/admin/orders/:number/refund` answers. */
export const refundOrderResultSchema = z.object({
  /** The order's status after the call. */
  status: adminOrderRowSchema.shape.status,
  /**
   * `stripe`: requested from Stripe; the order moves when its webhook lands.
   * `recorded`: a manual method, recorded here. `final_processor`: see `refund`.
   */
  via: z.enum(['stripe', 'recorded', 'final_processor']),
  /** The refund row, for Final Processor. `pending` settles by webhook. */
  refund: z
    .object({
      id: z.string(),
      amountUsd: moneySchema,
      status: fpRefundStatusSchema,
    })
    .nullable(),
});
export type RefundOrderResult = z.infer<typeof refundOrderResultSchema>;

/**
 * A message to the customer, sent by a member of staff from the order page.
 *
 * Five kinds and no free-form "any template": each one is a sentence the
 * store already knows how to say, so a support agent cannot be talked into
 * sending something the store would not. `custom` is the exception and is
 * plain text under the store's frame, never HTML from the box.
 *
 * `offer` mints a single-use code for this customer and is marketing: it is
 * refused without marketing consent and leaves with an unsubscribe link.
 */
export const orderMessageKindSchema = z.enum([
  'payment_received',
  'review_request',
  'renewal_reminder',
  'offer',
  'custom',
]);
export type OrderMessageKind = z.infer<typeof orderMessageKindSchema>;

export const sendOrderMessageSchema = z
  .object({
    kind: orderMessageKindSchema,
    /** `custom` only. */
    subject: z.string().trim().min(2).max(150).optional(),
    /** `custom`: the message. `offer`: an optional line above the code. */
    body: z.string().trim().min(2).max(4000).optional(),
    /** `offer` only: 1–90. */
    percent: z.number().int().min(1).max(90).optional(),
    /** `offer` only: how long the code lives. Default 14 days. */
    validDays: z.number().int().min(1).max(90).default(14),
    /** `renewal_reminder` only: which line; the first time-limited one otherwise. */
    orderItemId: z.string().optional(),
  })
  .refine((input) => input.kind !== 'custom' || (input.subject && input.body), {
    message: 'a custom message needs a subject and a body',
    path: ['body'],
  })
  .refine((input) => input.kind !== 'offer' || input.percent !== undefined, {
    message: 'an offer needs a percentage',
    path: ['percent'],
  });
export type SendOrderMessage = z.input<typeof sendOrderMessageSchema>;

export const orderMessageResultSchema = z.object({
  sent: z.boolean(),
  to: z.string(),
  template: z.string(),
  /** The minted code, for an offer that went out. */
  code: z.string().nullable(),
  /**
   * Why nothing was sent, when `sent` is false and no error was raised:
   * the customer was already invited, the order has no time-limited line, …
   */
  skipped: z
    .enum([
      'guest_order',
      'already_invited',
      'already_reviewed',
      'nothing_delivered',
      'no_term',
      'not_paid',
    ])
    .nullable(),
});
export type OrderMessageResult = z.infer<typeof orderMessageResultSchema>;

export const addOrderNoteSchema = z.object({
  body: z.string().trim().min(2).max(2000),
  /** Shown to the customer on their order page when true. */
  isCustomerVisible: z.boolean().default(false),
});

// --- can this store open? ---------------------------------------------------

/**
 * One thing standing between this store and its first order.
 *
 * `severity` is the whole point of the shape. A store with no payment method
 * cannot take money at all; a store with two published products can, and is
 * merely thin. Mixing those into one list of "issues" is how a launch
 * checklist becomes something nobody reads.
 *
 * `fix` names the screen rather than describing the work, because every one of
 * these is fixed in one place and the fastest useful thing a checklist can do
 * is take you there.
 */
export const launchCheckSchema = z.object({
  key: z.string(),
  severity: z.enum(['blocker', 'warning', 'ready']),
  title: z.string(),
  /** What is true right now, in the words somebody needs to act on. */
  detail: z.string(),
  /** A path in this panel, or null when the fix is not in the panel at all. */
  fix: z.string().nullable(),
});
export type LaunchCheck = z.infer<typeof launchCheckSchema>;

export const launchReadinessSchema = z.object({
  /** True only when nothing is a blocker: the store could take an order now. */
  canSell: z.boolean(),
  checks: z.array(launchCheckSchema),
});
export type LaunchReadiness = z.infer<typeof launchReadinessSchema>;

// --- the dashboard ----------------------------------------------------------

/**
 * One span of trading, with the span before it for comparison.
 *
 * The comparison is in the shape rather than left to the panel because the two
 * numbers have to come from the same query and the same definition of a paid
 * order. A panel that computed "last week" itself from a series would be
 * reading a different clock than the one that filled the series — and a
 * dashboard whose headline disagrees with its own chart is worse than one that
 * shows no comparison at all.
 */
export const dashboardWindowSchema = z.object({
  revenueUsd: moneySchema,
  orders: z.number().int().min(0),
  /** The immediately preceding span of the same length. */
  previousRevenueUsd: moneySchema,
  previousOrders: z.number().int().min(0),
});
export type DashboardWindow = z.infer<typeof dashboardWindowSchema>;

/**
 * A day of trading.
 *
 * `date` is a calendar label — `YYYY-MM-DD` in the *store's* timezone, not the
 * server's and not the reader's. A day is a property of the shop: an order
 * placed at 01:00 Riyadh time belongs to that Riyadh day however the machine
 * running this is configured, and bucketing on UTC would move roughly a fifth
 * of this store's evenings into the following day.
 */
export const dashboardPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  revenueUsd: moneySchema,
  orders: z.number().int().min(0),
});
export type DashboardPoint = z.infer<typeof dashboardPointSchema>;

/**
 * Work waiting on a person, as a count and a place to do it.
 *
 * Keys rather than sentences, unlike the launch checks: the set is fixed and
 * the wording is a label with a number in it, so the panel owns both languages
 * of it and the API owns the count. A sentence per row would put half of this
 * screen's copy on the far side of an HTTP boundary for no gain.
 *
 * `severity` is not the size of the count. Three overdue lines are urgent at
 * three; forty unanswered messages are not, because nobody has paid for them.
 */
export const dashboardAttentionSchema = z.object({
  key: z.enum([
    'queueOverdue',
    'queueWaiting',
    'paymentReview',
    'awaitingPayment',
    'messagesOverdue',
    'messages',
    'reviews',
    'outOfStock',
  ]),
  count: z.number().int().min(0),
  severity: z.enum(['urgent', 'due', 'idle']),
  /** The screen that clears it. Always in this panel. */
  fix: z.string(),
});
export type DashboardAttention = z.infer<typeof dashboardAttentionSchema>;

export const dashboardProductSchema = z.object({
  sku: z.string(),
  slug: z.string(),
  /** In the reader's language, falling back to the name snapshotted on the order. */
  name: z.string(),
  qty: z.number().int().min(0),
  revenueUsd: moneySchema,
});
export type DashboardProduct = z.infer<typeof dashboardProductSchema>;

export const dashboardOrderSchema = z.object({
  number: z.string(),
  status: adminOrderRowSchema.shape.status,
  email: z.string(),
  totalUsd: moneySchema,
  placedAt: z.string(),
  /** Lines still waiting on somebody, so a slow order is visible from here. */
  waitingLines: z.number().int().min(0),
});
export type DashboardOrder = z.infer<typeof dashboardOrderSchema>;

/**
 * The panel's front page.
 *
 * Every number on it was already readable one screen at a time, which is
 * exactly the problem: nobody opening this panel in the morning wants to visit
 * five screens to find out whether yesterday was a good day and what is on
 * fire. This gathers the two questions a person running a shop asks first —
 * how much money came in, and what is waiting on me — and nothing else.
 *
 * ON THE REVENUE FIGURE, since a dashboard that is vague about this is a
 * dashboard nobody can reconcile: it is **gross**, and it is the sum of
 * `Order.totalUsd` over orders that have a `paidAt`, excluding the cancelled
 * and the failed. Refunds are reported separately and on their own date rather
 * than subtracted from the day the order was paid, because a refund issued in
 * March against a January order is not a fact about January — and silently
 * rewriting a past day is how a chart stops matching the figure somebody wrote
 * down from it last week.
 */
export const adminDashboardSchema = z.object({
  generatedAt: z.string(),
  /** The clock every day boundary on this page was drawn against. */
  timeZone: z.string(),
  today: dashboardWindowSchema,
  last7: dashboardWindowSchema,
  last30: dashboardWindowSchema,
  /** Null with no paid orders in the last thirty days, rather than zero. */
  averageOrderUsd: moneySchema.nullable(),
  /** Money returned in the last thirty days, on the date it was returned. */
  refundedUsd: moneySchema,
  /** Thirty days ending today, one entry per day, gaps filled with zeroes. */
  daily: z.array(dashboardPointSchema),
  attention: z.array(dashboardAttentionSchema),
  topProducts: z.array(dashboardProductSchema),
  recentOrders: z.array(dashboardOrderSchema),
  lifetime: z.object({
    orders: z.number().int().min(0),
    revenueUsd: moneySchema,
    customers: z.number().int().min(0),
  }),
});
export type AdminDashboard = z.infer<typeof adminDashboardSchema>;
