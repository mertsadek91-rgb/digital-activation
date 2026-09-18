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
 * Adding a product, and adding a variant to one.
 *
 * Until now every product in this catalog arrived from a migration script.
 * There was no way to sell something the old WordPress store had not sold,
 * which is a strange limit for a shop.
 *
 * A product is created together with its first variant, in one call, because a
 * product with no variant has no price, cannot be bought, and cannot be
 * published — it is not a product yet, it is a name. Splitting the two would
 * produce an invalid thing that every screen then has to explain.
 *
 * Everything is created as a draft. The publish gate wants a title, a meta
 * description, a hero image and 120 words of body, and a new product has none
 * of them; being born published would mean being born broken in public.
 */

/** The same money rule as the edit form: a string, two decimal places. */
const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'المبلغ يُكتب بالأرقام، وبمنزلتين عشريتين على الأكثر.');

/**
 * A SKU.
 *
 * Upper-cased on the way in, because it is the string a person reads off a
 * supplier invoice and types into the fulfilment queue at two in the morning —
 * and `Office-365` and `OFFICE-365` being two different variants is a mistake
 * that only shows up once a key has gone to the wrong customer.
 */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(64)
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'الرمز بحروف إنجليزية وأرقام وشرطات فقط.');

export const createVariantSchema = z.object({
  sku: skuSchema,
  priceUsd: moneySchema,
  licensePeriodUnit: licensePeriodUnitSchema.default('LIFETIME'),
  /** Ignored when the unit is LIFETIME, which the server normalises. */
  licensePeriodValue: z.number().int().min(1).max(120).nullable().default(null),
  deviceCount: z.number().int().min(1).max(10_000).default(1),
  platform: platformSchema.default('WINDOWS'),
  activationMethod: activationMethodSchema.default('RETAIL_ONLINE'),
  fulfillmentMode: fulfillmentModeSchema.default('ON_DEMAND'),
});
export type CreateVariant = z.infer<typeof createVariantSchema>;

export const createProductSchema = z.object({
  slug: slugSchema,
  kind: productKindSchema.default('KEY'),
  /** The Arabic name is required; this shop's first language is Arabic. */
  nameAr: z.string().trim().min(2).max(200),
  /** Optional at birth. The publish gate asks for it before it can go live. */
  nameEn: z.string().trim().max(200).optional(),
  brandId: z.string().optional(),
  categoryIds: z.array(z.string()).max(12).default([]),
  /** The first variant, without which there is nothing to sell. */
  variant: createVariantSchema,
});
export type CreateProduct = z.infer<typeof createProductSchema>;

export const createdProductSchema = z.object({
  slug: z.string(),
  sku: z.string(),
});
export type CreatedProduct = z.infer<typeof createdProductSchema>;
