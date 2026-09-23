import type { CatalogVariant, LocalizedText } from '@da/contracts';

import { isArabic } from '../i18n/locale';

import { type FormatT, formatDelivery } from './format';

/**
 * The configured text in the page's language, or nothing.
 *
 * No fallback to the other language. A guarantee is a promise, and one shown
 * in Arabic on an English page is a promise the reader cannot check; the
 * admin preview shows the empty half so it gets written instead.
 */
export function localText(text: LocalizedText, locale: string): string {
  return (isArabic(locale) ? text.ar : text.en).trim();
}

/**
 * A Maroof link, only when it is a real web address.
 *
 * The schema accepts any URL, and a `javascript:` one would be a script in the
 * footer of every page. Only https leaves this function.
 */
export function safeMaroofUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The delivery promise for a product, true for every variant a shopper can buy.
 *
 * The trust block is drawn once per product while the picker changes the
 * variant, so it states what holds across all of them rather than for the one
 * selected first:
 *
 *  - every purchasable variant is a stocked key → the store's configured
 *    instant-delivery wording (it is only ever shown for stock on the shelf);
 *  - otherwise → the slowest purchasable variant's real window, in the words
 *    the specification table uses. An upper bound is true of the faster ones
 *    too; "instant" would not be true of the slower ones.
 *
 * A stocked variant that is out of stock cannot be bought, so it does not
 * count either way. Nothing purchasable, nothing promised.
 */
export function deliveryPromise(
  variants: readonly Pick<CatalogVariant, 'fulfillmentMode' | 'inStock' | 'deliverySlaSeconds'>[],
  instantText: string,
  tf: FormatT,
): string | null {
  const purchasable = variants.filter(
    (variant) => variant.fulfillmentMode !== 'FROM_STOCK' || variant.inStock,
  );
  if (purchasable.length === 0) return null;

  const slowest = purchasable.reduce((a, b) =>
    b.deliverySlaSeconds > a.deliverySlaSeconds ? b : a,
  );
  const allStocked = purchasable.every((variant) => variant.fulfillmentMode === 'FROM_STOCK');
  if (allStocked && instantText) return instantText;
  return formatDelivery(slowest.deliverySlaSeconds, tf, slowest.fulfillmentMode);
}
