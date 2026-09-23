import { z } from 'zod';

// Every stored state, because the rows can hold any of them.
import { publishStatusSchema } from './catalog-edit.js';
import { localeSchema, slugSchema } from './primitives.js';
import { contentBlockSchema } from './product-content.js';

/**
 * Pages, blog posts and brands, as the panel edits them.
 *
 * All three were writable only by the scripts in `packages/db/scripts`, so a
 * typo in the refund policy or a meta description that ran past the SERP was a
 * deploy. These are the shapes that let an editor fix them instead.
 *
 * Two decisions run through every schema here.
 *
 * The unit is the URL, not the row. A page and a post are one row per locale
 * sharing a slug, and the storefront relies on that sharing: `/privacy` and
 * `/en/privacy` are alternates of one page, and a post's hreflang set is found
 * by looking up the other rows with the same slug. A per-locale slug would let
 * the Arabic and English halves drift apart and silently stop declaring each
 * other — so the slug is edited once, for the whole group, and everything else
 * is edited per locale.
 *
 * The body is the product editor's block document (`contentBlockSchema`), not a
 * second vocabulary: the same six block types are editable, and anything else
 * — a comparison table, a product grid — is carried through verbatim, because
 * a save that drops what the form cannot draw deletes somebody's work.
 */

/**
 * What the panel can set.
 *
 * Two, because those are the two the storefront distinguishes: it serves
 * `PUBLISHED` and nothing else. Offering `SCHEDULED` would be offering a switch
 * with nothing behind it — no job reads `publishAt` today.
 */
export const editableStatusSchema = z.enum(['DRAFT', 'PUBLISHED']);
export type EditableStatus = z.infer<typeof editableStatusSchema>;

/**
 * SEO copy, as typed.
 *
 * The hard caps are `seoMetaSchema`'s (70 and 180), so nothing saved here can
 * fail the stricter shape later. The softer SERP limits live in
 * `SEO_LENGTH_GUIDE` and are shown as advice beside the counter. An empty
 * string clears the field, which falls back to the title or the summary.
 */
const seoTitleInput = z.string().trim().max(70);
const seoDescriptionInput = z.string().trim().max(180);

// --- pages ------------------------------------------------------------------

export const pageTemplateSchema = z.enum(['LANDING', 'LEGAL', 'TOOL', 'GENERIC']);
export type PageTemplateValue = z.infer<typeof pageTemplateSchema>;

/** One locale of a page in the list: enough to see what is missing. */
export const contentLocaleSummarySchema = z.object({
  locale: localeSchema,
  title: z.string(),
  status: publishStatusSchema,
  updatedAt: z.string(),
});
export type ContentLocaleSummary = z.infer<typeof contentLocaleSummarySchema>;

export const adminPageRowSchema = z.object({
  slug: z.string(),
  /** The public address, Arabic form — `/en` is prefixed for English. */
  path: z.string(),
  template: pageTemplateSchema,
  /** Only the locales that have a row. A missing one is a translation not written. */
  locales: z.array(contentLocaleSummarySchema),
  updatedAt: z.string(),
});
export type AdminPageRow = z.infer<typeof adminPageRowSchema>;

export const adminPageListSchema = z.object({ rows: z.array(adminPageRowSchema) });
export type AdminPageList = z.infer<typeof adminPageListSchema>;

export const adminPageLocaleSchema = z.object({
  locale: localeSchema,
  /** False when no row exists yet; saving creates it. */
  exists: z.boolean(),
  title: z.string(),
  blocks: z.array(contentBlockSchema),
  seoTitle: z.string(),
  seoDescription: z.string(),
  status: publishStatusSchema,
  publishedAt: z.string().nullable(),
  /** Bumped on every save; each bump has a PageVersion snapshot behind it. */
  version: z.number().int().min(0),
  updatedAt: z.string().nullable(),
});
export type AdminPageLocale = z.infer<typeof adminPageLocaleSchema>;

export const adminPageSchema = z.object({
  slug: z.string(),
  path: z.string(),
  template: pageTemplateSchema,
  /**
   * True for a slug a dedicated storefront route asks for by name — the
   * warranty and contact pages. Renaming one would leave that route reading a
   * page that no longer exists, so the server refuses and the form says why.
   */
  slugLocked: z.boolean(),
  ar: adminPageLocaleSchema,
  en: adminPageLocaleSchema,
});
export type AdminPage = z.infer<typeof adminPageSchema>;

export const createPageSchema = z.object({
  slug: slugSchema,
  locale: localeSchema.default('ar'),
  title: z.string().trim().min(2).max(200),
  template: pageTemplateSchema.default('GENERIC'),
});
export type CreatePage = z.infer<typeof createPageSchema>;

/** One locale's copy. Creating the row on first save needs a title. */
export const pageTranslationInputSchema = z.object({
  locale: localeSchema,
  title: z.string().trim().min(2).max(200).optional(),
  blocks: z.array(contentBlockSchema).max(60).optional(),
  seoTitle: seoTitleInput.optional(),
  seoDescription: seoDescriptionInput.optional(),
  status: editableStatusSchema.optional(),
});
export type PageTranslationInput = z.infer<typeof pageTranslationInputSchema>;

export const setPageSchema = z
  .object({
    /** Renames every locale at once and writes the 301 from the old address. */
    slug: slugSchema.optional(),
    template: pageTemplateSchema.optional(),
    translation: pageTranslationInputSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'لا تغييرات في الطلب.' });
