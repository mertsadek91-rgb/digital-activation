import type { CatalogVariant, DisplayPrice, FulfillmentMode, Order } from '@da/contracts';
import type { createTranslator, Messages } from 'next-intl';

import { isArabic } from '../i18n/locale';

/** The part of a variant that describes its term. A cart line carries it too. */
type LicenceTerm = Pick<CatalogVariant, 'licensePeriodValue' | 'licensePeriodUnit'>;

/**
 * The `format` namespace's translator — `useTranslations('format')` in a
 * client component, `await getTranslations('format')` on the server. The
 * helpers take it rather than a locale so that the wording lives in the
 * message files with everything else, and so a client component formats with
 * the same messages the server rendered it with.
 */
export type FormatT = ReturnType<typeof createTranslator<Messages, 'format'>>;

/**
 * Presentation helpers.
 *
 * Prices render with Latin digits in both locales — that is how Gulf commerce
 * writes them, and mixing digit systems in one page reads as a rendering fault
 * rather than a localisation.
 */
export function formatPrice(price: Pick<DisplayPrice, 'amount' | 'currency'>): string {
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: price.currency,
    currencyDisplay: 'narrowSymbol',
    numberingSystem: 'latn',
  }).format(Number(price.amount));
  return amount;
}

/**
 * A whole amount in a currency — a price band's edge, not a price. Same
 * symbol and digits as `formatPrice`, no decimals: "under 94" is a band, and
 * "under 93.75" reads like a price somebody forgot to round.
 */
export function formatWholeAmount(amount: string, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    numberingSystem: 'latn',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Number(amount));
}

/**
 * The licence term in words.
 *
 * Takes only the two fields it reads, not a whole variant. A cart line carries
 * the same two and nothing else, and there is no reason for the cart to be
 * unable to describe its own contents.
 *
 * The counted forms are ICU plurals in `format.period`. Arabic needs all six
 * agreements, and getting this wrong is immediately visible: "3 سنة" instead
 * of "3 سنوات", or "11 أشهر" where it should be "11 شهراً".
 */
export function formatLicensePeriod(variant: LicenceTerm, t: FormatT): string {
  const unit = variant.licensePeriodUnit;
  if (unit === 'LIFETIME') return t('lifetime');

  const value = variant.licensePeriodValue ?? 1;
  // A unit the contract grows before these messages do still prints its number.
  if (unit !== 'DAY' && unit !== 'MONTH' && unit !== 'YEAR') return String(value);
  return t(`period.${unit}`, { count: value });
}

/**
 * The platform in words. It was the enum lower-cased — "windows",
 * "cross platform" — which is English on the Arabic page and not quite
 * English on the English one.
 */
export function formatPlatform(platform: CatalogVariant['platform'], t: FormatT): string {
  return t(`platform.${platform}`);
}

export function formatDevices(count: number, t: FormatT): string {
  // Zero is how the catalog writes "no limit", not a count of nothing.
  if (count === 0) return t('devicesUnlimited');
  return t('devices', { count });
}

/**
 * The delivery promise, stated in the units a buyer thinks in.
 *
 * "Instant" is reserved for a key that is already held. Most of this catalog
 * is bought from a supplier after the order arrives, and calling that instant
 * would be a promise the store cannot keep — so a made-to-order line states
 * the window and says it starts from the moment of purchase, which is the
 * thing the buyer actually wants to know.
 */
export function formatDelivery(
  seconds: number,
  t: FormatT,
  mode: FulfillmentMode = 'FROM_STOCK',
): string {
  const fromStock = mode === 'FROM_STOCK';

  if (seconds <= 120) {
    if (fromStock) return t('delivery.instant');
    // The supplier is fast, but a person still places the order.
    return t('delivery.fast');
  }

  const window =
    seconds < 3600
      ? t('delivery.minutes', { count: Math.round(seconds / 60) })
      : t('delivery.hours', { count: Math.round(seconds / 3600) });

  if (fromStock) return t('delivery.within', { window });
  return t('delivery.withinOfPurchase', { window });
}

