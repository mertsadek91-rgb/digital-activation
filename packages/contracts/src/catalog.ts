import { z } from 'zod';

import { blockDocumentSchema, faqItemsSchema } from './blocks.js';
import { localeSchema, moneySchema, paginationSchema, slugSchema } from './primitives.js';

/**
 * Catalog read contracts.
 *
 * One definition, used by the API to build responses and by the storefront to
 * consume them, so a field rename cannot pass typecheck on one side only.
 *
 * The shape is deliberately flat and render-ready: the storefront should not
 * have to reduce a variant list to work out what price to show, because that is
 * exactly the kind of duplicated logic that lets the visible price and the
 * structured-data price drift apart — the defect that cost the legacy store its
 * rich results.
 */

export const licensePeriodUnitSchema = z.enum(['DAY', 'MONTH', 'YEAR', 'LIFETIME']);
export const platformSchema = z.enum(['WINDOWS', 'MAC', 'LINUX', 'CROSS_PLATFORM']);
export const activationMethodSchema = z.enum([
  'RETAIL_ONLINE',
  'RETAIL_PHONE',
  'VOLUME_MAK',
  'KMS',
  'BIND_MICROSOFT_ACCOUNT',
  'REDEEM_CODE',
  'ACCOUNT_CREDENTIALS',
  'PANEL_INVITE',
  'CAL_KEY',
  'NOT_APPLICABLE',
]);
export const productKindSchema = z.enum(['KEY', 'ACCOUNT', 'PANEL', 'BUNDLE', 'SERVICE']);

/**
 * How a line is delivered, which decides whether stock means anything.
 *
 * Most of this catalog is made to order — the licence is bought from a supplier
 * after the customer pays, because a code's validity starts on purchase, some
 * activations bind to the customer's own email, and the expensive lines would
 * tie up money that does not turn over. So ON_DEMAND and MANUAL_SETUP variants
 * are always sellable and "out of stock" is a state they cannot be in; only
 * FROM_STOCK consults inventory.
 */
export const fulfillmentModeSchema = z.enum(['FROM_STOCK', 'ON_DEMAND', 'MANUAL_SETUP']);
export type FulfillmentMode = z.infer<typeof fulfillmentModeSchema>;

/**
 * What the customer actually receives.
 *
 * Two shapes, because the business has two: a string to type into the product,
 * or an account to sign in with. Everything downstream reads this one field —
 * the import form, the supplier paste box, the licence email and the customer's
 * order page — so that a password is never printed under a heading that says
 * "activation key".
 */
export const credentialKindSchema = z.enum(['ACTIVATION_KEY', 'ACCOUNT_CREDENTIALS']);
export type CredentialKind = z.infer<typeof credentialKindSchema>;

/**
 * The price as the visitor sees it. Both fields travel together and are handed
 * to the structured-data builder unchanged, so the markup cannot claim a
 * currency the page did not render.
 */
export const displayPriceSchema = z.object({
  amount: moneySchema,
  currency: z.string().length(3),
  /** Strike-through price, when there is a genuine one. */
  compareAt: moneySchema.nullable(),
  /** Whole percent off, for the badge. Null when not on offer. */
  discountPercent: z.number().int().min(1).max(99).nullable(),
});
export type DisplayPrice = z.infer<typeof displayPriceSchema>;

export const catalogVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  licensePeriodValue: z.number().int().nullable(),
  licensePeriodUnit: licensePeriodUnitSchema,
  /** 0 means unlimited. */
  deviceCount: z.number().int().min(0),
  platform: platformSchema,
  activationMethod: activationMethodSchema,
  deliverySlaSeconds: z.number().int().min(0),
  fulfillmentMode: fulfillmentModeSchema,
  /**
   * True when the licence binds to an address the customer supplies, so
   * checkout has to ask for it. A key issued against the wrong address is a
   * key nobody can use.
   */
  requiresActivationEmail: z.boolean(),
  price: displayPriceSchema,
  /**
   * Sellable count for a stocked line: on hand minus reservations. Null when
   * the variant is made to order, where a number would be an invention — the
   * supply is the supplier's, not a shelf we can count.
   */
  available: z.number().int().min(0).nullable(),
  inStock: z.boolean(),
  isDefault: z.boolean(),
});
export type CatalogVariant = z.infer<typeof catalogVariantSchema>;

export const catalogImageSchema = z.object({
  url: z.string(),
  alt: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});

export const catalogBreadcrumbSchema = z.object({
  name: z.string(),
  href: z.string(),
});

