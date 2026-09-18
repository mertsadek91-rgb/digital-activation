import { z } from 'zod';

import { localeSchema } from './primitives.js';

/**
 * Product images, as the panel manages them.
 *
 * Three rows stand behind every picture and the split matters, because it is
 * what lets the same file serve two products without being uploaded twice:
 *
 *   Asset        the bytes in the bucket. Content-addressed, so re-uploading
 *                the same picture finds the row that is already there.
 *   AssetAlt     the alt text, per locale, belonging to the bytes.
 *   ProductMedia this picture's place on this product — its order, whether it
 *                is the hero, and optionally the one variant it belongs to.
 *
 * So deleting an image on a product deletes a ProductMedia row and leaves the
 * Asset alone: the bytes are immutable and may be in use elsewhere, and an
 * orphan object in a bucket costs a fraction of a cent while a broken image on
 * another product costs a sale.
 */

/** Alt text is per locale and the publish gate asks for both. */
export const altTextSchema = z.object({
  ar: z.string().trim().max(300),
  en: z.string().trim().max(300),
});
export type AltText = z.infer<typeof altTextSchema>;

export const productImageSchema = z.object({
  /** The ProductMedia row — what the panel edits and deletes. */
  id: z.string(),
  assetId: z.string(),
  url: z.string().url(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  bytes: z.number().int().nonnegative(),
  alt: altTextSchema,
  isHero: z.boolean(),
  position: z.number().int().nonnegative(),
  /**
   * The variant this picture is for, when it is for one.
   *
   * Most products have one picture for the whole product. A few need one per
   * edition — a Windows box and a Windows Server box are not interchangeable
   * on a page — so a row may name a variant and then shows only there.
   */
  variantId: z.string().nullable(),
  variantSku: z.string().nullable(),
  /** How many products use these bytes. Above one, deleting is not removal. */
  usedByProducts: z.number().int().positive(),
  createdAt: z.string(),
});
export type ProductImage = z.infer<typeof productImageSchema>;

export const productImagesSchema = z.object({
  productSlug: z.string(),
  images: z.array(productImageSchema),
  /** Variants, so the panel can offer "this picture is for this edition". */
  variants: z.array(z.object({ id: z.string(), sku: z.string() })),
  /** Absent when S3 is not configured, with the reason, so the panel can say so. */
  uploadBlocked: z.string().nullable(),
});
export type ProductImages = z.infer<typeof productImagesSchema>;

/**
 * A new image.
 *
 * The file arrives as a `data:` URL because the browser has already resized it
 * on a canvas; what crosses the wire is a few hundred kilobytes. The server
 * re-encodes whatever it is given regardless — the client-side resize is a
 * kindness to the network, not a thing the server trusts.
 */
export const uploadImageSchema = z.object({
  /** Capped at what Fastify's 2 MiB body limit leaves after base64. */
  dataUrl: z.string().min(32).max(1_950_000),
  /** Shown to the panel if the picture is rejected, and nowhere else. */
  filename: z.string().trim().max(200).optional(),
  alt: altTextSchema.optional(),
  variantId: z.string().optional(),
  /** True for the first image of a product that has none. */
  isHero: z.boolean().default(false),
});
export type UploadImage = z.infer<typeof uploadImageSchema>;

/** Everything about an image that can change after it is stored. */
export const patchImageSchema = z
  .object({
    isHero: z.boolean().optional(),
    position: z.number().int().min(0).max(999).optional(),
    /** `null` detaches the picture from a variant and shows it product-wide. */
    variantId: z.string().nullable().optional(),
    alt: altTextSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'لا تغييرات في الطلب.',
  });
export type PatchImage = z.infer<typeof patchImageSchema>;

/** A whole new order for a product's pictures, as dragged in the panel. */
export const reorderImagesSchema = z.object({
  /** ProductMedia ids, first to last. Anything omitted keeps its place. */
  ids: z.array(z.string()).min(1).max(60),
});
export type ReorderImages = z.infer<typeof reorderImagesSchema>;

export const localeKeySchema = localeSchema;
