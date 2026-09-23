import { describe, expect, it } from 'vitest';

import { Prisma } from '@da/db';

import { couponRefusal } from './coupon-eligibility.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const live = {
  isActive: true,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usageCount: 0,
};
const cart = { subtotalUsd: new Prisma.Decimal('100.00'), variantIds: ['v1', 'v2'] };

/**
 * Guards the coupon check that pricing and applying now share.
 *
 * Before, a coupon was checked once when typed and then honoured on every
 * re-render, so each case below was a discount the store kept giving away.
 */
describe('couponRefusal', () => {
  it('accepts a live coupon with nothing limiting it', () => {
    expect(couponRefusal(live, {}, cart, NOW)).toBeNull();
  });

  it('refuses a coupon that has since expired', () => {
    expect(
      couponRefusal({ ...live, endsAt: new Date('2026-06-01T00:00:00Z') }, {}, cart, NOW),
    ).toEqual({ reason: 'EXPIRED' });
  });

  it('refuses a coupon that has not started', () => {
    expect(
      couponRefusal({ ...live, startsAt: new Date('2026-07-01T00:00:00Z') }, {}, cart, NOW),
    ).toEqual({ reason: 'NOT_STARTED' });
  });

  it('refuses a coupon at its usage cap', () => {
    expect(couponRefusal({ ...live, usageLimit: 1, usageCount: 1 }, {}, cart, NOW)).toEqual({
      reason: 'EXHAUSTED',
    });
  });

  it('refuses once the cart falls below the minimum', () => {
    expect(couponRefusal(live, { minTotalUsd: '150' }, cart, NOW)).toEqual({
      reason: 'BELOW_MINIMUM',
      minTotalUsd: '150',
    });
  });

  it('refuses once a required item leaves the cart', () => {
    expect(couponRefusal(live, { requiresAllVariantIds: ['v1', 'v3'] }, cart, NOW)).toEqual({
      reason: 'MISSING_REQUIRED',
    });
  });

  it('refuses a coupon somebody switched off', () => {
    expect(couponRefusal({ ...live, isActive: false }, {}, cart, NOW)).toEqual({
      reason: 'INACTIVE',
    });
  });
});
