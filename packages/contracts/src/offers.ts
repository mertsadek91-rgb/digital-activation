import { z } from 'zod';

import { catalogCardSchema } from './catalog.js';
import { seasonalSaleSchema } from './marketing.js';
import { localeSchema, moneySchema } from './primitives.js';

/**
 * Basket-size offers: "goes well with" suggestions, the order-side record of
 * which offer a sale used, and the panel's views of both.
 *
 * The pricing rules these rest on, in one place:
 *
 *  - A seasonal sale is a price, not a discount. It lowers the unit price
 *    everywhere a price is shown — cards, the product page, its structured
 *    data, the cart, the order — with the real current price as the
 *    compare-at. When it ends the price comes back, including on cart lines
 *    added during it.
 *  - Then one discount per cart: the largest of the coupon (typed, or a
 *    bundle the cart earned), the volume tier and the pair discount. They
 *    never stack. A tie goes to the coupon, because the shopper chose it.
 *  - A coupon may still apply on top of a sale price, unless the coupon says
 *    `excludeDiscounted` — then lines on sale are outside it, like lines with
 *    a compare-at. Volume tiers and pair discounts apply to the prices as they
 *    are, sale or not; they are one of the "one discount" candidates.
 */

// --- storefront ------------------------------------------------------------

export const offerSuggestionContextSchema = z.enum(['added', 'cart', 'confirmation']);
export type OfferSuggestionContext = z.infer<typeof offerSuggestionContextSchema>;

export const offerSuggestionsQuerySchema = z.object({
  /** Comma-separated product slugs the suggestions are for. */
  products: z
    .string()
    .max(2000)
    .transform((value) =>
      value
        .split(',')
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0)
        .slice(0, 20),
    ),
  context: offerSuggestionContextSchema,
  locale: localeSchema.default('ar'),
  currency: z.string().length(3).default('USD'),
});
export type OfferSuggestionsQuery = z.infer<typeof offerSuggestionsQuerySchema>;

export const offerSuggestionSchema = z.object({
  card: catalogCardSchema,
  /** The product in the cart (or order) this one was suggested for. */
  forProduct: z.object({ slug: z.string(), name: z.string() }),
  /**
   * Percent off this item when bought with that one, 0 for none. Taken in the
   * cart as the pair discount, which is one of the "one discount per cart"
   * candidates — so it is stated as "up to", never promised as additive.
   */
  pairPercent: z.number().min(0).max(90),
});
export type OfferSuggestion = z.infer<typeof offerSuggestionSchema>;

export const offerSuggestionsSchema = z.object({
  items: z.array(offerSuggestionSchema),
  /** The discount licence number, for any pair percent shown. */
  licenceNumber: z.string(),
});
export type OfferSuggestions = z.infer<typeof offerSuggestionsSchema>;

/**
 * "Complete your setup" on the order page.
 *
 * Adding one starts a new cart — the paid one is closed — and the order page
 * is opened by the cart cookie, which the new cart replaces. So the owner is
 * handed the order's signed link key with the suggestions, and the page puts
 * it in its own URL before adding anything, so a reload still opens.
 */
export const orderSuggestionsSchema = offerSuggestionsSchema.extend({
  accessKey: z.string(),
});
export type OrderSuggestions = z.infer<typeof orderSuggestionsSchema>;

// --- order record ----------------------------------------------------------

/**
 * Which offers an order used, written once when the order is drafted. What the
 * panel's offer figures are counted from; the money itself is already in the
 * order's `discountUsd` and line prices.
 */
export const orderOfferSnapshotSchema = z.object({
  discount: z.enum(['coupon', 'volume', 'pair']).nullable(),
  percent: z.number().nullable(),
  licenceNumber: z.string(),
  /** Sales that priced at least one line. */
  saleIds: z.array(z.string()),
  /** Whether the order held a curated pair, discounted or not. */
  pairMatched: z.boolean(),
});
export type OrderOfferSnapshot = z.infer<typeof orderOfferSnapshotSchema>;

// --- panel -----------------------------------------------------------------

/** Every product and category, for the offer and sale pickers. */
export const offerCatalogOptionsSchema = z.object({
  products: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      nameAr: z.string(),
      nameEn: z.string().nullable(),
      status: z.string(),
      categoryIds: z.array(z.string()),
    }),
  ),
  categories: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      nameAr: z.string(),
      nameEn: z.string().nullable(),
      parentId: z.string().nullable(),
    }),
  ),
  /** Sale dates are entered and shown in this zone. */
  timeZone: z.string(),
});
export type OfferCatalogOptions = z.infer<typeof offerCatalogOptionsSchema>;

export const salePreviewInputSchema = seasonalSaleSchema.pick({
  productIds: true,
  categoryIds: true,
});
export type SalePreviewInput = z.infer<typeof salePreviewInputSchema>;

export const salePreviewSchema = z.object({
  /** Published products the sale would price. */
  products: z.number().int().min(0),
  /** Published products in the store. */
  of: z.number().int().min(0),
});
export type SalePreview = z.infer<typeof salePreviewSchema>;

const offerStatGroupSchema = z.object({
  orders: z.number().int().min(0),
  revenueUsd: moneySchema,
  /** Null when there are no orders to average. */
  averageUsd: moneySchema.nullable(),
});
export type OfferStatGroup = z.infer<typeof offerStatGroupSchema>;

/**
 * Paid orders in the window, by offer. An order can be in more than one of
 * volume / pair / sale; `others` is the orders in none of them.
 * `untracked` are orders drafted before offers were recorded, left out of
 * every group rather than counted as "others".
 */
export const offerStatsSchema = z.object({
  since: z.string(),
  days: z.number().int(),
  volume: offerStatGroupSchema,
  pair: offerStatGroupSchema,
  sale: offerStatGroupSchema,
  others: offerStatGroupSchema,
  untracked: z.number().int().min(0),
});
export type OfferStats = z.infer<typeof offerStatsSchema>;
