import { z } from 'zod';

import { localeSchema } from './primitives.js';

/**
 * Customer reviews.
 *
 * The legacy store carried 565 rows in `wvr_virtual_review` — a WordPress
 * plugin whose entire purpose is to generate reviews for products nobody has
 * reviewed. Deleting them is one of the few changes the owner authorised on
 * the old site, so every schema here is written so that the same thing cannot
 * be built again by accident.
 *
 * That shows up as three absences. There is no schema for creating a review
 * against a product — only against an order line, which the API resolves from
 * the session rather than accepting as input. There is no author name field a
 * caller can set; the name comes off the customer record or is left out. And
 * there is no status a submission may choose: everything starts PENDING and
 * only a moderator moves it.
 */

/** Short enough to type honestly, long enough to say something. */
export const REVIEW_BODY_MIN = 10;
export const REVIEW_BODY_MAX = 4000;

export const reviewStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

const ratingSchema = z.number().int().min(1).max(5);
const reviewTitleSchema = z.string().trim().min(2).max(120);
const reviewBodySchema = z.string().trim().min(REVIEW_BODY_MIN).max(REVIEW_BODY_MAX);

/**
 * What a customer submits.
 *
 * No product and no author: the line being reviewed is in the path and the
 * person is in the session cookie. A body that accepted either would be a body
 * somebody could post a review as, which is the whole defect being avoided.
 */
export const submitReviewSchema = z.object({
  rating: ratingSchema,
  title: reviewTitleSchema.optional(),
  body: reviewBodySchema,
  /** Which language it is written in, so the list can set `dir` per review. */
  locale: localeSchema.default('ar'),
});
export type SubmitReview = z.infer<typeof submitReviewSchema>;

/** Fixing a typo before a moderator reads it. Every field optional. */
export const editReviewSchema = z.object({
  rating: ratingSchema.optional(),
  title: reviewTitleSchema.nullable().optional(),
  body: reviewBodySchema.optional(),
});
export type EditReview = z.infer<typeof editReviewSchema>;

/**
 * A review as its own author sees it, which is the only view that shows a
 * PENDING or REJECTED one. `editable` is the answer the API already computed,
 * so the page does not re-derive the rule from the status and get it wrong.
 */
export const ownReviewSchema = z.object({
  id: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  locale: localeSchema,
  status: reviewStatusSchema,
  storeReply: z.string().nullable(),
  createdAt: z.string(),
  editable: z.boolean(),
});
export type OwnReview = z.infer<typeof ownReviewSchema>;

/**
 * One delivered line the customer may review, with the review if there is one.
 *
 * Delivered lines only. A line still being ordered from a supplier has nothing
 * to have an opinion about yet, and most of this catalog is supplied after
 * payment.
 */
export const reviewableLineSchema = z.object({
  orderItemId: z.string(),
  orderNumber: z.string(),
  productSlug: z.string(),
  productName: z.string(),
  deliveredAt: z.string(),
  review: ownReviewSchema.nullable(),
});
export type ReviewableLine = z.infer<typeof reviewableLineSchema>;

export const reviewableListSchema = z.object({
  rows: z.array(reviewableLineSchema),
  /** Delivered lines with nothing written yet, so the page can ask once. */
  awaiting: z.number().int().min(0),
});
export type ReviewableList = z.infer<typeof reviewableListSchema>;

/**
 * A published review, as a stranger sees it.
 *
 * No email, no order number, no customer id. The name is a first name or
 * nothing — a verified purchase is the claim being made, and it is made by the
 * fact the row exists rather than by a full name next to it.
 */
export const publicReviewSchema = z.object({
  id: z.string(),
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  locale: localeSchema,
  authorName: z.string().nullable(),
  createdAt: z.string(),
  storeReply: z.string().nullable(),
  repliedAt: z.string().nullable(),
});
export type PublicReview = z.infer<typeof publicReviewSchema>;

/**
 * Count and average over approved rows only.
 *
 * The same two numbers that are denormalised onto `Product`, recomputed from
 * the rows this response lists. A page that showed a list of three reviews
 * beside an average over eleven is a page whose structured data Google is
 * right to distrust.
 */
export const reviewAggregateSchema = z.object({
  count: z.number().int().min(0),
  /** Decimal string to two places, e.g. "4.67". Never a float over the wire. */
  average: z.string(),
});
export type ReviewAggregate = z.infer<typeof reviewAggregateSchema>;

export const productReviewsSchema = z.object({
  slug: z.string(),
  rows: z.array(publicReviewSchema),
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
  total: z.number().int().min(0),
  aggregate: reviewAggregateSchema,
});
export type ProductReviews = z.infer<typeof productReviewsSchema>;

/**
 * A review on the moderation screen.
 *
 * Carries what the decision turns on: the order it came from and whether that
 * line was really delivered. Both are already guaranteed by the foreign key,
 * and both are shown anyway — the person approving a review should be able to
 * see the purchase behind it without opening another screen.
 */
export const adminReviewRowSchema = z.object({
  id: z.string(),
  status: reviewStatusSchema,
  rating: z.number().int().min(1).max(5),
  title: z.string().nullable(),
  body: z.string(),
  locale: localeSchema,
  productSlug: z.string(),
  productName: z.string(),
  orderNumber: z.string(),
  deliveredAt: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEmail: z.string(),
  storeReply: z.string().nullable(),
  repliedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminReviewRow = z.infer<typeof adminReviewRowSchema>;

export const adminReviewListSchema = z.object({
  rows: z.array(adminReviewRowSchema),
  /** Across the whole table, not the page being shown. */
  counts: z.object({
    pending: z.number().int().min(0),
    approved: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
});
export type AdminReviewList = z.infer<typeof adminReviewListSchema>;

export const adminReviewQuerySchema = z.object({
  status: reviewStatusSchema.default('PENDING'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminReviewQuery = z.infer<typeof adminReviewQuerySchema>;

/**
 * The moderation decision.
 *
 * Two outcomes and no third. "Publish it but hide the rating" and "edit the
 * wording" are both ways of publishing something the customer did not write,
 * which is the line this whole feature exists to hold.
 */
export const moderateReviewSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
});

export const replyToReviewSchema = z.object({
  body: z.string().trim().min(2).max(2000),
});
