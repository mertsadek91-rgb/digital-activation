import { z } from 'zod';

import {
  activationMethodSchema,
  fulfillmentModeSchema,
  licensePeriodUnitSchema,
  platformSchema,
  productKindSchema,
} from './catalog.js';
import { slugSchema } from './primitives.js';

/**
 * Editing a product's identity and its commercial terms.
 *
 * Everything here reached the database from a migration script and could not
 * be changed afterwards from any screen. That is why one product sat as a
 * draft for weeks with a price of zero: the publish gate refused it, correctly,
 * and no field in the panel accepted a number.
 *
 * Two shapes rather than one, because they answer to different people and
 * different risks. Identity is what the product *is* — its name, its brand,
 * the URL it lives at — and changing a slug breaks every link to it. Terms are
 * what it *costs and promises*, they live on the variant, and a mistake there
 * is a mistake about money.
 */

// --- the one enum the storefront never needs ---------------------------------
//
// The rest — kind, platform, period unit, activation method, fulfilment mode —
// are already declared in `catalog.ts` because the product page reads them,
// and they are imported above rather than written twice. Publish status is
// only ever a panel concern: a shopper is never shown a draft.

/**
 * All five states the column holds.
 *
 * `IN_REVIEW` and `SCHEDULED` have no screen behind them yet, but a variant
 * imported in either state has to survive a round trip through this panel —
 * narrowing the read type to the three that are offered would make the API
 * fail to describe rows that already exist.
 */
export const publishStatusSchema = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'SCHEDULED',
  'PUBLISHED',
  'ARCHIVED',
]);

/** The three a person may choose. Setting a state with no workflow is a trap. */
export const settableStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

// --- money ------------------------------------------------------------------

/**
 * A price, as typed.
 *
 * A string, not a number. The column is `Decimal(12,2)` and JSON numbers are
 * doubles: `9.99` does not exist in binary floating point, and a catalog that
 * round-trips its prices through one eventually shows 9.989999999999999. The
 * string is parsed once, at the edge, into the decimal the database stores.
 *
 * Up to two decimal places, because that is what the column holds — a third
 * would be silently rounded, and a price silently changed is worse than a
 * price refused.
 */
const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'المبلغ يُكتب بالأرقام، وبمنزلتين عشريتين على الأكثر.');

/** Blank clears an optional price. `null` and `''` mean the same thing here. */
const optionalMoneySchema = z.union([moneySchema, z.literal('')]);

// --- identity ---------------------------------------------------------------

export const productIdentitySchema = z.object({
  slug: slugSchema,
  kind: productKindSchema,
  brandId: z.string().nullable(),
  primaryCategoryId: z.string().nullable(),
  categoryIds: z.array(z.string()),
  hasGoldenWarranty: z.boolean(),
  nameAr: z.string(),
  nameEn: z.string(),
  /** Offered in the pickers, so the panel needs no second call. */
  brands: z.array(z.object({ id: z.string(), name: z.string() })),
  categories: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string() })),
  /** True when this product has ever been ordered — a slug change then costs. */
  hasOrders: z.boolean(),
});
export type ProductIdentity = z.infer<typeof productIdentitySchema>;

export const setProductIdentitySchema = z.object({
  /**
   * A new slug, when it is being changed.
   *
   * Omitted means "leave it". Changing it rewrites the product's URL, so the
   * server writes a 301 from the old one in the same transaction — a renamed
   * product is a redirect, never a dead end, and the panel cannot be trusted
   * to remember that.
   */
  slug: slugSchema.optional(),
  kind: productKindSchema.optional(),
  /** `null` detaches the brand. */
  brandId: z.string().nullable().optional(),
  primaryCategoryId: z.string().nullable().optional(),
  categoryIds: z.array(z.string()).max(12).optional(),
  hasGoldenWarranty: z.boolean().optional(),
  nameAr: z.string().trim().min(2).max(200).optional(),
  nameEn: z.string().trim().min(2).max(200).optional(),
});
export type SetProductIdentity = z.infer<typeof setProductIdentitySchema>;

// --- commercial terms, per variant -----------------------------------------

export const variantTermsSchema = z.object({
  id: z.string(),
  sku: z.string(),
  status: publishStatusSchema,
  isDefault: z.boolean(),
  position: z.number().int(),

  priceUsd: z.string(),
  compareAtUsd: z.string().nullable(),
  costUsd: z.string().nullable(),

  licensePeriodValue: z.number().int().nullable(),
  licensePeriodUnit: licensePeriodUnitSchema,
  deviceCount: z.number().int(),
  platform: platformSchema,
  activationMethod: activationMethodSchema,
  fulfillmentMode: fulfillmentModeSchema,
  deliverySlaSeconds: z.number().int(),
  requiresActivationEmail: z.boolean(),
  warrantyDays: z.number().int().nullable(),

  /** Live quantity, read-only here — the stock screen owns it. */
  onHand: z.number().int(),
  /** Orders already placed against this variant. Above zero, edits carry weight. */
  orderCount: z.number().int(),
});
export type VariantTerms = z.infer<typeof variantTermsSchema>;

export const productTermsSchema = z.object({
  productSlug: z.string(),
  variants: z.array(variantTermsSchema),
});
export type ProductTerms = z.infer<typeof productTermsSchema>;

export const setVariantTermsSchema = z
  .object({
    priceUsd: moneySchema.optional(),
    compareAtUsd: optionalMoneySchema.optional(),
    costUsd: optionalMoneySchema.optional(),

    /** Null with unit LIFETIME; a positive count otherwise. */
    licensePeriodValue: z.number().int().min(1).max(120).nullable().optional(),
    licensePeriodUnit: licensePeriodUnitSchema.optional(),
    deviceCount: z.number().int().min(1).max(10_000).optional(),
    platform: platformSchema.optional(),
    activationMethod: activationMethodSchema.optional(),
    fulfillmentMode: fulfillmentModeSchema.optional(),
    /** One minute to thirty days. A promise outside that is not a promise. */
    deliverySlaSeconds: z.number().int().min(60).max(2_592_000).optional(),
    requiresActivationEmail: z.boolean().optional(),
    /** Null means the licence term itself, which is the Golden Warranty. */
    warrantyDays: z.number().int().min(0).max(3650).nullable().optional(),

    status: settableStatusSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'لا تغييرات في الطلب.' })
  /*
   * A sale price above the price it is "reduced" from is not a discount, it is
   * a lie on a page with a strike-through on it. Checked here because both
   * numbers are in the same request; when only one is sent the server compares
   * it against the stored other one.
   */
  .refine(
    (value) =>
      !(
        value.priceUsd !== undefined &&
        value.compareAtUsd !== undefined &&
        value.compareAtUsd !== '' &&
        Number(value.compareAtUsd) <= Number(value.priceUsd)
      ),
    { message: 'السعر قبل الخصم يجب أن يكون أعلى من السعر الحالي.' },
  );
export type SetVariantTerms = z.infer<typeof setVariantTermsSchema>;
