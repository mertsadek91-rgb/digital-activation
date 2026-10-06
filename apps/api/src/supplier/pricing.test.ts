import { Prisma } from '@da/db';
import { describe, expect, it } from 'vitest';

import { isLargeChange, priceChange, proposePrice } from './pricing.js';

describe('proposePrice', () => {
  it('marks cost up by the percentage: 50% is cost × 1.5', () => {
    expect(proposePrice('10.00', 50, 'CENTS').toFixed(2)).toBe('15.00');
    expect(proposePrice('1.50', 50, 'CENTS').toFixed(2)).toBe('2.25');
    // 4.995 rounds half up.
    expect(proposePrice('3.33', '50', 'CENTS').toFixed(2)).toBe('5.00');
  });

  it('honours other markups', () => {
    expect(proposePrice('20.00', 0, 'CENTS').toFixed(2)).toBe('20.00');
    expect(proposePrice('20.00', '37.5', 'CENTS').toFixed(2)).toBe('27.50');
    expect(proposePrice('8.00', 100, 'CENTS').toFixed(2)).toBe('16.00');
  });

  it('rounds to .99 without undercutting the raw price', () => {
    expect(proposePrice('10.00', 52, 'END_99').toFixed(2)).toBe('15.99');
    expect(proposePrice('10.00', 50, 'END_99').toFixed(2)).toBe('15.99');
    expect(proposePrice('10.66', 50, 'END_99').toFixed(2)).toBe('15.99');
    // 16.005 is above 15.99, so the next dollar.
    expect(proposePrice('10.67', 50, 'END_99').toFixed(2)).toBe('16.99');
  });

  it('rounds up to the whole dollar', () => {
    expect(proposePrice('10.00', 52, 'WHOLE').toFixed(2)).toBe('16.00');
    expect(proposePrice('10.00', 50, 'WHOLE').toFixed(2)).toBe('15.00');
  });
});

describe('priceChange', () => {
  it('is the fraction of the current price', () => {
    expect(priceChange(new Prisma.Decimal('10'), new Prisma.Decimal('13'))).toBeCloseTo(0.3);
    expect(priceChange(new Prisma.Decimal('0'), new Prisma.Decimal('13'))).toBeNull();
  });

  it('flags moves above 30% either way', () => {
    expect(isLargeChange(0.3)).toBe(false);
    expect(isLargeChange(0.31)).toBe(true);
    expect(isLargeChange(-0.5)).toBe(true);
    expect(isLargeChange(null)).toBe(false);
    // No current price to compare with: always a second look.
    expect(isLargeChange(null, new Prisma.Decimal('0'))).toBe(true);
    expect(isLargeChange(0.1, new Prisma.Decimal('10'))).toBe(false);
  });
});
