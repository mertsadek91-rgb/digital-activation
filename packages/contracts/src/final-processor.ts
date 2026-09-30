import { z } from 'zod';

import { fpMethodIdSchema } from './checkout.js';
import { moneySchema } from './primitives.js';

/**
 * Final Processor, the owner's own payment processor — the admin's shapes.
 *
 * The storefront's shapes (`checkoutFpMethodSchema`, `fpPaymentStatusSchema`,
 * the FINAL_PROCESSOR payment session) live in `checkout.ts` beside the rest
 * of the checkout. Everything here is served under
 * `/v1/admin/payments/final-processor`, to OWNER and ADMIN only.
 *
 * The site secret is never in any of these, not even masked: the screen says
 * whether it is set, and that is all.
 */

/** A refund's state, as this shop records it. */
export const fpRefundStatusSchema = z.enum(['PENDING', 'SUCCEEDED', 'FAILED']);
export type FpRefundStatus = z.infer<typeof fpRefundStatusSchema>;

/**
 * Why a method is not shown to customers (B.3). Several can apply at once;
 * an empty list means the method is on the checkout.
 *
 * - `disabled_here`: switched off in this shop.
 * - `currency_not_offered`: the processor does not offer it in USD, the only
 *   currency this shop charges in.
 * - `not_returned_by_processor`: saved here, but the processor no longer
 *   returns it for this site. The customisation is kept.
 * - `connection_failing`: the processor could not be asked (see
 *   `connection.errorCode`), so no method is shown.
 */
export const fpHiddenReasonSchema = z.enum([
  'disabled_here',
  'currency_not_offered',
  'not_returned_by_processor',
  'connection_failing',
]);
export type FpHiddenReason = z.infer<typeof fpHiddenReasonSchema>;

/** The shop's customisation of one method, as stored. */
export const fpMethodConfigSchema = z.object({
  enabled: z.boolean(),
  displayName: z.string().nullable(),
  iconUrl: z.string().nullable(),
  shortDescription: z.string().nullable(),
  displayOrder: z.number().int(),
});
export type FpMethodConfig = z.infer<typeof fpMethodConfigSchema>;

/** One method: what the processor says, what the shop saved, and the upshot. */
export const adminFpMethodSchema = z.object({
  id: fpMethodIdSchema,
  /**
   * The processor's side. Null when it did not return the method this time
   * (not returned, or the connection is failing).
   */
  processor: z
    .object({
      label: z.string(),
      labels: z.object({ ar: z.string().optional(), en: z.string().optional() }),
      iconUrl: z.string(),
      currencies: z.array(z.string()),
      refunds: z.enum(['none', 'full', 'partial']),
      /** Sandbox: no real money is collected through this method. */
      testMode: z.boolean(),
    })
    .nullable(),
  /** The saved customisation, or the defaults when nothing was saved yet. */
  config: fpMethodConfigSchema,
  /** Whether a row exists; false means `config` is the defaults. */
  saved: z.boolean(),
  /** What the checkout shows: the admin's name and icon, else the processor's. */
  effective: z.object({ label: z.string(), iconUrl: z.string().nullable() }),
  visible: z.boolean(),
  hiddenReasons: z.array(fpHiddenReasonSchema),
});
export type AdminFpMethod = z.infer<typeof adminFpMethodSchema>;

/** `GET /v1/admin/payments/final-processor` (B.2, B.3). */
export const adminFpOverviewSchema = z.object({
  /** Which environment values are present. Never their values. */
  env: z.object({
    // Neutral key names: this package is bundled into the storefront, and a
    // literal secret-variable name in a browser chunk fails the A.8.9 check.
    baseUrl: z.boolean(),
    siteId: z.boolean(),
    secret: z.boolean(),
    siteUrl: z.boolean(),
    /** All three processor values are set. */
    configured: z.boolean(),
  }),
  baseUrl: z.string().nullable(),
  siteId: z.string().nullable(),
  /** The storefront origin the return and cancel pages are built on. */
  siteUrl: z.string().nullable(),
  /**
   * What "Test connection" registers with the processor. Null when neither
   * API_PUBLIC_URL nor NEXT_PUBLIC_API_URL is set.
   */
  webhookUrl: z.string().nullable(),
  /** The last method-list request (cached up to 5 minutes). */
  connection: z.object({
    ok: z.boolean(),
    /** A processor error code (A.6), `network_error`, or `not_configured`. */
    errorCode: z.string().nullable(),
    /** The code explained, in the panel's language. */
    message: z.string().nullable(),
    checkedAt: z.string().nullable(),
  }),
  /** Any method is in test mode: show "Test mode — no real money is collected". */
  testMode: z.boolean(),
  /** In display order: processor methods and saved-but-missing ones. */
  methods: z.array(adminFpMethodSchema),
});
export type AdminFpOverview = z.infer<typeof adminFpOverviewSchema>;

