import { type Prisma, RiskLevel } from '@da/db';

import { convert } from '../catalog/pricing.js';

import { toMinorUnits } from './stripe.service.js';

/**
 * What an order costs, in the money it will be paid in.
 *
 * Derived from the order row alone: its USD total, its currency and the rate
 * frozen onto it at checkout. Not from the request's `?currency=` and not from
 * today's rate — either of those lets the amount charged drift away from the
 * amount the shopper agreed to, and the webhook compares against this same
 * function, so the two ends cannot disagree.
 *
 * `currencyRow` is the currency's decimals and rounding rule. Absent means the
 * store no longer knows the currency, and the honest answer is dollars.
 */
export function orderCharge(
  order: { totalUsd: Prisma.Decimal; currency: string; fxRate: Prisma.Decimal },
  currencyRow: { decimals: number; roundingRule: string } | null,
): { amount: string; currency: string } {
  if (order.currency === 'USD' || !currencyRow) {
    return { amount: order.totalUsd.toFixed(2), currency: 'USD' };
  }
  return convert(order.totalUsd, order.currency, {
    [order.currency]: {
      rate: order.fxRate,
      decimals: currencyRow.decimals,
      roundingRule: currencyRow.roundingRule,
    },
  });
}

/**
 * Whether what the provider took is what the order costs.
 *
 * Compared in minor units, because that is the only form both sides agree on
 * exactly: "36.95" and "36.950" are the same money and different strings.
 */
export function chargeMatches(
  expected: { amount: string; currency: string },
  received: { amountMinor: number; currency: string },
): boolean {
  return (
    expected.currency.toUpperCase() === received.currency.toUpperCase() &&
    toMinorUnits(expected.amount, expected.currency) === received.amountMinor
  );
}

/**
 * Stripe Radar's verdict, in this store's terms.
 *
 * `elevated` holds the order. That is stricter than a store selling physical
 * goods would be, on purpose: a card-testing ring cashes out through licence
 * keys precisely because a key cannot be recalled, and a held order costs a
 * person a minute where a released one costs the key and the chargeback fee.
 * `highest` is normally blocked by Radar before it gets here; if it ever does
 * arrive it is treated as blocked.
 */
export function riskFromStripe(riskLevel: string | null | undefined): RiskLevel {
  switch (riskLevel) {
    case 'highest':
      return RiskLevel.BLOCKED;
    case 'elevated':
      return RiskLevel.HIGH;
    default:
      return RiskLevel.LOW;
  }
}
