/**
 * Price display.
 *
 * Everything is stored in USD. A display currency is produced here, and the
 * returned object is the same one handed to the structured-data builder — which
 * is how the legacy bug of printing "د.إ36.36" while declaring "36.36 USD" is
 * made unrepresentable.
 */
import type { AppLocale, CurrencyCode } from '@da/contracts';

export interface CurrencyConfig {
  code: CurrencyCode;
  decimals: number;
  /** "none" | "nearest_0_95" | "nearest_9" — applied after conversion. */
  roundingRule: string;
}

export interface DisplayPrice {
  /** Decimal string in `currency`. Feed this to the JSON-LD builder verbatim. */
  amount: string;
  currency: CurrencyCode;
  /** Localised, symbol placed correctly for the locale. */
  formatted: string;
}

const LOCALE_TAG: Record<AppLocale, string> = { ar: 'ar', en: 'en' };

function applyRounding(value: number, rule: string, decimals: number): number {
  switch (rule) {
    // Keeps a converted price reading like a price: 37.12 -> 36.95.
    case 'nearest_0_95': {
      const floor = Math.floor(value);
      const candidates = [floor - 1 + 0.95, floor + 0.95];
      return candidates.reduce((best, candidate) =>
        Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best,
      );
    }
    case 'nearest_9':
      return Math.max(0, Math.round(value) - (((Math.round(value) % 10) - 9 + 10) % 10));
    default:
      return Number(value.toFixed(decimals));
  }
}

/**
 * @param amountUsd decimal string from the database
 * @param rate      units of `config.code` per 1 USD, from FxRate
 */
export function toDisplayPrice(
  amountUsd: string,
  rate: number,
  config: CurrencyConfig,
  locale: AppLocale,
): DisplayPrice {
  const converted = Number(amountUsd) * rate;
  const rounded = applyRounding(converted, config.roundingRule, config.decimals);
  const amount = rounded.toFixed(config.decimals);

  const formatted = new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency: config.code,
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals,
    // Latin digits in both locales: Gulf e-commerce prices are written this way,
    // and mixed digit systems in one page read as a rendering bug.
    numberingSystem: 'latn',
  }).format(rounded);

  return { amount, currency: config.code, formatted };
}

/** Discount percentage for the "save X%" anchor, or null when there is none. */
export function discountPercent(priceUsd: string, compareAtUsd: string | null): number | null {
  if (!compareAtUsd) return null;
  const price = Number(priceUsd);
  const compare = Number(compareAtUsd);
  if (!(compare > price) || compare <= 0) return null;
  return Math.round(((compare - price) / compare) * 100);
}
