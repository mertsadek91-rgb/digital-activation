import { z } from 'zod';

import { blockDocumentSchema } from './blocks.js';
import { localeSchema, slugSchema } from './primitives.js';

/**
 * Editorial pages — the warranty, the policies, the business page.
 *
 * Stored as blocks rather than as a slab of HTML, for the same reason product
 * bodies are: the legacy store put the entire pitch for its best-selling
 * bundle inside a PNG, and a page whose meaning lives in markup nobody can
 * query is a page no crawler and no answer engine can read.
 *
 * One row per locale, keyed by the same slug. The Arabic page and the English
 * page are alternates of each other, not two unrelated documents.
 */
export const contentPageSchema = z.object({
  slug: slugSchema,
  locale: localeSchema,
  title: z.string(),
  blocks: blockDocumentSchema,
  seo: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
  }),
  updatedAt: z.string(),
});
export type ContentPage = z.infer<typeof contentPageSchema>;

/**
 * Where a legacy URL goes now.
 *
 * `code` is carried rather than assumed: a product that moved is a 301, and a
 * blog post whose replacement has not been written yet is a 302 — declaring
 * that one permanent would be a claim the store does not mean.
 */
export const redirectTargetSchema = z.object({
  to: z.string(),
  code: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]),
});
export type RedirectTarget = z.infer<typeof redirectTargetSchema>;

/**
 * The contact form.
 *
 * Five fields and a topic, because the legacy support page asked for a
 * "section" and then routed everything to one address anyway — the value only
 * earns its place if it changes how the message is read. `orderNumber` is
 * optional and asked for anyway: a message about an order that does not name
 * one costs a round trip before anything can start.
 */
export const contactTopicSchema = z.enum(['ORDER', 'ACTIVATION', 'PRESALE', 'BUSINESS', 'OTHER']);
export type ContactTopic = z.infer<typeof contactTopicSchema>;

export const submitContactSchema = z.object({
  topic: contactTopicSchema.default('OTHER'),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).optional(),
  orderNumber: z.string().trim().max(40).optional(),
  message: z.string().trim().min(10).max(4000),
  locale: localeSchema.default('ar'),
  /**
   * Honeypot. A field no human sees and no human fills; a bot fills every
   * input it finds. Submissions carrying it are accepted and dropped rather
   * than refused, because an error message is how a bot learns what to change.
   */
  website: z.string().max(200).optional(),
});

export const contactResultSchema = z.object({
  /** Always true, including for a submission that was silently dropped. */
  received: z.literal(true),
});

/** Longest a message can wait before the promise on the page stops being true. */
export const CONTACT_REPLY_HOURS = 24;

/**
 * A message as the panel lists it.
 *
 * Carries the whole message rather than a preview. There are never many of
 * them, a support inbox is read by opening things, and a list that shows the
 * first forty characters is a list somebody clicks through one row at a time
 * to find the one they are looking for.
 */
export const contactMessageRowSchema = z.object({
  id: z.string(),
  topic: contactTopicSchema,
  status: z.enum(['NEW', 'HANDLED']),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  orderNumber: z.string().nullable(),
  message: z.string(),
  locale: localeSchema,
  /** Set when the address belongs to a customer, with what they have bought. */
  customer: z
    .object({
      id: z.string(),
      orderCount: z.number().int().min(0),
      totalSpentUsd: z.string(),
    })
    .nullable(),
  createdAt: z.string(),
  handledAt: z.string().nullable(),
  handledBy: z.string().nullable(),
  /** Seconds since it arrived, so lateness needs no arithmetic on the page. */
  waitingSeconds: z.number().int().min(0),
});
export type ContactMessageRow = z.infer<typeof contactMessageRowSchema>;

export const contactListSchema = z.object({
  rows: z.array(contactMessageRowSchema),
  /** Unanswered, across every page of the list. */
  waiting: z.number().int().min(0),
  /** Unanswered for longer than the reply the page promises. */
  overdue: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type ContactList = z.infer<typeof contactListSchema>;

export const setContactStatusSchema = z.object({
  status: z.enum(['NEW', 'HANDLED']),
});

/**
 * The redirect map, as the panel edits it.
 *
 * `source` separates the generated cutover map from rows somebody typed: a
 * regeneration overwrites its own and never touches a hand fix, and the screen
 * says which is which so nobody wonders why their edit came back.
 */
export const redirectRowSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  code: z.number().int(),
  isActive: z.boolean(),
  source: z.string(),
  hits: z.number().int().min(0),
  lastHitAt: z.string().nullable(),
  createdAt: z.string(),
});
export type RedirectRow = z.infer<typeof redirectRowSchema>;

