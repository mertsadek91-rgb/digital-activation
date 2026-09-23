import { z } from 'zod';

import { slugSchema } from './primitives.js';

/**
 * Sections, and the links between products.
 *
 * Both were data with no screen. The sixteen sections came from the WordPress
 * import and could not be renamed, reordered or created; the relation table
 * has been empty since the day it was migrated, which is why the checkout's
 * cross-sell falls back to guessing from the cart and why the account page's
 * "used alongside" reason exists in code and has never once been shown.
 */

// --- sections ---------------------------------------------------------------

export const adminCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  parentId: z.string().nullable(),
  position: z.number().int(),
  /**
   * Read but never enforced anywhere, which is the finding rather than the
   * feature: every section is `DRAFT` and every section is served. Surfaced
   * here so the screen can say so instead of implying a switch that works.
   */
  status: z.enum(['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']),
  nameAr: z.string(),
  nameEn: z.string(),
  headlineAr: z.string(),
  headlineEn: z.string(),
  /** Published products in it. A section with none is a page with nothing on it. */
  productCount: z.number().int().min(0),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;

export const adminCategoryListSchema = z.object({
  rows: z.array(adminCategorySchema),
});
export type AdminCategoryList = z.infer<typeof adminCategoryListSchema>;

export const createCategorySchema = z.object({
  slug: slugSchema,
  nameAr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().max(120).optional(),
  parentId: z.string().nullable().default(null),
});
export type CreateCategory = z.infer<typeof createCategorySchema>;

export const setCategorySchema = z
  .object({
    /** Changing it moves the section's URL, and writes the 301 for it. */
    slug: slugSchema.optional(),
    nameAr: z.string().trim().min(2).max(120).optional(),
    nameEn: z.string().trim().max(120).optional(),
    headlineAr: z.string().trim().max(300).optional(),
    headlineEn: z.string().trim().max(300).optional(),
    parentId: z.string().nullable().optional(),
    position: z.number().int().min(0).max(999).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'لا تغييرات في الطلب.' });
export type SetCategory = z.infer<typeof setCategorySchema>;

// --- links between products -------------------------------------------------

/**
 * The four kinds, and what each one is for.
 *
 * `CROSS_SELL` is the one with teeth: it is what the checkout offers, and it
 * is the only kind that carries a discount. The other three are navigation.
 */
export const productRelationKindSchema = z.enum(['RELATED', 'CROSS_SELL', 'UPGRADE', 'ACCESSORY']);
export type ProductRelationKind = z.infer<typeof productRelationKindSchema>;

export const productLinkSchema = z.object({
  id: z.string(),
  kind: productRelationKindSchema,
  position: z.number().int(),
  /** Percent off the pair, applied only when the add-on is taken at checkout. */
  bundleDiscountPercent: z.string().nullable(),
  targetSlug: z.string(),
  targetName: z.string(),
  /** A link to a draft is a link to a 404, so the screen can mark it. */
  targetPublished: z.boolean(),
});
export type ProductLink = z.infer<typeof productLinkSchema>;

export const productLinksSchema = z.object({
  productSlug: z.string(),
  links: z.array(productLinkSchema),
});
export type ProductLinks = z.infer<typeof productLinksSchema>;

export const createProductLinkSchema = z.object({
  targetSlug: slugSchema,
  kind: productRelationKindSchema.default('RELATED'),
  /**
   * Blank for none. Only meaningful on a `CROSS_SELL`, and the server refuses
   * it on the other three rather than storing a number nothing will ever read.
   */
  bundleDiscountPercent: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d{1,2}(\.\d{1,2})?$/),
      z.literal(''),
    ])
    .default(''),
});
export type CreateProductLink = z.infer<typeof createProductLinkSchema>;