/**
 * How the store describes the way a line is supplied.
 *
 * `inStock` is not decoration. The three variants this shop sells most —
 * Windows 11 Pro, Windows 10 Pro, Office 2021 — are the ones kept in stock,
 * and when the shelf is empty the page said "متوفّر لدينا — يُسلَّم فوراً"
 * two lines above a buy box saying "غير متوفر حالياً". A specification table
 * that contradicts the button beside it is worse than a missing row: the
 * shopper has to decide which half of the page to believe.
 *
 * It is optional because the cart calls this about a line already held, where
 * availability is settled and the mode is all there is to say.
 *
 * None of these strings says "supplier". Where the shop buys from is the
 * shop's business, and a buyer told their key is "being ordered from the
 * supplier" learns two things they did not ask about — that the shop does not
 * hold it, and that somebody else does — in place of the one thing they want,
 * which is when it arrives. The waiting state is "قيد التجهيز", being
 * prepared. The comments in this file still say supplier, because why a line
 * is bought after the sale rather than before it is something the next person
 * editing this code has to understand; the rule is about the strings, which
 * are `format.fulfillment` in the message files.
 */
export function formatFulfillment(mode: FulfillmentMode, t: FormatT, inStock?: boolean): string {
  switch (mode) {
    case 'FROM_STOCK':
      if (inStock === false) return t('fulfillment.fromStockOut');
      return t('fulfillment.fromStock');
    case 'ON_DEMAND':
      return t('fulfillment.onDemand');
    case 'MANUAL_SETUP':
      return t('fulfillment.manualSetup');
  }
}

export function formatActivation(method: string, t: FormatT): string {
  const key = `activation.${method}` as `activation.${CatalogVariant['activationMethod']}`;
  return t.has(key) ? t(key) : method;
}

/*
 * Order wording.
 *
 * Moved here from the order confirmation page when the account area grew an
 * order list, because the two pages show the same order and a customer who
 * reads "قيد التجهيز" on one and something else on the other reads it
 * as two different things happening.
 *
 * The English statuses (`format.orderStatus` in en.json) exist because both
 * pages printed the enum with its underscores removed, so an English customer
 * was told their order was `PENDING PAYMENT` — the database's word for it, in
 * capitals, which reads as a fault rather than as "we are waiting for your
 * transfer". They are the Arabic meanings, not new promises: each one says the
 * same thing its Arabic counterpart says.
 */
export function formatOrderStatus(status: Order['status'], t: FormatT): string {
  const key = `orderStatus.${status}` as const;
  // Falls back to the enum without its underscores for a status nobody has
  // translated yet: a word in capitals is poor, and a blank is worse.
  return t.has(key) ? t(key) : status.replace(/_/g, ' ');
}

/** Where one line of an order has got to. */
export function formatLineState(
  state: Order['lines'][number]['fulfillmentState'],
  t: FormatT,
): string {
  const key = `lineState.${state}` as const;
  return t.has(key) ? t(key) : state;
}

/** Short label for a variant picker button, or for a cart line. */
export function variantLabel(variant: LicenceTerm & { deviceCount: number }, t: FormatT): string {
  return `${formatLicensePeriod(variant, t)} · ${formatDevices(variant.deviceCount, t)}`;
}

/**
 * A publication date, in the reader's own calendar convention.
 *
 * Gregorian in both languages with Latin digits, which is what the store this
 * replaces prints and what a reader comparing two posts needs: `ar-SA` would
 * give Hijri dates that do not line up with the Gregorian ones in the article
 * bodies, and Eastern Arabic numerals that no other number on this site uses.
 */
export function formatArticleDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(isArabic(locale) ? 'ar' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    calendar: 'gregory',
    numberingSystem: 'latn',
  }).format(date);
}

/** "٥ دقائق قراءة" — the plural rules Arabic needs, not a bare number. */
export function readingLabel(minutes: number, t: FormatT): string {
  return t('reading', { count: minutes });
}
