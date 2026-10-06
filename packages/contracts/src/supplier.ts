import { z } from 'zod';

/**
 * The supplier price sheet (CR-0004).
 *
 * A supplier publishes its wholesale list as a Google Sheet. The API reads it
 * on a schedule, keeps every line as a row keyed by its product name (rows
 * move when somebody inserts a line in the middle), and lets a person link
 * each of our variants to the line it is bought as. From there a cost change
 * becomes a price proposal — cost × (1 + markup) — that a person applies, and
 * a struck-through line turns the variant into "notify me".
 *
 * Money is a decimal string, as everywhere else in the contracts.
 */

export const SUPPLIER_ROUNDINGS = ['CENTS', 'END_99', 'WHOLE'] as const;
export const supplierRoundingSchema = z.enum(SUPPLIER_ROUNDINGS);
export type SupplierRounding = z.infer<typeof supplierRoundingSchema>;

export const DEFAULT_MARKUP_PERCENT = 50;

/**
 * A change bigger than this share of the current price is not applied by a
 * bulk "apply all" unless the request says it has been looked at. A supplier
 * typo of $150 for $15.0 should cost one extra click, not a day of sales.
 */
export const LARGE_PRICE_CHANGE = 0.3;

const percentSchema = z.coerce
  .number()
  .min(0, 'النسبة لا تكون سالبة.')
  .max(1000, 'النسبة أكبر من المعقول.');

/** "https://docs.google.com/spreadsheets/d/<id>/edit?gid=<gid>" → its parts. */
export function parseSheetUrl(url: string): { spreadsheetId: string; sheetGid: number } | null {
  const id = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(url)?.[1];
  if (!id) return null;
  const gid = /[#?&]gid=(\d+)/.exec(url)?.[1];
  return { spreadsheetId: id, sheetGid: gid ? Number(gid) : 0 };
}

export const setSupplierSourceSchema = z.object({
  name: z.string().trim().min(1).max(120).default('Supplier'),
  url: z
    .string()
    .trim()
    .refine((value) => parseSheetUrl(value) !== null, 'هذا ليس رابط Google Sheet صالحاً.'),
  markupPercent: percentSchema.default(DEFAULT_MARKUP_PERCENT),
  rounding: supplierRoundingSchema.default('CENTS'),
  autoSync: z.boolean().default(true),
});
export type SetSupplierSource = z.infer<typeof setSupplierSourceSchema>;

export const supplierSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  spreadsheetId: z.string(),
  sheetGid: z.number().int(),
  url: z.string(),
  markupPercent: z.string(),
  rounding: supplierRoundingSchema,
  autoSync: z.boolean(),
  lastSyncAt: z.string().nullable(),
  lastSyncStatus: z.string().nullable(),
  lastSyncError: z.string().nullable(),
  sheetUpdatedLabel: z.string().nullable(),
  /** False when GOOGLE_SHEETS_API_KEY is not set on the API. */
  readerConfigured: z.boolean(),
});
export type SupplierSourceView = z.infer<typeof supplierSourceSchema>;

/** "Sync now". `force` (ADMIN only) applies a read the safety checks refused. */
export const supplierSyncInputSchema = z.object({ force: z.boolean().default(false) });

export const supplierSyncResultSchema = z.object({
  status: z.enum(['OK', 'UNCHANGED', 'FAILED', 'REFUSED', 'BUSY']),
  error: z.string().nullable(),
  rowCount: z.number().int(),
  added: z.number().int(),
  changed: z.number().int(),
  removed: z.number().int(),
  stockSwitched: z.number().int(),
  warnings: z.array(z.string()),
});
export type SupplierSyncResult = z.infer<typeof supplierSyncResultSchema>;

// --- items ------------------------------------------------------------------

export const SUPPLIER_ITEM_FILTERS = [
  'all',
  'linked',
  'unlinked',
  'out',
  'missing',
  'nocost',
  'changed',
] as const;
export const supplierItemFilterSchema = z.enum(SUPPLIER_ITEM_FILTERS);
export type SupplierItemFilter = z.infer<typeof supplierItemFilterSchema>;

export const supplierItemsQuerySchema = z.object({
  filter: supplierItemFilterSchema.default('all'),
  q: z.string().trim().max(200).optional(),
});
export type SupplierItemsQuery = z.infer<typeof supplierItemsQuerySchema>;

export const supplierItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  costUsd: z.string().nullable(),
  priceText: z.string().nullable(),
  warranty: z.string().nullable(),
  remarks: z.string().nullable(),
  outOfStock: z.boolean(),
  partialStrike: z.boolean(),
  wholesaleOnly: z.boolean(),
  rowNumber: z.number().int().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  missingSince: z.string().nullable(),
  /** When anything about the line last changed, if within the last 7 days. */
  changedAt: z.string().nullable(),
  links: z.array(z.object({ variantId: z.string(), sku: z.string(), productSlug: z.string() })),
});
export type SupplierItemView = z.infer<typeof supplierItemSchema>;

export const supplierItemsSchema = z.object({
  items: z.array(supplierItemSchema),
  counts: z.record(supplierItemFilterSchema, z.number().int()),
});
export type SupplierItems = z.infer<typeof supplierItemsSchema>;

// --- log --------------------------------------------------------------------

export const SUPPLIER_CHANGE_KINDS = [
  'ADDED',
  'REMOVED',
  'RETURNED',
  'COST',
  'STOCK',
  'CATEGORY',
  'WARRANTY',
  'REMARKS',
] as const;
export const supplierChangeKindSchema = z.enum(SUPPLIER_CHANGE_KINDS);

