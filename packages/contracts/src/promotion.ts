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
