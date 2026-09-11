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