export const supplierSnapshotSchema = z.object({
  id: z.string(),
  fetchedAt: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  sheetUpdatedLabel: z.string().nullable(),
  rowCount: z.number().int(),
  added: z.number().int(),
  changed: z.number().int(),
  removed: z.number().int(),
  stockSwitched: z.number().int(),
  manual: z.boolean(),
});

export const supplierChangeSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  itemId: z.string(),
  itemName: z.string(),
  kind: supplierChangeKindSchema,
  before: z.unknown(),
  after: z.unknown(),
});

/** A thing a person did with the supplier data: a link, a price applied. */
export const supplierActionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  action: z.string(),
  actor: z.string().nullable(),
  entityId: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});

export const supplierLogQuerySchema = z.object({
  itemId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const supplierLogSchema = z.object({
  snapshots: z.array(supplierSnapshotSchema),
  changes: z.array(supplierChangeSchema),
  actions: z.array(supplierActionSchema),
});
export type SupplierLog = z.infer<typeof supplierLogSchema>;

// --- mapping ----------------------------------------------------------------

export const SUPPLIER_MAPPING_FILTERS = ['all', 'linked', 'unlinked', 'broken'] as const;
export const supplierMappingQuerySchema = z.object({
  filter: z.enum(SUPPLIER_MAPPING_FILTERS).default('all'),
  q: z.string().trim().max(200).optional(),
});
export type SupplierMappingQuery = z.infer<typeof supplierMappingQuerySchema>;

const itemRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  costUsd: z.string().nullable(),
  outOfStock: z.boolean(),
  missingSince: z.string().nullable(),
});

export const supplierMappingRowSchema = z.object({
  variantId: z.string(),
  sku: z.string(),
  productSlug: z.string(),
  productName: z.string(),
  /** "1 year · 1 device", for telling sibling variants apart. */
  terms: z.string(),
  priceUsd: z.string(),
  supplierOutOfStock: z.boolean(),
  link: z
    .object({
      item: itemRefSchema,
      markupPercent: z.string().nullable(),
      followStock: z.boolean(),
    })
    .nullable(),
  /** Up to three closest sheet lines, best first — for an unlinked or broken row. */
  suggestions: z.array(itemRefSchema.extend({ score: z.number() })),
});
export type SupplierMappingRow = z.infer<typeof supplierMappingRowSchema>;

export const supplierMappingSchema = z.object({
  rows: z.array(supplierMappingRowSchema),
  counts: z.object({
    all: z.number().int(),
    linked: z.number().int(),
    unlinked: z.number().int(),
    broken: z.number().int(),
  }),
});
export type SupplierMapping = z.infer<typeof supplierMappingSchema>;

export const setSupplierLinkSchema = z.object({
  itemId: z.string().min(1),
  /**
   * Blank, null or omitted uses the source's markup. Blank and null are tried
   * first: `percentSchema` coerces, and Number('') and Number(null) are both 0,
   * which would save a 0% markup in place of "use the default".
   */
  markupPercent: z.union([z.literal(''), z.null(), percentSchema]).optional(),
  followStock: z.boolean().default(true),
});
export type SetSupplierLink = z.infer<typeof setSupplierLinkSchema>;

// --- prices -----------------------------------------------------------------

export const SUPPLIER_PRICE_STATES = [
  /** Proposed price differs from the current one. */
  'PENDING',
  /** Already at the proposed price. */
  'CURRENT',
  /** The sheet has no usable cost for the line. */
  'NO_COST',
  /** The linked line is no longer in the sheet. */
  'MISSING',
] as const;
export const supplierPriceStateSchema = z.enum(SUPPLIER_PRICE_STATES);

export const supplierPriceRowSchema = z.object({
  variantId: z.string(),
  sku: z.string(),
  productSlug: z.string(),
  productName: z.string(),
  terms: z.string(),
  itemName: z.string(),
  costUsd: z.string().nullable(),
  lastAppliedCostUsd: z.string().nullable(),
  markupPercent: z.string(),
  markupFromLink: z.boolean(),
  currentPriceUsd: z.string(),
  proposedPriceUsd: z.string().nullable(),
  /** (proposed − current) / current, as a fraction. Null when either is missing. */
  change: z.number().nullable(),
  large: z.boolean(),
  state: supplierPriceStateSchema,
});
export type SupplierPriceRow = z.infer<typeof supplierPriceRowSchema>;

export const supplierPricesSchema = z.object({
  rows: z.array(supplierPriceRowSchema),
  pending: z.number().int(),
});
export type SupplierPrices = z.infer<typeof supplierPricesSchema>;

export const applySupplierPricesSchema = z
  .object({
    variantIds: z.array(z.string().min(1)).max(2000).optional(),
    all: z.boolean().optional(),
    /** Also apply changes larger than LARGE_PRICE_CHANGE. */
    confirmLarge: z.boolean().default(false),
  })
  .refine((value) => value.all === true || (value.variantIds?.length ?? 0) > 0, {
    message: 'اختر منتجاً واحداً على الأقل، أو اختر "الكل".',
  });
export type ApplySupplierPrices = z.infer<typeof applySupplierPricesSchema>;

export const applySupplierPricesResultSchema = z.object({
  applied: z.array(
    z.object({ variantId: z.string(), sku: z.string(), from: z.string(), to: z.string() }),
  ),
  skipped: z.array(
    z.object({
      variantId: z.string(),
      sku: z.string(),
      reason: z.enum(['NO_COST', 'MISSING', 'CURRENT', 'LARGE', 'BELOW_COST', 'NOT_LINKED']),
    }),
  ),
});
export type ApplySupplierPricesResult = z.infer<typeof applySupplierPricesResultSchema>;
