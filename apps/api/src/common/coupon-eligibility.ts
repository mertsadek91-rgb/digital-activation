import type { PromotionRules } from '@da/contracts';
import type { Prisma } from '@da/db';

/** Why a coupon cannot be used on a cart right now. */
export type CouponRefusal =
  | { reason: 'INACTIVE' }
  | { reason: 'NOT_STARTED' }
  | { reason: 'EXPIRED' }
  | { reason: 'EXHAUSTED' }
  | { reason: 'BELOW_MINIMUM'; minTotalUsd: string }
  | { reason: 'MISSING_REQUIRED' };

/**
 * The one test of whether a coupon still applies.
 *
 * It used to run only when the code was typed in. The cart then kept honouring
 * it on every re-render — after its end date, past its usage cap, and after the
 * shopper removed the items that had qualified the cart — because the pricing
 * path checked `isActive` and nothing else. Applying and pricing now ask the
 * same question, so a coupon cannot be valid at one step and not the other.
 */
export function couponRefusal(
  promotion: {
    isActive: boolean;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    usageCount: number;
  },
  rules: Pick<PromotionRules, 'minTotalUsd' | 'requiresAllVariantIds'>,
  cart: { subtotalUsd: Prisma.Decimal; variantIds: string[] },
  now: Date = new Date(),
): CouponRefusal | null {
  if (!promotion.isActive) return { reason: 'INACTIVE' };
  if (promotion.startsAt && promotion.startsAt > now) return { reason: 'NOT_STARTED' };
  if (promotion.endsAt && promotion.endsAt < now) return { reason: 'EXPIRED' };
  if (promotion.usageLimit !== null && promotion.usageCount >= promotion.usageLimit) {
    return { reason: 'EXHAUSTED' };
  }
  if (rules.minTotalUsd !== undefined && cart.subtotalUsd.lessThan(rules.minTotalUsd)) {
    return { reason: 'BELOW_MINIMUM', minTotalUsd: rules.minTotalUsd };
  }
  if (
    rules.requiresAllVariantIds &&
    rules.requiresAllVariantIds.length > 0 &&
    !rules.requiresAllVariantIds.every((id) => cart.variantIds.includes(id))
  ) {
    return { reason: 'MISSING_REQUIRED' };
  }
  return null;
}
