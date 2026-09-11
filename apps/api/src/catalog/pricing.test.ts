import { Prisma } from '@da/db';
import { describe, expect, it } from 'vitest';

import { type FxTable, convert, displayPrice } from './pricing.js';

/**
 * Guards the rule that the amount and the currency never travel apart.
 *
 * The legacy product page printed د.إ36.36 while its JSON-LD declared
 * `"price":"36.36","priceCurrency":"USD"` — the AED figure labelled as dollars.
 * Google discards markup that contradicts the page, so the store emitted rich
 * data and earned no rich results. The cases here are the ways this module could
 * reintroduce that: a converted amount carrying the wrong label, a missing rate
 * silently becoming an invented one, or a compare-at price in a different
 * currency from the price it is compared against.
 */
const usd = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

const FX: FxTable = {
  AED: { rate: usd('3.6725'), decimals: 2, roundingRule: 'none' },
  SAR: { rate: usd('3.75'), decimals: 2, roundingRule: 'nearest_0_95' },
  EGP: { rate: usd('48.5'), decimals: 2, roundingRule: 'nearest_9' },
  KWD: { rate: usd('0.3065'), decimals: 3, roundingRule: 'none' },
};

describe('convert', () => {
  it('returns USD untouched, at two decimals', () => {
    expect(convert(usd('9.9'), 'USD', FX)).toEqual({ amount: '9.90', currency: 'USD' });
  });

  it('labels a converted amount with the currency it was converted into', () => {
    expect(convert(usd('9.90'), 'AED', FX)).toEqual({ amount: '36.36', currency: 'AED' });
  });

  it('falls back to the USD amount AND the USD label when no rate is loaded', () => {
    // Half a fallback is the original bug: an unconverted number under a
    // foreign symbol. Either both change or neither does.
    expect(convert(usd('9.90'), 'TRY', FX)).toEqual({ amount: '9.90', currency: 'USD' });
  });

  it('uses the decimal places the currency declares, not a hard-coded two', () => {
    expect(convert(usd('100'), 'KWD', FX).amount).toBe('30.650');
  });
});

describe('displayPrice', () => {
  it('shows no compare-at when there is no real discount, so no false claim is made', () => {
    expect(displayPrice(usd('24.90'), usd('24.90'), 'USD', FX)).toEqual({
      amount: '24.90',
      currency: 'USD',
      compareAt: null,
      discountPercent: null,
    });
  });

  it('shows no compare-at when the compare-at is below the price', () => {
    expect(displayPrice(usd('24.90'), usd('19.90'), 'USD', FX).compareAt).toBeNull();
  });

  it('shows no compare-at when there is none at all', () => {
    expect(displayPrice(usd('24.90'), null, 'USD', FX).discountPercent).toBeNull();
  });

  it('converts the price and its compare-at into the same currency', () => {
    const price = displayPrice(usd('9.90'), usd('19.90'), 'AED', FX);

    expect(price).toEqual({
      amount: '36.36',
      currency: 'AED',
      compareAt: '73.08',
      discountPercent: 50,
    });
  });

  it('keeps the compare-at in USD too when the price fell back to USD', () => {
    // The fallback must not leave a USD price beside an AED compare-at.
    const price = displayPrice(usd('9.90'), usd('19.90'), 'TRY', FX);

    expect(price.currency).toBe('USD');
    expect(price).toMatchObject({ amount: '9.90', compareAt: '19.90' });
  });

  it('rounds the discount to a whole percent, computed from the stored USD figures', () => {
    expect(displayPrice(usd('9.90'), usd('29.90'), 'USD', FX).discountPercent).toBe(67);
  });
});

describe('psychological rounding', () => {
  it('nearest_0_95 lands a converted SAR price on .95', () => {
    expect(convert(usd('9.90'), 'SAR', FX).amount).toBe('37.95');
  });

  /**
   * Pinned, not endorsed. `roundTo` computes `Math.floor(x) + 0.95`, so a rule
   * named "nearest" only ever rounds UP — 37.12 becomes 37.95, never 36.95.
   * `@da/i18n`'s `applyRounding` implements the same rule name by picking the
   * nearer of the two candidates and would return 36.95 for this input. Two
   * implementations of one rule, disagreeing by up to a whole unit on four of
   * the seven seeded currencies. See the report; the behaviour is left as-is.
   */
  it('nearest_0_95 always rounds up, which is not what its name or @da/i18n says', () => {
    const fx: FxTable = { SAR: { rate: usd('3.75'), decimals: 2, roundingRule: 'nearest_0_95' } };

    // 9.90 USD converts to 37.125 SAR. The nearer candidate is 36.95.
    expect(convert(usd('9.90'), 'SAR', fx).amount).toBe('37.95');
    // And a conversion that lands exactly on a whole number gains 0.95.
    expect(convert(usd('10.40'), 'SAR', fx).amount).toBe('39.95');
  });

  it('nearest_9 lands an EGP price one below a multiple of ten', () => {
    expect(convert(usd('9.90'), 'EGP', FX).amount).toBe('479.00');
  });

  /**
   * Also pinned rather than endorsed: the `Math.max(9, …)` floor raises the
   * price of anything that converts below 5 units, and `@da/i18n`'s `nearest_9`
   * returns 29 where this returns 39 for the same input.
   */
  it('nearest_9 never goes below 9, which raises the price of a very cheap line', () => {
    const fx: FxTable = { EGP: { rate: usd('0.4'), decimals: 2, roundingRule: 'nearest_9' } };

    expect(convert(usd('10'), 'EGP', fx).amount).toBe('9.00');
  });
});
