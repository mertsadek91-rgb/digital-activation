import type { DisplayPrice } from '@da/contracts';
import { type Prisma } from '@da/db';

/**
 * Price presentation.
 *
 * The single rule this file exists to enforce: the amount and the currency
 * travel together, from here to the page and from the page to the structured
 * data, as one object. The legacy store computed them separately and shipped a
 * product page that printed د.إ36.36 while its JSON-LD declared
 * `"price":"36.36","priceCurrency":"USD"` — the AED figure labelled as dollars.
 * Google discards markup that contradicts the page, so the store emitted rich
 * data and earned no rich results.
 *
 * Everything is stored in USD. Conversion happens once, here.
 */

export interface FxTable {
  /** Units of the target currency per 1 USD. */
  [currency: string]: { rate: Prisma.Decimal; decimals: number; roundingRule: string } | undefined;
}

/**
 * The only implementation of these rules in the codebase.
 *
 * `@da/i18n` carried a second one that disagreed with this on both rules and
 * was never imported; it is gone. If a display price needs computing anywhere
 * else, it comes from here.
 *
 * One thing to know before changing it: `nearest_0_95` always rounds **up** to
 * the next `.95`, so $9.90 at 3.75 shows as 37.95 rather than the nearer 36.95.
 * That is a pricing decision — four of the seven seeded currencies use the
 * rule — and it is recorded here rather than quietly corrected, because moving
 * it moves every converted price in the store.
 */
function roundTo(value: number, decimals: number, rule: string): number {
  const plain = Number(value.toFixed(decimals));
  if (rule === 'none') return plain;

  // Psychological rounding, so a converted price still reads like a price
  // rather than the output of a multiplication.
  if (rule === 'nearest_0_95') {
    const whole = Math.floor(plain);
    return whole + 0.95;
  }
  if (rule === 'nearest_9') {
    return Math.max(9, Math.round(plain / 10) * 10 - 1);
  }
  return plain;
}

export function convert(
  usd: Prisma.Decimal,
  currency: string,
  fx: FxTable,
): { amount: string; currency: string } {
  if (currency === 'USD') {
    return { amount: usd.toFixed(2), currency: 'USD' };
  }

  const entry = fx[currency];
  if (!entry) {
    // No rate loaded is not a reason to invent one. Falling back to USD keeps
    // the amount honest and the label correct, which is the whole point.
    return { amount: usd.toFixed(2), currency: 'USD' };
  }

  const converted = usd.times(entry.rate).toNumber();
  const rounded = roundTo(converted, entry.decimals, entry.roundingRule);
  return { amount: rounded.toFixed(entry.decimals), currency };
}

/**
 * A price with a seasonal sale applied, before conversion.
 *
 * Here rather than beside the sale settings because this file is the one
 * place prices are decided, and a sale is a price: the card, the product page,
 * its structured data and the cart line all read the result, so none of them
 * can show a different number.
 *
 * The compare-at becomes the real current price — the one the shopper would
 * pay tomorrow, when the sale ends — never an older or invented "was". A
 * variant's own compare-at is set aside while the sale runs, because two
 * strike-throughs are one claim too many and the older one is the less true.
 * Rounded to the cent in USD, half up, like every stored price.
 */
export function applySale(
  priceUsd: Prisma.Decimal,
  compareAtUsd: Prisma.Decimal | null,
  salePercent: number | null,
): { priceUsd: Prisma.Decimal; compareAtUsd: Prisma.Decimal | null } {
  if (salePercent === null || salePercent <= 0) return { priceUsd, compareAtUsd };
  const reduced = priceUsd
    .times(100 - salePercent)
    .dividedBy(100)
    .toDecimalPlaces(2);
  // A sale so small it rounds to nothing is not a sale; no strike-through for it.
  if (reduced.greaterThanOrEqualTo(priceUsd)) return { priceUsd, compareAtUsd };
  return { priceUsd: reduced, compareAtUsd: priceUsd };
}

export function displayPrice(
  priceUsd: Prisma.Decimal,
  compareAtUsd: Prisma.Decimal | null,
  currency: string,
  fx: FxTable,
): DisplayPrice {
  const price = convert(priceUsd, currency, fx);

  // A compare-at at or below the price is not an offer, it is a data error, and
  // showing it would be a false discount claim.
  const hasOffer = compareAtUsd !== null && compareAtUsd.greaterThan(priceUsd);
  const compare = hasOffer ? convert(compareAtUsd, price.currency, fx) : null;

  const discountPercent = hasOffer
    ? Math.round((1 - priceUsd.toNumber() / compareAtUsd.toNumber()) * 100)
    : null;

  return {
    amount: price.amount,
    currency: price.currency,
    compareAt: compare?.amount ?? null,
    discountPercent: discountPercent && discountPercent > 0 ? discountPercent : null,
  };
}