export type SetPage = z.infer<typeof setPageSchema>;

// --- blog posts ---------------------------------------------------------------

export const adminArticleRowSchema = adminPageRowSchema.omit({ template: true }).extend({
  author: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export type AdminArticleRow = z.infer<typeof adminArticleRowSchema>;

export const adminArticleListSchema = z.object({ rows: z.array(adminArticleRowSchema) });
export type AdminArticleList = z.infer<typeof adminArticleListSchema>;

export const adminArticleLocaleSchema = adminPageLocaleSchema.omit({ version: true }).extend({
  /** The excerpt: the card's summary and the meta description's fallback. */
  summary: z.string(),
  authorId: z.string().nullable(),
  /** Recomputed from the body on every save; shown, never typed. */
  readingMinutes: z.number().int().min(0),
});
export type AdminArticleLocale = z.infer<typeof adminArticleLocaleSchema>;

export const authorOptionSchema = z.object({ id: z.string(), name: z.string() });
export type AuthorOption = z.infer<typeof authorOptionSchema>;

export const adminArticleSchema = z.object({
  slug: z.string(),
  path: z.string(),
  ar: adminArticleLocaleSchema,
  en: adminArticleLocaleSchema,
  /** Every by-line the post can carry, for the picker. */
  authors: z.array(authorOptionSchema),
});
export type AdminArticle = z.infer<typeof adminArticleSchema>;

export const createArticleSchema = z.object({
  slug: slugSchema,
  locale: localeSchema.default('ar'),
  title: z.string().trim().min(2).max(200),
});
export type CreateArticle = z.infer<typeof createArticleSchema>;

export const articleTranslationInputSchema = pageTranslationInputSchema.extend({
  summary: z.string().trim().max(400).optional(),
  /** Null removes the by-line. */
  authorId: z.string().nullable().optional(),
  /**
   * ISO date-time. Omitted, a first publish stamps "now" and later saves keep
   * whatever is there; set, it back-dates or corrects the date — the imported
   * posts carry the dates the old blog published them on, and those matter.
   */
  publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type ArticleTranslationInput = z.infer<typeof articleTranslationInputSchema>;

export const setArticleSchema = z
  .object({
    slug: slugSchema.optional(),
    translation: articleTranslationInputSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'لا تغييرات في الطلب.' });
export type SetArticle = z.infer<typeof setArticleSchema>;

// --- brands -------------------------------------------------------------------

export const adminBrandRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  path: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  isActive: z.boolean(),
  /** Published products, which is what decides whether the hub has a shelf. */
  productCount: z.number().int().min(0),
  /** Locales whose hub copy has an SEO title and description both. */
  seoComplete: z.array(localeSchema),
});
export type AdminBrandRow = z.infer<typeof adminBrandRowSchema>;

export const adminBrandListSchema = z.object({ rows: z.array(adminBrandRowSchema) });
export type AdminBrandList = z.infer<typeof adminBrandListSchema>;

export const adminBrandLocaleSchema = z.object({
  locale: localeSchema,
  exists: z.boolean(),
  name: z.string(),
  /** The /brands/<slug> page body. */
  intro: z.array(contentBlockSchema),
  seoTitle: z.string(),
  seoDescription: z.string(),
});
export type AdminBrandLocale = z.infer<typeof adminBrandLocaleSchema>;

export const adminBrandSchema = z.object({
  id: z.string(),
  slug: z.string(),
  path: z.string(),
  /** The untranslated fallback name, used where a locale has none. */
  name: z.string(),
  website: z.string(),
  isActive: z.boolean(),
  productCount: z.number().int().min(0),
  ar: adminBrandLocaleSchema,
  en: adminBrandLocaleSchema,
});
export type AdminBrand = z.infer<typeof adminBrandSchema>;

export const brandTranslationInputSchema = z.object({
  locale: localeSchema,
  name: z.string().trim().min(1).max(120).optional(),
  intro: z.array(contentBlockSchema).max(40).optional(),
  seoTitle: seoTitleInput.optional(),
  seoDescription: seoDescriptionInput.optional(),
});
export type BrandTranslationInput = z.infer<typeof brandTranslationInputSchema>;

export const setBrandSchema = z
  .object({
    slug: slugSchema.optional(),
    isActive: z.boolean().optional(),
    /** Empty clears it. */
    website: z.union([z.string().trim().url().max(300), z.literal('')]).optional(),
    translation: brandTranslationInputSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'لا تغييرات في الطلب.' });
export type SetBrand = z.infer<typeof setBrandSchema>;

// --- page history -----------------------------------------------------------

/**
 * One saved state of one locale of a page.
 *
 * The body is not in the list: a page's history can run to hundreds of rows
 * and the panel shows it as a column of dates and names. Restoring reads the
 * snapshot on the server, so the client never has to hold one.
 */
export const adminPageVersionSchema = z.object({
  id: z.string(),
  locale: localeSchema,
  version: z.number().int().min(0),
  title: z.string(),
  blockCount: z.number().int().min(0),
  seoTitle: z.string(),
  author: z.string().nullable(),
  createdAt: z.string(),
  /** True for the snapshot matching the row's current version. */
  current: z.boolean(),
});
export type AdminPageVersion = z.infer<typeof adminPageVersionSchema>;

export const adminPageVersionListSchema = z.object({ rows: z.array(adminPageVersionSchema) });
export type AdminPageVersionList = z.infer<typeof adminPageVersionListSchema>;
