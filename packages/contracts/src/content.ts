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