/**
 * A path that answered 404, with how often and where from.
 *
 * The point of the table is the list of legacy URLs the generated map missed —
 * the ones nobody could predict, because they were linked from somewhere the
 * export does not know about. Every row here is either a redirect waiting to
 * be written or a crawler to ignore, and the referrer is what tells them apart.
 */
export const notFoundRowSchema = z.object({
  id: z.string(),
  path: z.string(),
  hits: z.number().int().min(0),
  referer: z.string().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type NotFoundRow = z.infer<typeof notFoundRowSchema>;

export const redirectsViewSchema = z.object({
  redirects: z.array(redirectRowSchema),
  notFound: z.array(notFoundRowSchema),
  /** Totals across the whole table, not just the page being shown. */
  counts: z.object({
    redirects: z.number().int().min(0),
    active: z.number().int().min(0),
    unresolved404: z.number().int().min(0),
  }),
});
export type RedirectsView = z.infer<typeof redirectsViewSchema>;

/**
 * What the storefront reports when a path matched nothing.
 *
 * The referrer comes from the page rather than the header, because the header
 * on a server-rendered request is the storefront's own — and "where did this
 * link come from" is the field that tells a missed redirect apart from a bot.
 */
export const recordNotFoundSchema = z.object({
  path: z.string().trim().min(1).max(2000),
  referer: z.string().trim().max(2000).optional(),
});

export const createRedirectSchema = z.object({
  /** Path only. A full URL is accepted and reduced to its path. */
  from: z.string().trim().min(1).max(2000),
  to: z.string().trim().min(1).max(2000),
  code: z.union([z.literal(301), z.literal(302)]).default(301),
});

export const updateRedirectSchema = z.object({
  to: z.string().trim().min(1).max(2000).optional(),
  code: z.union([z.literal(301), z.literal(302)]).optional(),
  isActive: z.boolean().optional(),
});

/**
 * A guess at what a 404 was reaching for.
 *
 * `kind` is carried so the page can say which shelf the answer is on — a
 * visitor who asked for a product and is offered a category has been given
 * something, but not the thing, and the label is what makes that honest.
 */
export const suggestionSchema = z.object({
  kind: z.enum(['product', 'collection', 'page']),
  title: z.string(),
  href: z.string(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const suggestionsSchema = z.object({
  suggestions: z.array(suggestionSchema),
});
export type Suggestions = z.infer<typeof suggestionsSchema>;

/**
 * The blog.
 *
 * Seven posts carried over from the store this replaces, and they are the only
 * pages on it that answer a question somebody types into a search engine rather
 * than a shopping query — "اختصارات Excel", "ويندوز 10 مقابل ويندوز 11". On a
 * migration whose whole risk is losing organic traffic, dropping the only
 * editorial content would have been the one avoidable loss.
 */
export const articleCardSchema = z.object({
  slug: slugSchema,
  locale: localeSchema,
  title: z.string(),
  /**
   * Never derived by the reader.
   *
   * The store this replaces derived its excerpt by stripping tags from the
   * body, which removes `<style>` and `</style>` and leaves the CSS between
   * them as text — so three of its seven article cards print
   * `da-article { font-family: 'Tajawal'…` where a summary should be. This
   * field is written once at import, from prose only.
   */
  summary: z.string().nullable(),
  readingMinutes: z.number().int().min(0),
  publishedAt: z.string().nullable(),
});
export type ArticleCard = z.infer<typeof articleCardSchema>;

export const articleSchema = articleCardSchema.extend({
  blocks: blockDocumentSchema,
  seo: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
  }),
  updatedAt: z.string(),
  /** True when this post is not published; only reachable in preview. */
  isDraft: z.boolean(),
  /** Newer posts, for the foot of the page. Never includes this one. */
  more: z.array(articleCardSchema),
});
export type Article = z.infer<typeof articleSchema>;

export const blogIndexSchema = z.object({
  posts: z.array(articleCardSchema),
  total: z.number().int().min(0),
});
export type BlogIndex = z.infer<typeof blogIndexSchema>;

/** Posts under a single post, and on the home page's latest row. */
export const BLOG_MORE_SIZE = 3;