/** `POST /v1/admin/payments/final-processor/connect` (B.2). Always 200. */
export const adminFpConnectResultSchema = z.discriminatedUnion('connected', [
  z.object({
    connected: z.literal(true),
    site: z.object({ siteId: z.string(), name: z.string() }),
    webhookUrl: z.string(),
    currencies: z.array(z.string()),
    methods: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        currencies: z.array(z.string()),
        testMode: z.boolean(),
      }),
    ),
    testMode: z.boolean(),
  }),
  z.object({
    connected: z.literal(false),
    /** e.g. `invalid_signature` → wrong secret; `invalid_webhook_url`; `stale_timestamp`. */
    errorCode: z.string(),
    /** The code explained, in the panel's language. */
    message: z.string(),
  }),
]);
export type AdminFpConnectResult = z.infer<typeof adminFpConnectResultSchema>;

/**
 * An icon: an https URL (the media library's public URL, or any other) or a
 * path on this site. Null restores the processor's icon.
 */
const iconUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => /^https:\/\/[^\s]+$/.test(value) || /^\/[^\s/][^\s]*$/.test(value),
    'expected an https URL or a path on this site',
  );

/** `PUT /v1/admin/payments/final-processor/methods/:id` (B.3). Answers the overview. */
export const updateFpMethodSchema = z.object({
  enabled: z.boolean(),
  /** Null or blank restores the processor's label. */
  displayName: z.string().trim().max(80).nullable(),
  iconUrl: iconUrlSchema.nullable(),
  shortDescription: z.string().trim().max(200).nullable(),
  /** Lower first. */
  displayOrder: z.number().int().min(0).max(10_000),
});
export type UpdateFpMethod = z.infer<typeof updateFpMethodSchema>;

export const fpWebhookResultSchema = z.enum(['applied', 'duplicate', 'mismatch', 'error']);
export type FpWebhookResult = z.infer<typeof fpWebhookResultSchema>;

/** `GET /v1/admin/payments/final-processor/events?page=` (B.5). Newest first, 30 days. */
export const adminFpEventListSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      eventId: z.string(),
      /** payment.succeeded | payment.failed | payment.refunded | refund.failed */
      type: z.string(),
      /** The processor's order_ref: our internal order id. */
      orderRef: z.string().nullable(),
      /** The order it names, when that order exists. */
      orderNumber: z.string().nullable(),
      /**
       * applied: the change was stored. duplicate: already processed, nothing
       * changed. mismatch: it did not match what was stored (not marked paid;
       * the order carries a note). error: processing failed; the processor
       * retries.
       */
      result: fpWebhookResultSchema,
      createdAt: z.string(),
    }),
  ),
  /** 1-based. */
  page: z.number().int().min(1),
  hasMore: z.boolean(),
});
export type AdminFpEventList = z.infer<typeof adminFpEventListSchema>;

/** One refund on an order's Final Processor payment (B.4). */
export const adminFpRefundSchema = z.object({
  id: z.string(),
  /** Our idempotency key; null for a refund made in the processor's admin. */
  refundRef: z.string().nullable(),
  /** The processor's refund_id; null until it answered. */
  refundId: z.string().nullable(),
  amountUsd: moneySchema,
  status: fpRefundStatusSchema,
  /** The processor's error code when FAILED. */
  failureCode: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminFpRefund = z.infer<typeof adminFpRefundSchema>;

/** The Final Processor block of the admin order detail (B.4). */
export const adminFpOrderPaymentSchema = z.object({
  /** The processor's payment_id. */
  paymentId: z.string().nullable(),
  /** PROCESSING | SUCCEEDED | FAILED | CANCELLED | REFUNDED. */
  state: z.string(),
  testMode: z.boolean(),
  paidAt: z.string().nullable(),
  /** Charged, always USD. */
  amountUsd: moneySchema,
  /** As the processor last reported it. */
  refundedUsd: moneySchema,
  /** Paid, less refunds that succeeded or are still pending: the refund cap. */
  refundableUsd: moneySchema,
  refunds: z.array(adminFpRefundSchema),
});
export type AdminFpOrderPayment = z.infer<typeof adminFpOrderPaymentSchema>;
