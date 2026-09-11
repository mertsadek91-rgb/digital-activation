import { describe, expect, it } from 'vitest';

import { type CurrencyConfig, discountPercent, toDisplayPrice } from './money.js';

/**
 * Guards the display price: the amount, its currency and the formatted string
 * must all describe the same number.
 *
 * The legacy store printed د.إ36.36 beside markup that declared 36.36 USD — the
 * AED figure labelled as dollars — and the amount fed to the structured-data
 * builder is the one produced here. A formatted string that disagrees with
 * `amount`, or Arabic-Indic digits in a Gulf price, are both silent: the page
 * renders, and only the markup or the customer notices.
 */
const config = (
  code: CurrencyConfig['code'],
  roundingRule: string,
  decimals = 2,
): CurrencyConfig => ({ code, decimals, roundingRule });

describe('toDisplayPrice', () => {
  it('labels the converted amount with the currency it was converted into', () => {
    const price = toDisplayPrice('9.90', 3.6725, config('AED', 'none'), 'ar');

    expect(price.amount).toBe('36.36');
    expect(price.currency).toBe('AED');
  });

  it('formats the same number it reports as the amount', () => {
    const price = toDisplayPrice('9.90', 3.6725, config('AED', 'none'), 'ar');

    expect(price.formatted).toContain(price.amount);
  });

  it('writes Latin digits in Arabic, because a mixed page reads as a rendering bug', () => {
    const price = toDisplayPrice('9.90', 3.75, config('SAR', 'none'), 'ar');

    expect(price.formatted).toMatch(/[0-9]/);
    expect(price.formatted).not.toMatch(/[٠-٩]/);
  });

  it('uses the decimal places the currency declares', () => {
    expect(toDisplayPrice('100', 0.3065, config('KWD', 'none', 3), 'ar').amount).toBe('30.650');
  });

  it('rounds nearest_0_95 to the nearer of the two candidates, in both directions', () => {
    const sar = config('SAR', 'nearest_0_95');

    expect(toDisplayPrice('9.90', 3.75, sar, 'en').amount).toBe('36.95');
    expect(toDisplayPrice('10.10', 3.75, sar, 'en').amount).toBe('37.95');
  });

  /**
   * Pinned rather than endorsed. `nearest_9` here subtracts down to the previous
   * number ending in 9 and floors at zero, so a price that converts to 5 units
   * comes out as 0 — free. `apps/api`'s `roundTo` implements the same rule name
   * by rounding to the nearest multiple of ten minus one, with a floor of 9, and
   * returns 39 where this returns 29 for the same input. Two implementations of
   * one rule name, disagreeing on every input. See the report.
   */
  it('nearest_9 rounds down to the previous 9 and can reach zero, unlike the API rule', () => {
    const egp = config('EGP', 'nearest_9');

    expect(toDisplayPrice('1.00', 37, egp, 'en').amount).toBe('29.00');
    expect(toDisplayPrice('1.00', 5, egp, 'en').amount).toBe('0.00');
  });

  it('leaves an unrecognised rounding rule alone rather than guessing at one', () => {
    expect(toDisplayPrice('9.90', 3.6725, config('AED', 'no-such-rule'), 'en').amount).toBe(
      '36.36',
    );
  });
});

describe('discountPercent', () => {
  it('returns null when there is no compare-at, so no discount is claimed', () => {
    expect(discountPercent('24.90', null)).toBeNull();
  });

  it('returns null when the compare-at is not above the price, which is a data error', () => {
    expect(discountPercent('24.90', '24.90')).toBeNull();
    expect(discountPercent('24.90', '19.90')).toBeNull();
  });

  it('computes the saving against the compare-at, rounded to a whole percent', () => {
    expect(discountPercent('9.90', '19.90')).toBe(50);
    expect(discountPercent('9.90', '29.90')).toBe(67);
  });
});
