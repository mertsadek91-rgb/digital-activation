import { z } from 'zod';

import { moneySchema } from './primitives.js';

/**
 * Shape of Promotion.rules.
 *
 * The legacy store had seven coupons and no way to express "20% off Office
 * only, first order, one per customer" — so every rule lived in someone's head.
 * Anything the checkout must enforce belongs here, validated on write.
 */
export const promotionRulesSchema = z
  .object({
    minTotalUsd: moneySchema.optional(),
    maxDiscountUsd: moneySchema.optional(),

    /** Empty or absent means "any". */
    productIds: z.array(z.string()).max(200).optional(),
    variantIds: z.array(z.string()).max(200).optional(),
    categoryIds: z.array(z.string()).max(50).optional(),
    brandIds: z.array(z.string()).max(50).optional(),

    excludeProductIds: z.array(z.string()).max(200).optional(),
    /** Do not discount something that is already on sale. */
    excludeDiscounted: z.boolean().default(false),

    customerGroupIds: z.array(z.string()).max(20).optional(),
    firstOrderOnly: z.boolean().default(false),
    /** Reactivation offers: only customers dormant at least this long. */
    minDaysSinceLastOrder: z.number().int().min(0).max(3650).optional(),

    /** May this code combine with another? Default no, to protect margin. */
    stackable: z.boolean().default(false),

    /** FREE_ITEM: what is given away. */
    freeVariantId: z.string().optional(),

    /**
     * BUNDLE_DISCOUNT: applies only when all of these are in the same cart.
     * This is what powers "add now and save X%" at checkout.
     */
    requiresAllVariantIds: z.array(z.string()).max(20).optional(),
  })
  .strict();

export type PromotionRules = z.infer<typeof promotionRulesSchema>;

export const DEFAULT_PROMOTION_RULES: PromotionRules = promotionRulesSchema.parse({});

/**
 * Shape of Segment.definition — the audience side of the same coin.
 */
export const segmentDefinitionSchema = z
  .object({
    boughtCategoryIds: z.array(z.string()).max(50).optional(),
    notBoughtCategoryIds: z.array(z.string()).max(50).optional(),
    boughtProductIds: z.array(z.string()).max(200).optional(),
    dormantDays: z.number().int().min(1).max(3650).optional(),
    minTotalSpentUsd: moneySchema.optional(),
    minOrderCount: z.number().int().min(1).optional(),
    customerGroupIds: z.array(z.string()).max(20).optional(),
    /** Drives the renewal campaign for Adobe / Office 365 / ESET subscriptions. */
    renewalDueWithinDays: z.number().int().min(1).max(365).optional(),
    locales: z.array(z.enum(['AR', 'EN'])).optional(),
    marketingOptInOnly: z.boolean().default(true),
  })
  .strict();

export type SegmentDefinition = z.infer<typeof segmentDefinitionSchema>;

/**
 * The abandoned-cart ladder, as data rather than as scattered cron jobs.
 * MANAGER_QUEUE deliberately sends nothing: a human sets the discount first,
 * and only then does the system mint a single-use, customer-bound coupon.
 */
export const RECOVERY_LADDER = [
  {
    stage: 'NUDGE_1H',
    afterMinutes: 60,
    channels: ['EMAIL', 'PUSH'],
    discount: false,
  },
  {
    stage: 'REMINDER_24H',
    afterMinutes: 60 * 24,
    channels: ['EMAIL'],
    discount: false,
  },
  {
    stage: 'URGENCY_72H',
    afterMinutes: 60 * 72,
    channels: ['EMAIL', 'PUSH'],
    discount: false,
  },
  {
    stage: 'MANAGER_QUEUE',
    afterMinutes: 60 * 24 * 7,
    channels: [],
    discount: true,
  },
  {
    stage: 'CLOSED',
    afterMinutes: 60 * 24 * 14,
    channels: [],
    discount: false,
  },
] as const;

export type RecoveryRung = (typeof RECOVERY_LADDER)[number];

// --- the panel --------------------------------------------------------------

/**
 * A coupon, as the panel lists it.
 *
 * `redeemed` and `revenueUsd` sit beside the definition rather than on a
 * separate report, because the only question anybody asks about a live code is
 * whether it is working — and a code with four hundred redemptions against
 * nine hundred dollars of revenue is answering that question by itself.
 */
export const adminPromotionSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.enum(['PERCENT', 'FIXED', 'FREE_ITEM', 'BUNDLE_DISCOUNT']),
  scope: z.enum(['CART', 'PRODUCT', 'CATEGORY', 'BRAND']),
  value: moneySchema,
  isActive: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  usageLimit: z.number().int().nullable(),
  usageCount: z.number().int(),
  perCustomerLimit: z.number().int().nullable(),
  singleUse: z.boolean(),
  rules: promotionRulesSchema,
  /** What it has actually done: redemptions, and the orders they sat on. */
  redeemed: z.number().int(),
  discountedUsd: moneySchema,
  revenueUsd: moneySchema,
  /**
   * Live, scheduled, expired, exhausted or off — computed rather than stored,
   * because `isActive` alone says nothing about a code whose window has
   * passed, and "active" on an expired coupon is a lie the panel would tell.
   */
  state: z.enum(['LIVE', 'SCHEDULED', 'EXPIRED', 'EXHAUSTED', 'OFF']),
  createdAt: z.string(),
});
export type AdminPromotion = z.infer<typeof adminPromotionSchema>;

export const adminPromotionListSchema = z.object({
  rows: z.array(adminPromotionSchema),
  counts: z.object({
    all: z.number().int(),
    live: z.number().int(),
    scheduled: z.number().int(),
    finished: z.number().int(),
  }),
});
export type AdminPromotionList = z.infer<typeof adminPromotionListSchema>;

/**
 * Writing one.
 *
 * The code is uppercased and stripped of everything but letters, digits and a
 * dash, because a coupon is read off a banner and typed by hand: a code with a
 * space or an Arabic-Indic digit in it is a support ticket. Matching at
 * checkout is already case-insensitive, so storing one casing keeps the two
 * ends honest with each other.
 */
export const promotionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(40)
  .regex(/^[A-Z0-9-]+$/, 'letters, digits and dashes only');

export const createPromotionSchema = z
  .object({
    /** Absent for an automatic promotion that needs no code. */
    code: promotionCodeSchema.optional(),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    type: z.enum(['PERCENT', 'FIXED', 'FREE_ITEM', 'BUNDLE_DISCOUNT']).default('PERCENT'),
    scope: z.enum(['CART', 'PRODUCT', 'CATEGORY', 'BRAND']).default('CART'),
    value: moneySchema,
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    usageLimit: z.number().int().min(1).max(1_000_000).optional(),
    perCustomerLimit: z.number().int().min(1).max(1000).nullable().default(1),
    isActive: z.boolean().default(true),
    rules: promotionRulesSchema.default(DEFAULT_PROMOTION_RULES),
  })
  .refine((input) => input.type !== 'PERCENT' || Number(input.value) <= 100, {
    message: 'a percentage cannot exceed 100',
    path: ['value'],
  })
  .refine(
    (input) =>
      input.startsAt === undefined ||
      input.endsAt === undefined ||
      new Date(input.startsAt) < new Date(input.endsAt),
    { message: 'the end must come after the start', path: ['endsAt'] },
  );
export type CreatePromotion = z.infer<typeof createPromotionSchema>;

/** Everything editable after the fact. The type and the code are not. */
export const updatePromotionSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  value: moneySchema.optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
  rules: promotionRulesSchema.optional(),
});
export type UpdatePromotion = z.infer<typeof updatePromotionSchema>;
