import { Prisma } from '@da/db';
import { describe, expect, it } from 'vitest';

import {
  costStanding,
  isLargeChange,
  markupForPrice,
  priceChange,
  proposePrice,
} from './pricing.js';

// TASK-0135: the owner types a price; the pinned markup must give it back.
describe('markupForPrice', () => {
  it.each([
    ['130.00', '195.00', 'CENTS', '50'],
    // 33.65% to 33.74% all give 13.37: the exact one is pinned, not the lowest.
    ['10.00', '13.37', 'CENTS', '33.7'],
    ['130.00', '199.00', 'CENTS', null],
    ['130.00', '199.00', 'WHOLE', null],
    ['130.00', '199.99', 'END_99', null],
    ['50.00', '75.99', 'END_99', null],
    ['100.00', '150.99', 'CENTS', null],
    ['3.33', '5.00', 'CENTS', null],
    ['7.25', '12.49', 'CENTS', null],
  ] as const)('%s → %s (%s)', (cost, target, rounding, markup) => {
    const found = markupForPrice(cost, target, rounding);
    if (found === null) throw new Error('no markup');
    expect(proposePrice(cost, found, rounding).toFixed(2)).toBe(target);
    expect(found.decimalPlaces()).toBeLessThanOrEqual(2);
    if (markup !== null) expect(found.toString()).toBe(markup);
  });

  // REV-0199: off the rounding grid, the nearest price the rule can make — on
  // either side — not the next one up.
  it.each([
    ['130.00', '199.00', 'END_99', '198.99'],
    ['10.00', '13.37', 'END_99', '12.99'],
    ['10.00', '13.60', 'END_99', '13.99'],
    ['0.37', '1.01', 'WHOLE', '1.00'],
    ['10.00', '13.40', 'WHOLE', '13.00'],
    // An even split goes up.
    ['10.00', '13.50', 'WHOLE', '14.00'],
  ] as const)('%s → %s (%s) lands on %s', (cost, target, rounding, landed) => {
    const found = markupForPrice(cost, target, rounding);
    if (found === null) throw new Error('no markup');
    expect(proposePrice(cost, found, rounding).toFixed(2)).toBe(landed);
  });

  // REV-0199: a proposal at or under cost is never chosen — apply would refuse it.
  it.each([
    ['1000.00', '1000.01', 'CENTS'],
    ['1000.00', '1000.04', 'CENTS'],
    ['10.00', '10.01', 'WHOLE'],
    ['10.00', '10.20', 'END_99'],
  ] as const)('%s → %s (%s) stays above cost', (cost, target, rounding) => {
    const found = markupForPrice(cost, target, rounding);
    if (found === null) throw new Error('no markup');
    expect(found.isPositive()).toBe(true);
    expect(proposePrice(cost, found, rounding).greaterThan(cost)).toBe(true);
  });

  // REV-0201: many markups make one WHOLE or END_99 price; the pinned one is
  // the typed price's own percentage when it is among them, since it sets
  // every later price as the cost moves.
  it.each([
    ['3.69', '8.78', 'WHOLE', '137.94', '9.00'],
    ['3.69', '8.78', 'END_99', '137.94', '8.99'],
    // 59.375% exactly: 59.37 and 59.38 are as near; the first found stays.
    ['0.32', '0.51', 'WHOLE', '59.37', '1.00'],
    ['0.08', '0.16', 'WHOLE', '100', '1.00'],
    ['87.35', '194.66', 'WHOLE', '122.85', '195.00'],
    // REV-0203: the typed percentage is over 1000%, but 1000% makes the nearest price.
    ['0.05', '0.99', 'WHOLE', '1000', '1.00'],
    ['0.07', '0.82', 'END_99', '1000', '0.99'],
    ['0.43', '4.99', 'WHOLE', '1000', '5.00'],
    ['0.90', '10.00', 'END_99', '1000', '9.99'],
  ] as const)('%s → %s (%s) pins %s%%', (cost, target, rounding, markup, landed) => {
    const found = markupForPrice(cost, target, rounding);
    if (found === null) throw new Error('no markup');
    expect(found.toString()).toBe(markup);
    expect(proposePrice(cost, found, rounding).toFixed(2)).toBe(landed);
  });

  it('gives null when only a markup above 1000% would do', () => {
    expect(markupForPrice('10.00', '200.00', 'CENTS')).toBeNull();
    expect(markupForPrice('10.00', '110.00', 'CENTS')?.toString()).toBe('1000');
  });
});

describe('costStanding', () => {
  const d = (value: string) => new Prisma.Decimal(value);
  it('compares today’s price with the cost, to the cent', () => {
    expect(costStanding(d('9.99'), d('10.00'))).toBe('BELOW');
    expect(costStanding(d('10.00'), d('10.00'))).toBe('AT');
    expect(costStanding(d('10.001'), d('10.00'))).toBe('AT');
    expect(costStanding(d('10.01'), d('10.00'))).toBe('ABOVE');
  });
  it('says nothing without a cost', () => {
    expect(costStanding(d('10.00'), null)).toBeNull();
    expect(costStanding(d('10.00'), d('0'))).toBeNull();
  });
});

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
