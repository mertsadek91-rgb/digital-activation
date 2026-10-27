import { type CostStanding, LARGE_PRICE_CHANGE, type SupplierRounding } from '@da/contracts';
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

/**
 * The markup, to two decimals as stored, that turns `cost` into `target`
 * (TASK-0135: the owner types the price, the percentage is pinned).
 *
 * The rounding rule only makes some prices: any cent under CENTS, whole
 * dollars under WHOLE, x.99 under END_99. So the prices it can make on each
 * side of the target are tried — 198.99 and 199.99 for a typed 199.00 under
 * END_99. The proposal nearest the typed price wins (the higher one on an
 * even split).
 *
 * Many markups make the same price: on a 10.00 cost, 33.65% to 33.74% all
 * make 13.37, and under WHOLE a band several points wide makes each dollar.
 * The pinned markup sets every later price as the cost moves, so the one
 * nearest the typed price's own percentage is kept (REV-0201). That one is
 * the typed percentage itself when it falls in the band, or else one of the
 * band's two edges — so those three spots are searched, each with a few
 * two-decimal neighbours, since a two-decimal markup rarely sits exactly on
 * a boundary.
 *
 * A proposal at or under cost is never chosen: `applyPrices` would refuse
 * it. Null when the typed price lies beyond what 1000% makes (by half a step
 * of the rounding rule or more), or no markup up to 1000% makes a price above
 * cost.
 */
export function markupForPrice(
  cost: Prisma.Decimal | string,
  target: Prisma.Decimal | string,
  rounding: SupplierRounding,
): Prisma.Decimal | null {
  const base = new Prisma.Decimal(cost);
  const wanted = new Prisma.Decimal(target);
  const exactFor = (price: Prisma.Decimal) => price.div(base).minus(1).times(100);
  const exact = exactFor(wanted);

  let best: {
    markup: Prisma.Decimal;
    gap: Prisma.Decimal;
    drift: Prisma.Decimal;
    price: Prisma.Decimal;
  } | null = null;
  // Where to look: the typed price's own percentage, and both edges of the
  // band of markups that makes each reachable price (its top is the price
  // itself; under WHOLE and END_99 its bottom is just over the price a dollar
  // down).
  const reachable = reachablePrices(wanted, rounding);
  const anchors = [
    wanted,
    ...reachable,
    ...(rounding === 'CENTS' ? [] : reachable.map((price) => price.minus(1))),
  ];
  for (const anchor of anchors) {
    // Held inside the markups allowed: on a 0.05 cost a typed 0.99 is 1880%, yet
    // 1000% already makes the nearest price, 1.00 (REV-0203).
    const plain = Prisma.Decimal.min(
      1000,
      Prisma.Decimal.max(0, exactFor(anchor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
    );
    for (let step = -5; step <= 5; step += 1) {
      const markup = plain.plus(new Prisma.Decimal(step).div(100));
      if (markup.isNegative() || markup.greaterThan(1000)) continue;
      const proposal = proposePrice(base, markup, rounding);
      if (proposal.lessThanOrEqualTo(base)) continue;
      const gap = proposal.minus(wanted).abs();
      const drift = markup.minus(exact).abs();
      const better =
        best === null ||
        gap.lessThan(best.gap) ||
        (gap.equals(best.gap) && proposal.greaterThan(best.price)) ||
        (gap.equals(best.gap) && proposal.equals(best.price) && drift.lessThan(best.drift));
      if (better) best = { markup, gap, drift, price: proposal };
    }
  }
  // Beyond what 1000% can make by more than half a step of the rounding rule:
  // pinning 1000% would quietly propose far less than was typed, so refuse.
  const highest = proposePrice(base, 1000, rounding);
  const halfStep = new Prisma.Decimal(rounding === 'CENTS' ? '0.005' : '0.5');
  if (wanted.minus(highest).greaterThanOrEqualTo(halfStep)) return null;
  return best?.markup ?? null;
}

/** The prices the rounding rule can make nearest `target`: one on each side. */
function reachablePrices(target: Prisma.Decimal, rounding: SupplierRounding): Prisma.Decimal[] {
  switch (rounding) {
    case 'WHOLE':
      return [
        target.toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR),
        target.toDecimalPlaces(0, Prisma.Decimal.ROUND_CEIL),
      ];
    case 'END_99': {
      // 199.00 → 198.99 and 199.99; 199.99 → 199.99 and 200.99.
      const below = target
        .minus('0.99')
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_FLOOR)
        .plus('0.99');
      return [below, below.plus(1)];
    }
    default:
      return [target.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)];
  }
}

/** Today's price against the supplier's cost: at a loss, at cost, or above it. */
export function costStanding(
  current: Prisma.Decimal,
  cost: Prisma.Decimal | null,
): CostStanding | null {
  if (cost === null || cost.lessThanOrEqualTo(0)) return null;
  const compared = current.toDecimalPlaces(2).comparedTo(cost.toDecimalPlaces(2));
  return compared < 0 ? 'BELOW' : compared === 0 ? 'AT' : 'ABOVE';
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
