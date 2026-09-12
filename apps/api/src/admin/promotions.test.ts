import { describe, expect, it } from 'vitest';

import { createPromotionSchema, promotionCodeSchema } from '@da/contracts';

import { promotionState } from './promotions.service.js';

const JAN = new Date('2026-01-15T12:00:00Z');
const base = {
  isActive: true,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usageCount: 0,
  now: JAN,
};

/**
 * Guards what the panel says about a coupon.
 *
 * `isActive` is a person's last toggle and nothing more; whether a code works
 * depends equally on its window and its cap. Every wrong answer here is one
 * somebody acts on — hunting for a date on a coupon that ran out, or telling a
 * customer a code is live when it stopped at midnight.
 */
describe('promotionState', () => {
  it('is live with nothing limiting it', () => {
    expect(promotionState(base)).toBe('LIVE');
  });

  it('is off when somebody switched it off, whatever the dates say', () => {
    // The one control somebody reaches for in a hurry has to win outright.
    expect(
      promotionState({
        ...base,
        isActive: false,
        startsAt: new Date('2026-01-01T00:00:00Z'),
        endsAt: new Date('2026-12-31T00:00:00Z'),
      }),
    ).toBe('OFF');
  });

  it('is scheduled before its window opens', () => {
    expect(promotionState({ ...base, startsAt: new Date('2026-02-01T00:00:00Z') })).toBe(
      'SCHEDULED',
    );
  });

  it('is expired after its window closes', () => {
    expect(promotionState({ ...base, endsAt: new Date('2026-01-01T00:00:00Z') })).toBe('EXPIRED');
  });

  it('is live on the last day of its window, not expired', () => {
    // A coupon written as "ends 15 January" must still work on the 15th; the
    // panel stores the end of that day, and an off-by-one here takes a code
    // down a day early in the middle of a campaign.
    expect(promotionState({ ...base, endsAt: new Date('2026-01-15T23:59:59Z') })).toBe('LIVE');
  });

  it('is exhausted at its limit, and stays so after the window closes', () => {
    expect(promotionState({ ...base, usageLimit: 50, usageCount: 50 })).toBe('EXHAUSTED');
    // "Expired" here would send somebody to look at the calendar when the
    // answer is the cap.
    expect(
      promotionState({
        ...base,
        usageLimit: 50,
        usageCount: 50,
        endsAt: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toBe('EXHAUSTED');
  });

  it('is live one redemption short of the limit', () => {
    expect(promotionState({ ...base, usageLimit: 50, usageCount: 49 })).toBe('LIVE');
  });
});

/**
 * Guards the code itself.
 *
 * A coupon is read off a banner or a message and typed by hand, so the two
 * ends have to agree on one spelling. The checkout matches case-insensitively;
 * storing one casing is what keeps "ZZ20" and "zz20" from becoming two codes
 * with separate usage counts.
 */
describe('promotionCodeSchema', () => {
  it('uppercases what was typed', () => {
    expect(promotionCodeSchema.parse('ramadan20')).toBe('RAMADAN20');
  });

  it('trims, because a code pasted from a message brings whitespace', () => {
    expect(promotionCodeSchema.parse('  SALE10  ')).toBe('SALE10');
  });

  it('refuses a space, which is the one thing a hand-typed code cannot carry', () => {
    expect(promotionCodeSchema.safeParse('EID SALE').success).toBe(false);
  });

  it('refuses Arabic-Indic digits, which look right and are not', () => {
    // ٢٠ and 20 are indistinguishable on a banner and different strings here.
    expect(promotionCodeSchema.safeParse('EID٢٠').success).toBe(false);
  });

  it('keeps a dash, which is how a long code stays readable', () => {
    expect(promotionCodeSchema.parse('back-to-school')).toBe('BACK-TO-SCHOOL');
  });
});

describe('createPromotionSchema', () => {
  const minimal = { name: 'Campaign', value: '20.00' };

  it('refuses a percentage over 100, which would pay the customer', () => {
    const result = createPromotionSchema.safeParse({ ...minimal, type: 'PERCENT', value: '140' });
    expect(result.success).toBe(false);
  });

  it('allows a fixed amount over 100, because $140 off is a real offer', () => {
    expect(
      createPromotionSchema.safeParse({ ...minimal, type: 'FIXED', value: '140.00' }).success,
    ).toBe(true);
  });

  it('refuses a window that ends before it starts', () => {
    const result = createPromotionSchema.safeParse({
      ...minimal,
      startsAt: '2026-03-01T00:00:00.000Z',
      endsAt: '2026-02-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('defaults to a cart-wide percentage, one per customer, switched on', () => {
    const parsed = createPromotionSchema.parse(minimal);
    expect(parsed.type).toBe('PERCENT');
    expect(parsed.scope).toBe('CART');
    expect(parsed.perCustomerLimit).toBe(1);
    expect(parsed.isActive).toBe(true);
  });

  it('accepts an automatic promotion with no code at all', () => {
    // `Promotion.code` is nullable for exactly this: an offer that applies
    // without anybody typing anything.
    expect(createPromotionSchema.safeParse(minimal).success).toBe(true);
  });
});
