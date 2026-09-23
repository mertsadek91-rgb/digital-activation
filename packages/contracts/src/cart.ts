import { z } from 'zod';

import {
  activationMethodSchema,
  catalogImageSchema,
  displayPriceSchema,
  fulfillmentModeSchema,
  licensePeriodUnitSchema,
  saleBadgeSchema,
} from './catalog.js';
import { localeSchema, moneySchema, slugSchema } from './primitives.js';

/**
 * Cart contracts.
 *
 * Two things drive the shape.
 *
 * A cart line snapshots its price. The catalog can be repriced while somebody
 * is deciding, and a total that changes between the cart page and the pay
 * button is the fastest way to lose the sale — so the line carries the price it
 * was added at, and the cart says plainly when that no longer matches.
 *
 * And stock is held, not hoped for. These are single-use keys: two people
 * paying for the last one means a refund and an apology, so adding to the cart
 * takes a timed reservation and the cart tells the shopper how long it holds.
 */

/**
 * How long a cart holds stock.
 *
 * Long enough to read a product page, fetch a card and type it; short enough
 * that an abandoned cart is not sitting on the last key of something. Every
 * write to the cart renews it, so an active shopper never runs out of time.
 */
export const RESERVATION_TTL_MINUTES = 30;

/** Hard ceiling per line. A digital key order of 100 is a fraud signal. */
export const MAX_LINE_QTY = 10;

export const cartLineSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  sku: z.string(),
  productSlug: slugSchema,
  productName: z.string(),
  /**
   * The variant as fields, not as a sentence. The storefront already owns the
   * Arabic pluralisation for periods and device counts, and formatting it a
   * second time on the server is how the cart page and the product page end up
   * describing the same licence differently.
   */
  licensePeriodValue: z.number().int().nullable(),
  licensePeriodUnit: licensePeriodUnitSchema,
  deviceCount: z.number().int().min(0),
  activationMethod: activationMethodSchema,
  deliverySlaSeconds: z.number().int().min(0),
  fulfillmentMode: fulfillmentModeSchema,
  /** Checkout must collect the address this licence binds to. */
  requiresActivationEmail: z.boolean(),

  image: catalogImageSchema.nullable(),

  qty: z.number().int().min(1),
  /** The price this line was added at. */
  unitPrice: displayPriceSchema,
  lineTotal: displayPriceSchema,

  /**
   * Set when the catalog price has moved since the line was added. The cart
   * keeps charging the snapshot and says so, rather than repricing silently.
   */
  priceChanged: z.object({ nowUsd: moneySchema, direction: z.enum(['up', 'down']) }).nullable(),

  /**
   * How many more of this variant the cart could add. Not the same as stock:
   * this cart's own quantity is already held, so what is reported is the
   * headroom above it — which is what the "+" button needs to know. For a
   * made-to-order line it is simply the room left under the per-line cap.
   */
  availableToAdd: z.number().int().min(0),
  /** True when the line was added from a checkout cross-sell offer. */
  fromCrossSell: z.boolean(),

  /**
   * The seasonal sale this line is priced by, when it is.
   *
   * A sale price is the one snapshot that does not hold: it was advertised
   * with an end date, so when the sale ends the line goes back to the current
   * price (`saleEnded` says so once), and a sale that starts while the line
   * sits in the cart lowers it — nobody pays more than the price on the shelf.
   */
  sale: saleBadgeSchema.nullable().default(null),
  saleEnded: z.boolean().default(false),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartCouponSchema = z.object({
  code: z.string(),
  name: z.string(),
  /** Amount actually taken off this cart, not the coupon's headline value. */
  discount: displayPriceSchema,
});

export const cartSchema = z.object({
  token: z.string(),
  locale: localeSchema,
  currency: z.string().length(3),
  lines: z.array(cartLineSchema),
  itemCount: z.number().int().min(0),

  subtotal: displayPriceSchema,
  discount: displayPriceSchema,
  total: displayPriceSchema,

  coupon: cartCouponSchema.nullable(),
  /** Why a submitted code was refused. Null when there is nothing to say. */
  couponError: z.string().nullable(),

  /**
   * One discount per cart: the single largest of the coupon (typed or an
   * earned bundle), the volume tier and the pair discount. When an automatic
   * one wins it is described here and `discount` is its amount; a coupon that
   * lost stays attached with `couponSuperseded` set, and comes back by itself
   * if the cart changes so that it is the better one again.
   */
  automaticDiscount: z
    .object({
      kind: z.enum(['volume', 'pair']),
      /** The tier's or the pair's headline percent. */
      percent: z.number().min(0).max(90),
      amount: displayPriceSchema,
      /** The discount licence number, shown beside the discount. */
      licenceNumber: z.string(),
    })
    .nullable()
    .default(null),
  couponSuperseded: z.boolean().default(false),

  /**
   * Volume tiers, for the "add one more licence to save 10%" bar. Null when
   * the offer is off or has no tiers. `next` is null at the top tier.
   */
  volume: z
    .object({
      applied: z.object({ minItems: z.number().int(), percent: z.number() }).nullable(),
      next: z
        .object({
          minItems: z.number().int(),
          percent: z.number(),
          itemsToGo: z.number().int().min(1),
        })
        .nullable(),
      showProgressBar: z.boolean(),
      licenceNumber: z.string(),
    })
    .nullable()
    .default(null),

  /** When this cart's stock hold lapses. Null when it holds nothing. */
  reservationExpiresAt: z.string().nullable(),
  /**
   * Lines that could not keep their full quantity because stock moved. Stated
   * rather than silently trimmed: a cart that quietly drops an item is worse
   * than one that explains.
   */
  adjustments: z.array(
    z.object({ sku: z.string(), requestedQty: z.number().int(), grantedQty: z.number().int() }),
  ),
});
export type Cart = z.infer<typeof cartSchema>;

// --- requests ---------------------------------------------------------------

export const addToCartSchema = z.object({
  variantId: z.string().min(1),
  qty: z.number().int().min(1).max(MAX_LINE_QTY).default(1),
  fromCrossSell: z.boolean().default(false),
});
export type AddToCart = z.infer<typeof addToCartSchema>;

export const updateCartLineSchema = z.object({
  /** Zero removes the line, so the UI needs one verb rather than two. */
  qty: z.number().int().min(0).max(MAX_LINE_QTY),
});

export const applyCouponSchema = z.object({
  code: z.string().trim().min(1).max(64),
});

export const cartQuerySchema = z.object({
  locale: localeSchema.default('ar'),
  currency: z.string().length(3).default('USD'),
});
export type CartQuery = z.infer<typeof cartQuerySchema>;
