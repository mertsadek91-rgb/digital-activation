import { z } from 'zod';

/**
 * What the trust-signal features read and report, beyond their settings.
 *
 * Kept apart from `marketing.ts` so the settings registry stays one list of
 * documents; these are the shapes of the answers built from real orders.
 */

/**
 * How long ago, in buckets coarse enough that a notice can never be matched to
 * one person's checkout: "a few hours ago", "yesterday", "a few days ago".
 */
export const socialProofAgoSchema = z.enum(['hours', 'day', 'days']);
export type SocialProofAgo = z.infer<typeof socialProofAgoSchema>;

/**
 * A product's recent purchases, as the storefront may show them.
 *
 * Deliberately has nowhere to put a name, an email, a city or an order number:
 * a field that does not exist in the contract cannot leak through it. `country`
 * is present only when the store shows countries and the buyer gave one.
 */
export const socialProofSchema = z.object({
  /** Paid orders in the window; 0 until the product reaches the minimum. */
  count: z.number().int().min(0),
  windowHours: z.number().int().min(0),
  recent: z.array(
    z
      .object({
        country: z
          .string()
          .regex(/^[A-Z]{2}$/)
          .optional(),
        ago: socialProofAgoSchema,
      })
      .strict(),
  ),
});
export type SocialProof = z.infer<typeof socialProofSchema>;

export const socialProofQuerySchema = z.object({
  productSlug: z.string().trim().min(1).max(200),
});

/** The admin preview: which products would show a notice right now. */
export const socialProofPreviewSchema = z.object({
  enabled: z.boolean(),
  windowHours: z.number().int(),
  minOrders: z.number().int(),
  rows: z.array(
    z.object({
      productId: z.string(),
      slug: z.string(),
      name: z.string(),
      count: z.number().int(),
      /** True when `count` has reached `minOrders`: shown while the feature is on. */
      shown: z.boolean(),
    }),
  ),
});
export type SocialProofPreview = z.infer<typeof socialProofPreviewSchema>;

/** Review invitations actually sent, for the review-requests screen. */
export const reviewRequestStatsSchema = z.object({
  days: z.number().int(),
  sent: z.number().int(),
  byStage: z.array(z.object({ stage: z.number().int(), sent: z.number().int() })),
  /** Of those, how many led to a review being written. */
  responded: z.number().int(),
});
export type ReviewRequestStats = z.infer<typeof reviewRequestStatsSchema>;