export const catalogProductSchema = z.object({
  slug: slugSchema,
  kind: productKindSchema,
  locale: localeSchema,
  name: z.string(),
  shortDesc: z.string().nullable(),
  body: blockDocumentSchema,
  faq: faqItemsSchema.nullable(),
  activationSteps: z
    .array(z.object({ step: z.number().int(), text: z.string(), assetId: z.string().optional() }))
    .nullable(),
  downloadUrl: z.string().nullable(),

  brand: z.object({ slug: slugSchema, name: z.string() }).nullable(),
  breadcrumbs: z.array(catalogBreadcrumbSchema),
  images: z.array(catalogImageSchema),

  hasGoldenWarranty: z.boolean(),
  /** Real orders, not a synthetic counter. Shown only above a floor. */
  salesCount: z.number().int().min(0),
  rating: z.object({ value: z.string(), count: z.number().int().min(1) }).nullable(),

  variants: z.array(catalogVariantSchema).min(1),
  /** The variant the page opens on — the cheapest in stock, else the default. */
  selectedVariantId: z.string(),

  seo: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
  }),

  /** True when this product is not published; only reachable in preview. */
  isDraft: z.boolean(),
});
export type CatalogProduct = z.infer<typeof catalogProductSchema>;

/** Grid card. Deliberately small — a collection page renders many of these. */
export const catalogCardSchema = z.object({
  slug: slugSchema,
  name: z.string(),
  shortDesc: z.string().nullable(),
  image: catalogImageSchema.nullable(),
  price: displayPriceSchema,
  inStock: z.boolean(),
  /**
   * Sellable stock across the stocked variants, for the "only N left" line.
   * Null when nothing on this product is stocked, which is the usual case.
   */
  available: z.number().int().min(0).nullable(),
  /** The fastest mode on the product, which is what the card promises. */
  fulfillmentMode: fulfillmentModeSchema,
  variantCount: z.number().int().min(1),
  hasGoldenWarranty: z.boolean(),
  salesCount: z.number().int().min(0),
  brand: z.string().nullable(),
  isDraft: z.boolean(),
});
export type CatalogCard = z.infer<typeof catalogCardSchema>;

export const catalogCollectionSchema = z.object({
  slug: slugSchema,
  locale: localeSchema,
  name: z.string(),
  headline: z.string().nullable(),
  body: blockDocumentSchema,
  faq: faqItemsSchema.nullable(),
  breadcrumbs: z.array(catalogBreadcrumbSchema),
  children: z.array(
    z.object({ slug: slugSchema, name: z.string(), productCount: z.number().int() }),
  ),
  seo: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
  products: z.array(catalogCardSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  perPage: z.number().int().min(1),
});
export type CatalogCollection = z.infer<typeof catalogCollectionSchema>;

// --- home -------------------------------------------------------------------

/**
 * The home page, in one response.
 *
 * Composed on the server rather than assembled from six storefront requests.
 * The home page is the most-linked page on the site and the one an AI crawler
 * fetches first, so it has to answer in a single round trip — and every number
 * on it has to come from the catalog rather than from a copywriter, or the page
 * starts claiming a range it does not stock.
 */
export const homeLinkSchema = z.object({
  slug: slugSchema,
  name: z.string(),
  headline: z.string().nullable(),
  href: z.string(),
  productCount: z.number().int().min(0),
});

export const homeRailSchema = homeLinkSchema.extend({
  products: z.array(catalogCardSchema),
});
export type HomeRail = z.infer<typeof homeRailSchema>;

export const homeSchema = z.object({
  locale: localeSchema,
  currency: z.string().length(3),
  /** Shop-by-category grid. Top-level categories that actually hold stock. */
  categories: z.array(homeLinkSchema),
  /** One row per category with enough products to be worth a row. */
  rails: z.array(homeRailSchema),
  bestSellers: z.array(catalogCardSchema),
  newest: z.array(catalogCardSchema),
  brands: z.array(homeLinkSchema),
  /** Real catalog size, for the hero. Not a rounded boast. */
  productCount: z.number().int().min(0),
  /** True when the response includes drafts, i.e. this is a preview host. */
  isPreview: z.boolean(),
});
export type Home = z.infer<typeof homeSchema>;

/** A rail below this is a ragged row, so it is dropped rather than padded. */
export const RAIL_MIN_PRODUCTS = 3;
/** Cards per rail. Four fills the row at desktop and scrolls on mobile. */
export const RAIL_SIZE = 4;

// --- request contracts ------------------------------------------------------

export const catalogQuerySchema = paginationSchema.extend({
  locale: localeSchema.default('ar'),
  currency: z.string().length(3).default('USD'),
  /**
   * Draft products are visible only with the preview token, and the storefront
   * only sends it while it is running on a non-indexable host. A staging site
   * showing drafts is what staging is for; production shows published only.
   */
  preview: z.string().optional(),
  sort: z
    .enum(['position', 'price-asc', 'price-desc', 'newest', 'best-selling'])
    .default('position'),
});
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/** Floor below which a sales count is noise rather than proof. */
export const SALES_PROOF_THRESHOLD = 5;

/** Below this, the storefront shows "only N left" instead of a plain badge. */
export const LOW_STOCK_THRESHOLD = 5;
