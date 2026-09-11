import { z } from 'zod';

import { fulfillmentModeSchema } from './catalog.js';

/**
 * Fulfilment contracts — the supplier queue and the vault, as the admin sees
 * them.
 *
 * One rule shapes every shape here: no response carries a licence key except
 * the single reveal, and that one is a deliberate act by a named person with a
 * fresh 2FA challenge behind it. A queue row says a key exists; it never says
 * what it is.
 */

export const fulfillmentStateSchema = z.enum([
  'PENDING',
  'AUTO_ASSIGNED',
  'MANUAL_QUEUE',
  'DELIVERED',
  'FAILED',
]);

export const licenseKeyStateSchema = z.enum([
  'AVAILABLE',
  'RESERVED',
  'ASSIGNED',
  'DELIVERED',
  'REVOKED',
  'EXPIRED',
]);

export const queueRowSchema = z.object({
  orderItemId: z.string(),
  orderNumber: z.string(),
  placedAt: z.string(),
  paidAt: z.string().nullable(),
  /** Where the receipt goes. */
  email: z.string(),
  /**
   * Where the licence must be activated, when it binds to an address. For
   * twenty-six variants the supplier order cannot be placed without it, so it
   * belongs on the row rather than a click away.
   */
  activationEmail: z.string().nullable(),
  sku: z.string(),
  productName: z.string(),
  qty: z.number().int().min(1),
  state: fulfillmentStateSchema,
  mode: fulfillmentModeSchema,
  /** The window the customer was promised, so the queue can be worked to it. */
  deliverySlaSeconds: z.number().int().min(0),
  requiresActivationEmail: z.boolean(),
  /** Whether a key is already bound. Never what it says. */
  hasKey: z.boolean(),
  /** Seconds since payment, so lateness is visible without arithmetic. */
  waitingSeconds: z.number().int().min(0),
  /** True when the promised window has already passed. */
  overdue: z.boolean(),
});
export type QueueRow = z.infer<typeof queueRowSchema>;

export const queueSchema = z.object({
  rows: z.array(queueRowSchema),
  waiting: z.number().int().min(0),
  oldestPaidAt: z.string().nullable(),
});
export type Queue = z.infer<typeof queueSchema>;

// --- requests ---------------------------------------------------------------

export const fulfilManuallySchema = z.object({
  /**
   * The code the supplier sent back.
   *
   * It is sealed into the vault on arrival and never written to a log or an
   * order note — the legacy store used order notes as its delivery mechanism,
   * which is why its own backup is a file of customer licences.
   */
  code: z.string().trim().min(4).max(4000),
  supplierId: z.string().optional(),
  /** What it cost, for margin reporting. Never exposed to a storefront. */
  costUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
});

export const markFailedSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const importKeysSchema = z.object({
  variantId: z.string().min(1),
  /** One licence per line. Blank lines and duplicates are reported, not stored. */
  codes: z.string().min(4).max(200_000),
  supplierId: z.string().optional(),
  costUsd: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  /** For stock with an activation deadline. */
  expiresAt: z.string().datetime().optional(),
});

export const importResultSchema = z.object({
  imported: z.number().int().min(0),
  duplicatesSkipped: z.number().int().min(0),
  invalidSkipped: z.number().int().min(0),
});
export type ImportResult = z.infer<typeof importResultSchema>;

export const vaultStockRowSchema = z.object({
  variantId: z.string(),
  sku: z.string(),
  productName: z.string(),
  /** Counts by state. A made-to-order variant is expected to be empty. */
  counts: z.record(licenseKeyStateSchema, z.number().int().min(0)),
  mode: fulfillmentModeSchema,
});
export type VaultStockRow = z.infer<typeof vaultStockRowSchema>;

export const revealSchema = z.object({
  /** Required, and checked against the session rather than trusted. */
  reason: z.string().trim().min(3).max(200),
});

export const revealResultSchema = z.object({
  /**
   * The licence, in the clear, once.
   *
   * Returned by the one endpoint that does so, to one named member of staff,
   * with a fresh TOTP challenge behind it and a KeyAccessLog row written
   * before this value existed.
   */
  plaintext: z.string(),
});

export const keyHistoryRowSchema = z.object({
  action: z.enum(['IMPORT', 'REVEAL', 'EXPORT', 'RESEND', 'REVOKE']),
  actorId: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});

/** Past this, a queued line is late rather than in progress. */
export const QUEUE_OVERDUE_GRACE_SECONDS = 15 * 60;
