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
