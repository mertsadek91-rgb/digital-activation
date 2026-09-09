import { z } from 'zod';

import { slugSchema } from './primitives.js';

/**
 * The block vocabulary for Page.blocks, Article.blocks, CategoryTranslation.body
 * and ProductTranslation.body.
 *
 * Two rules shaped this list. First, everything that carries meaning has to be
 * text in the DOM: the legacy store put the entire pitch for its best-selling
 * bundle inside one PNG, which no crawler and no answer engine can read.
 * Second, `faq` and `specTable` exist as their own blocks because those two are
 * what actually get quoted — FAQ into rich results, tables into AI answers.
 */

const richTextBlock = z.object({
  type: z.literal('richText'),
  /** Sanitised HTML from the editor. */
  html: z.string(),
});

const headingBlock = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: z.string().min(1),
  /** Anchor id, so a guide can be deep-linked and cited. */
  id: slugSchema.optional(),
});

const imageBlock = z.object({
  type: z.literal('image'),
  assetId: z.string(),
  /** Caption, not a substitute for the asset's per-locale alt text. */
  caption: z.string().optional(),
  width: z.enum(['content', 'wide', 'full']).default('content'),
});

const answerFirstBlock = z.object({
  type: z.literal('answerFirst'),
  /**
   * The 40–60 word direct answer that opens every guide and comparison. Also
   * the passage most likely to be lifted by an AI answer engine, so it must
   * stand alone without the surrounding article.
   */
  text: z.string().min(40).max(600),
});

const stepsBlock = z.object({
  type: z.literal('steps'),
  title: z.string().optional(),
  steps: z
    .array(
      z.object({
        text: z.string().min(1),
        assetId: z.string().optional(),
      }),
    )
    .min(1)
    .max(12),
});

const faqBlock = z.object({
  type: z.literal('faq'),
  title: z.string().optional(),
  items: z
    .array(z.object({ q: z.string().min(1), a: z.string().min(1) }))
    .min(1)
    .max(20),
});

/** Rendered as a real <table>. LLMs quote tables; they do not quote images. */
const specTableBlock = z.object({
  type: z.literal('specTable'),
  title: z.string().optional(),
  rows: z.array(z.object({ label: z.string(), value: z.string() })).min(1),
});

const comparisonBlock = z.object({
  type: z.literal('comparison'),
  columns: z.array(z.string()).min(2).max(5),
  rows: z.array(z.object({ label: z.string(), cells: z.array(z.string()) })).min(1),
  /** Optional product slugs, one per column, to link the table to the catalog. */
  productSlugs: z.array(slugSchema).optional(),
});

const productGridBlock = z.object({
  type: z.literal('productGrid'),
  title: z.string().optional(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('category'), slug: slugSchema }),
    z.object({ kind: z.literal('brand'), slug: slugSchema }),
    z.object({
      kind: z.literal('manual'),
      slugs: z.array(slugSchema).min(1).max(24),
    }),
    z.object({ kind: z.literal('bestSelling') }),
    z.object({ kind: z.literal('onSale') }),
  ]),
  limit: z.number().int().min(1).max(24).default(8),
});

const ctaBlock = z.object({
  type: z.literal('cta'),
  heading: z.string().min(1),
  body: z.string().optional(),
  buttonLabel: z.string().min(1),
  buttonHref: z.string().min(1),
  tone: z.enum(['brand', 'accent']).default('brand'),
});

const trustBlock = z.object({
  type: z.literal('trust'),
  /** Which proof points to show. All are read from real data at render time. */
  items: z
    .array(z.enum(['goldenWarranty', 'deliverySla', 'salesCount', 'paymentMethods', 'support']))
    .min(1),
});

const reviewsBlock = z.object({
  type: z.literal('reviews'),
  /** Verified-purchase reviews only; there is no other kind in this system. */
  limit: z.number().int().min(1).max(20).default(6),
});

export const blockSchema = z.discriminatedUnion('type', [
  richTextBlock,
  headingBlock,
  imageBlock,
  answerFirstBlock,
  stepsBlock,
  faqBlock,
  specTableBlock,
  comparisonBlock,
  productGridBlock,
  ctaBlock,
  trustBlock,
  reviewsBlock,
]);
export type Block = z.infer<typeof blockSchema>;

export const blockDocumentSchema = z.array(blockSchema);
export type BlockDocument = z.infer<typeof blockDocumentSchema>;

/** Shape of ProductTranslation.faq and CategoryTranslation.faq. */
export const faqItemsSchema = z
  .array(z.object({ q: z.string().min(1), a: z.string().min(1) }))
  .max(20);

/** Shape of ProductTranslation.activationSteps. */
export const activationStepsSchema = z
  .array(
    z.object({
      step: z.number().int().min(1),
      text: z.string().min(1),
      assetId: z.string().optional(),
    }),
  )
  .max(12);
