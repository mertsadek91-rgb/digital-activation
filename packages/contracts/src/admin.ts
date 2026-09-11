import { z } from 'zod';

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
  /** What is wrong, in the words an editor needs to act on. */
  detail: z.string(),
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
  }),
});
export type AdminProductList = z.infer<typeof adminProductListSchema>;

export const adminProductQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['all', 'draft', 'published', 'out-of-stock', 'blocked']).default('all'),
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
