import { z } from 'zod';

import { credentialKindSchema } from './catalog.js';
import { orderStatusSchema } from './checkout.js';
import { localeSchema, moneySchema } from './primitives.js';

/**
 * The customer's own area — one page, and it exists for one moment: the
 * licence email is gone and the key is needed now.
 *
 * Sign-in is a link emailed to the address on the order, with no password
 * anywhere in the flow. Every order in this store is a guest order, and the
 * licence was delivered to that mailbox already — so control of the mailbox is
 * exactly the bar that handed the key over, and a password would add a secret
 * to steal without raising it.
 *
 * The list carries no secret. A key comes out one at a time, on a deliberate
 * click, and every one of those is written to the vault's access log with the
 * customer as the actor — the same log that records a member of staff reading
 * one. A page that dumped every key on load would put a shoulder-surf between
 * a customer and their whole order history.
 */
export const requestLoginLinkSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  /** Which language the email is written in. */
  locale: localeSchema.default('ar'),
});

export const exchangeLoginTokenSchema = z.object({
  /** The single-use token from the emailed link. */
  token: z.string().trim().min(20).max(200),
});

/**
 * The answer to "send me a link".
 *
 * Always the same, whether or not the address has ever bought anything.
 * Telling a stranger that an email is unknown turns this route into a
 * customer-list oracle, and the store's customer list is worth money to
 * somebody.
 */
export const loginLinkResultSchema = z.object({
  sent: z.literal(true),
});

export const customerMeSchema = z.object({
  email: z.string(),
  firstName: z.string().nullable(),
  locale: localeSchema,
  orderCount: z.number().int().min(0),
  /** When this session stops working, so the page can say so rather than fail. */
  expiresAt: z.string(),
});
export type CustomerMe = z.infer<typeof customerMeSchema>;

/** What comes back when a link is traded for a session. */
export const exchangeResultSchema = z.object({
  customer: customerMeSchema,
});

/**
 * One delivered line, as its buyer sees it.
 *
 * Keyed by order item rather than by licence key: the customer bought a
 * product on an order, and "which of the two encrypted rows in the vault is
 * yours" is not a question they should have to answer.
 */
export const licenceRowSchema = z.object({
  orderItemId: z.string(),
  orderNumber: z.string(),
  productName: z.string(),
  productSlug: z.string(),
  sku: z.string(),
  qty: z.number().int().min(1),
  /** ISO. When the licence actually went out, not when the order was placed. */
  deliveredAt: z.string().nullable(),
  placedAt: z.string(),
  state: z.enum(['PENDING', 'AUTO_ASSIGNED', 'MANUAL_QUEUE', 'DELIVERED', 'FAILED']),
  /** A key to type, or an account to sign in with. */
  credentialKind: credentialKindSchema,
  /** The same steps the licence email carried. */
  activationSteps: z.array(z.string()),
  /** Replacement window in days, when the line has one of its own. */
  warrantyDays: z.number().int().nullable(),
  /** Whether anything is actually readable yet. */
  hasSecret: z.boolean(),
  /** Set when the licence must be activated before a date. */
  expiresAt: z.string().nullable(),
});
export type LicenceRow = z.infer<typeof licenceRowSchema>;

export const licenceListSchema = z.object({
  rows: z.array(licenceRowSchema),
  /** Lines still being prepared, so the page can explain the wait. */
  waiting: z.number().int().min(0),
});
export type LicenceList = z.infer<typeof licenceListSchema>;

/**
 * One licence, in the clear, for the person who paid for it.
 *
 * Shaped like the admin's reveal because it is the same act with a different
 * actor: exactly one of `key` or the `username`/`password` pair is set, and
 * `kind` says which without the reader inferring it from emptiness.
 */
export const customerSecretSchema = z.object({
  kind: credentialKindSchema,
  key: z.string().nullable(),
  username: z.string().nullable(),
  password: z.string().nullable(),
});
export type CustomerSecret = z.infer<typeof customerSecretSchema>;

export const customerSecretsSchema = z.object({
  /** One per key on the line. A quantity above one is several. */
  secrets: z.array(customerSecretSchema),
});

export const resendResultSchema = z.object({
  /** Where it went, so the page can say the address without the customer guessing. */
  to: z.string(),
});

/** How long a signed-in session lasts. Short on purpose — see the service. */
export const CUSTOMER_SESSION_HOURS = 12;

// --- the orders -------------------------------------------------------------

/**
 * One line of a past order, as its buyer sees it.
 *
 * Deliberately not a licence row. An order answers what was bought, how many,
 * what it cost and whether it has arrived; the key itself comes out on the
 * licences page, one line at a time, through the reveal that writes to the
 * vault's access log. An order history that carried keys would put every key
 * this customer has ever bought on a single screen — the exact thing the
 * licences page is shaped to avoid.
 */
export const accountOrderLineSchema = z.object({
  productName: z.string(),
  sku: z.string(),
  qty: z.number().int().min(1),
  /** In the order's own currency, which the order above carries. */
  lineTotal: moneySchema,
  fulfillmentState: z.enum(['PENDING', 'AUTO_ASSIGNED', 'MANUAL_QUEUE', 'DELIVERED', 'FAILED']),
});
export type AccountOrderLine = z.infer<typeof accountOrderLineSchema>;

/**
 * One order, in the money the customer actually paid.
 *
 * The currency sits on the order rather than on each amount, because an order
 * is settled once, in one currency, at one rate — all three fixed at the
 * moment it was placed. Re-converting a past order at today's rate would give
 * a customer a receipt whose total moves with the dollar.
 */
export const accountOrderSchema = z.object({
  number: z.string(),
  status: orderStatusSchema,
  currency: z.string().length(3),
  placedAt: z.string(),
  /** Null while the money has not arrived, which is a state customers ask about. */
  paidAt: z.string().nullable(),
  subtotal: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  lines: z.array(accountOrderLineSchema),
});
export type AccountOrder = z.infer<typeof accountOrderSchema>;

export const accountOrderListSchema = z.object({
  rows: z.array(accountOrderSchema),
});
export type AccountOrderList = z.infer<typeof accountOrderListSchema>;
