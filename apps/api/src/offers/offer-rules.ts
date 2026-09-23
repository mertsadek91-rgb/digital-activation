import type { OfferSettings, SeasonalSale, SeasonalSettings } from '@da/contracts';
import { Prisma } from '@da/db';

/**
 * The basket-offer rules, as plain functions.
 *
 * No database and no clock of their own — `now` is passed in — so every rule
 * that decides money here is tested directly (offer-rules.test.ts) rather than
 * through a cart render. The services only fetch and write.
 */

// --- seasonal sales --------------------------------------------------------

/** A sale in force, with its categories widened to their descendants. */
export interface LiveSale {
  id: string;
  name: SeasonalSale['name'];
  percent: number;
  startsAt: Date;
  endsAt: Date;
  productIds: ReadonlySet<string>;
  categoryIds: ReadonlySet<string>;
  licenceNumber: string;
  showCountdown: boolean;
  /** No products and no categories: the whole catalogue. */
  wholeCatalogue: boolean;
}

/**
 * Every descendant of the given categories, the categories included.
 *
 * A sale on "Microsoft" is meant to reach "Office" and "Windows" under it; a
 * product linked only to the leaf would otherwise sit outside a sale its own
 * shelf is advertising.
 */
export function withDescendants(
  ids: readonly string[],
  categories: readonly { id: string; parentId: string | null }[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const category of categories) {
    if (!category.parentId) continue;
    const list = children.get(category.parentId) ?? [];
    list.push(category.id);
    children.set(category.parentId, list);
  }
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue; // a cycle in hand-edited data must not hang a render
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

/**
 * The sales running at `now`: the feature on, the window open
 * (`startsAt <= now < endsAt`), and a percent worth showing.
 */
export function liveSales(
  settings: SeasonalSettings,
  now: Date,
  categories: readonly { id: string; parentId: string | null }[],
): LiveSale[] {
  if (!settings.enabled) return [];
  return settings.sales
    .filter((sale) => {
      const starts = new Date(sale.startsAt);
      const ends = new Date(sale.endsAt);
      return sale.percent > 0 && starts <= now && now < ends;
    })
    .map((sale) => ({
      id: sale.id,
      name: sale.name,
      percent: sale.percent,
      startsAt: new Date(sale.startsAt),
      endsAt: new Date(sale.endsAt),
      productIds: new Set(sale.productIds),
      categoryIds: withDescendants(sale.categoryIds, categories),
      licenceNumber: sale.licenceNumber,
      showCountdown: sale.showCountdown,
      wholeCatalogue: sale.productIds.length === 0 && sale.categoryIds.length === 0,
    }));
}

export function saleCovers(
  sale: LiveSale,
  product: { id: string; categoryIds: readonly string[] },
): boolean {
  if (sale.wholeCatalogue) return true;
  if (sale.productIds.has(product.id)) return true;
  return product.categoryIds.some((id) => sale.categoryIds.has(id));
}

/**
 * The one sale that prices a product, when several overlap.
 *
 * The deepest wins — the shopper gets the best price on the shelf, and it is
 * the one they were shown. On a tie, the one that runs longer, so a countdown
 * never counts to an end after which the same price carries on.
 */
export function saleFor(
  sales: readonly LiveSale[],
  product: { id: string; categoryIds: readonly string[] },
): LiveSale | null {
  let best: LiveSale | null = null;
  for (const sale of sales) {
    if (!saleCovers(sale, product)) continue;
    if (
      !best ||
      sale.percent > best.percent ||
      (sale.percent === best.percent && sale.endsAt > best.endsAt)
    ) {
      best = sale;
    }
  }
  return best;
}

// --- volume tiers ----------------------------------------------------------

export interface Tier {
  minItems: number;
  percent: number;
}

/** The tier a cart of `count` licences has reached: the highest threshold met. */
export function tierFor(tiers: readonly Tier[], count: number): Tier | null {
  let best: Tier | null = null;
  for (const tier of tiers) {
    if (tier.percent <= 0 || count < tier.minItems) continue;
    if (!best || tier.minItems > best.minItems) best = tier;
  }
  return best;
}

/**
 * The next tier worth adding for: the nearest threshold above `count` that
 * gives more than the current one. A later tier that gives less (a
 * misconfiguration) is never the carrot.
 */
export function nextTier(
  tiers: readonly Tier[],
  count: number,
): (Tier & { itemsToGo: number }) | null {
  const current = tierFor(tiers, count)?.percent ?? 0;
  let next: Tier | null = null;
  for (const tier of tiers) {
    if (tier.minItems <= count || tier.percent <= current) continue;
    if (!next || tier.minItems < next.minItems) next = tier;
  }
  return next ? { ...next, itemsToGo: next.minItems - count } : null;
}

// --- pairs -----------------------------------------------------------------

export interface PricedLine {
  productId: string;
  qty: number;
  unitPriceUsd: Prisma.Decimal;
}

/**
 * What the curated pairs take off a cart.
 *
 * A suggested product is discounted only beside the product it was suggested
 * for, and only as many times as that product is there: one antivirus with
 * one Windows licence, not five antiviruses on the strength of one Windows.
 * Each suggested line takes the largest percent any of its anchors gives —
 * a line is discounted once. The anchor itself is not discounted.
 */
export function pairDiscount(
  lines: readonly PricedLine[],
  pairs: OfferSettings['pairs'],
): { discountUsd: Prisma.Decimal; percent: number; matched: boolean } {
  const qtyOf = new Map<string, number>();
  for (const line of lines) qtyOf.set(line.productId, (qtyOf.get(line.productId) ?? 0) + line.qty);

  let discountUsd = new Prisma.Decimal(0);
  let percent = 0;
  let matched = false;

  for (const line of lines) {
    let linePercent = 0;
    let anchorQty = 0;
    for (const pair of pairs) {
      if (pair.productId === line.productId) continue;
      if (!pair.suggestProductIds.includes(line.productId)) continue;
      const anchors = qtyOf.get(pair.productId) ?? 0;
      if (anchors === 0) continue;
      matched = true;
      anchorQty += anchors;
      linePercent = Math.max(linePercent, pair.discountPercent);
    }
    if (linePercent <= 0) continue;
    const units = Math.min(line.qty, anchorQty);
    discountUsd = discountUsd.plus(
      line.unitPriceUsd.times(units).times(linePercent).dividedBy(100),
    );
    percent = Math.max(percent, linePercent);
  }

  return { discountUsd: discountUsd.toDecimalPlaces(2), percent, matched };
}

// --- one discount per cart -------------------------------------------------

export type DiscountKind = 'coupon' | 'volume' | 'pair';

export interface DiscountCandidate {
  kind: DiscountKind;
  amountUsd: Prisma.Decimal;
}

const TIE_ORDER: Record<DiscountKind, number> = { coupon: 0, volume: 1, pair: 2 };

/**
 * The single discount a cart gets: the largest. Never a sum.
 *
 * A tie goes to the coupon — the shopper typed it, and taking theirs away for
 * one of ours that saves them nothing more would be a surprise for no reason.
 */
export function bestDiscount(candidates: readonly DiscountCandidate[]): DiscountCandidate | null {
  let best: DiscountCandidate | null = null;
  for (const candidate of candidates) {
    if (candidate.amountUsd.lessThanOrEqualTo(0)) continue;
    if (
      !best ||
      candidate.amountUsd.greaterThan(best.amountUsd) ||
      (candidate.amountUsd.equals(best.amountUsd) &&
        TIE_ORDER[candidate.kind] < TIE_ORDER[best.kind])
    ) {
      best = candidate;
    }
  }
  return best;
}

/** A tier's amount on a subtotal, to the cent. */
export function volumeDiscountUsd(subtotalUsd: Prisma.Decimal, tier: Tier | null): Prisma.Decimal {
  if (!tier) return new Prisma.Decimal(0);
  return subtotalUsd.times(tier.percent).dividedBy(100).toDecimalPlaces(2);
}
