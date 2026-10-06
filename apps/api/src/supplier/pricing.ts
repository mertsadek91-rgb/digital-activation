import { LARGE_PRICE_CHANGE, type SupplierRounding } from '@da/contracts';
import { Prisma } from '@da/db';

/**
 * Selling price from supplier cost: cost × (1 + markup / 100), rounded.
 *
 * The owner's rule is a markup on cost — 50% turns a $10.00 cost into
 * $15.00 — not a margin on price (which would make it $20.00).
 *
 * Decimal arithmetic throughout: a float pass would turn 1.50 × 1.5 into
 * 2.2499999999999996 and round it down a cent.
 */
export function proposePrice(
  cost: Prisma.Decimal | string,
  markupPercent: Prisma.Decimal | string | number,
  rounding: SupplierRounding,
): Prisma.Decimal {
  const raw = new Prisma.Decimal(cost).times(new Prisma.Decimal(100).plus(markupPercent)).div(100);
  switch (rounding) {
    case 'WHOLE':
      return raw.toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL).toDecimalPlaces(2);
    case 'END_99': {
      // 15.20 → 15.99, 15.00 → 15.99. A raw price already above .99 of its
      // dollar (15.995) goes to the next one, so the result never undercuts it.
      const floor = raw.toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR);
      const candidate = floor.plus('0.99');
      return (candidate.lessThan(raw) ? candidate.plus(1) : candidate).toDecimalPlaces(2);
    }
    default:
      return raw.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
}

/** (next − current) / current, or null when there is no current price to compare. */
export function priceChange(current: Prisma.Decimal, next: Prisma.Decimal): number | null {
  if (current.lessThanOrEqualTo(0)) return null;
  return next.minus(current).div(current).toNumber();
}

/**
 * A change big enough to need a second look before a bulk apply. A variant
 * with no current price (0) has no baseline to compare with, so any proposal
 * for it counts as large.
 */
export function isLargeChange(change: number | null, current?: Prisma.Decimal): boolean {
  if (current?.lessThanOrEqualTo(0)) return true;
  return change !== null && Math.abs(change) > LARGE_PRICE_CHANGE;
}
