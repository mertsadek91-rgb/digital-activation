import { describe, expect, it } from 'vitest';

import { Prisma, RiskLevel } from '@da/db';

import { chargeMatches, orderCharge, riskFromStripe } from './charge.js';

const d = (value: string) => new Prisma.Decimal(value);

/**
 * Guards the number a card is charged.
 *
 * The webhook compares Stripe's amount against `orderCharge`, so every case
 * here is a case where a wrong answer either releases a key for less than it
 * costs or holds a correctly paid order for review.
 */
describe('orderCharge', () => {
  it('charges dollars as the order total', () => {
    expect(orderCharge({ totalUsd: d('49.90'), currency: 'USD', fxRate: d('1') }, null)).toEqual({
      amount: '49.90',
      currency: 'USD',
    });
  });

  it("uses the rate frozen on the order, not today's", () => {
    const charge = orderCharge(
      { totalUsd: d('10.00'), currency: 'AED', fxRate: d('3.6725') },
      { decimals: 2, roundingRule: 'none' },
    );
    expect(charge).toEqual({ amount: '36.73', currency: 'AED' });
  });

  it('falls back to dollars when the currency is no longer known', () => {
    // Recording AED beside a rate nobody can vouch for would charge an
    // invented amount; dollars are at least the number the order stores.
    expect(
      orderCharge({ totalUsd: d('10.00'), currency: 'AED', fxRate: d('3.6725') }, null),
    ).toEqual({ amount: '10.00', currency: 'USD' });
  });

  it('keeps three decimals for currencies counted in thousandths', () => {
    const charge = orderCharge(
      { totalUsd: d('10.00'), currency: 'KWD', fxRate: d('0.3071') },
      { decimals: 3, roundingRule: 'none' },
    );
    expect(charge).toEqual({ amount: '3.071', currency: 'KWD' });
  });
});

describe('chargeMatches', () => {
  it('accepts the exact amount in minor units', () => {
    expect(
      chargeMatches({ amount: '49.90', currency: 'USD' }, { amountMinor: 4990, currency: 'usd' }),
    ).toBe(true);
  });

  it('refuses a stale intent for a cheaper draft', () => {
    // The attack: open an intent for a $5 cart, grow the cart to $500, then
    // confirm the $5 intent. The order must not be marked paid.
    expect(
      chargeMatches({ amount: '500.00', currency: 'USD' }, { amountMinor: 500, currency: 'USD' }),
    ).toBe(false);
  });

  it('refuses the right number in the wrong currency', () => {
    expect(
      chargeMatches({ amount: '36.73', currency: 'AED' }, { amountMinor: 3673, currency: 'USD' }),
    ).toBe(false);
  });
});

describe('riskFromStripe', () => {
  it('holds elevated risk and blocks the highest', () => {
    expect(riskFromStripe('elevated')).toBe(RiskLevel.HIGH);
    expect(riskFromStripe('highest')).toBe(RiskLevel.BLOCKED);
  });

  it('lets normal and unknown verdicts through', () => {
    expect(riskFromStripe('normal')).toBe(RiskLevel.LOW);
    expect(riskFromStripe(null)).toBe(RiskLevel.LOW);
    expect(riskFromStripe(undefined)).toBe(RiskLevel.LOW);
  });
});
