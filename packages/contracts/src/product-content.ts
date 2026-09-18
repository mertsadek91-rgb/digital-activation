import { z } from 'zod';

import { localeSchema } from './primitives.js';

/**
 * A product's description, as a person edits it.
 *
 * The body is a block document and the panel could only ever edit one shape of
 * it: a single `richText` block. That was true when every imported Arabic body
 * was exactly that. It stopped being true the day `db:bodies` wrote a real
 * description for the catalog — a heading, an opening answer, a specification
 * table, the activation steps and an FAQ — and from then on the editor refused
 * 77 of the 146 translations rather than flatten them.
 *
 * Refusing was the right call at the time: an `faq` and a `specTable` are
 * precisely the passages a search or an answer engine quotes, and dropping one
 * to fix a typo would be a bad trade made silently. But the answer to "this
 * editor cannot hold the shape" is to hold the shape.
 *
 * So: six block types, which are the six this catalog actually contains.
 * Anything else that appears in a body is carried through untouched and shown
 * as read-only, because a block the editor does not understand is still
 * somebody's content.
 */

const richTextBlock = z.object({
  type: z.literal('richText'),
  /** Sanitised server-side on the way in and again on the way out. */
  html: z.string().max(60_000),
});

const headingBlock = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3)]),
  text: z.string().trim().min(1).max(200),
});

/**
 * The 40–60 word direct answer that opens a page.
 *
 * Its own type rather than a paragraph because of where it goes: this is the
 * passage an answer engine lifts, so it has to stand alone without the text
 * around it. The floor of 40 characters is the schema's, and it is a floor
 * against a one-line placeholder.
 */
const answerFirstBlock = z.object({
  type: z.literal('answerFirst'),
  text: z.string().trim().min(40).max(600),
});

const stepsBlock = z.object({
  type: z.literal('steps'),
  title: z.string().trim().max(200).optional(),
  steps: z.array(z.object({ text: z.string().trim().min(1).max(600) })).min(1).max(12),
});

const faqBlock = z.object({
  type: z.literal('faq'),
  title: z.string().trim().max(200).optional(),
  items: z
    .array(z.object({ q: z.string().trim().min(1).max(300), a: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(20),
});

const specTableBlock = z.object({
  type: z.literal('specTable'),
  title: z.string().trim().max(200).optional(),
  rows: z
    .array(z.object({ label: z.string().trim().min(1).max(120), value: z.string().trim().max(400) }))
    .min(1)
    .max(40),
});

/**
 * A block this editor does not know.
 *
 * Kept whole and put back exactly as it came. The alternative — dropping what
 * the form cannot draw — turns every save into a silent deletion of whatever
 * somebody added with a newer tool.
 */
const opaqueBlock = z.object({
  type: z.string(),
  /** The original JSON, verbatim, so the round trip is lossless. */
  raw: z.unknown(),
});

export const editableBlockSchema = z.discriminatedUnion('type', [
  richTextBlock,
  headingBlock,
  answerFirstBlock,
  stepsBlock,
  faqBlock,
  specTableBlock,
]);
export type EditableBlock = z.infer<typeof editableBlockSchema>;

export const contentBlockSchema = z.union([editableBlockSchema, opaqueBlock]);
export type ContentBlock = z.infer<typeof contentBlockSchema>;

/**
 * A warning on a product page.
 *
 * "Not for Windows 10 Home", "the licence is region-locked to the GCC". The
 * column existed and nothing had ever written to it or read from it; these are
 * the sentences that turn a refund into a sale not made, which is the cheaper
 * of the two.
 */
export const productWarningSchema = z.object({
  text: z.string().trim().min(3).max(300),
  /** `critical` is drawn as a refusal, `note` as an aside. */
  severity: z.enum(['note', 'critical']).default('note'),
});
export type ProductWarning = z.infer<typeof productWarningSchema>;

export const productContentSchema = z.object({
  locale: localeSchema,
  /** Context only — the name is edited in the identity drawer. */
  name: z.string(),
  blocks: z.array(contentBlockSchema),
  warnings: z.array(productWarningSchema),
  downloadUrl: z.string(),
  /** Words the publish gate counts, so the editor can show the same number. */
  bodyWords: z.number().int().min(0),
  /** The floor the gate applies, so the editor never guesses at it. */
  bodyMinWords: z.number().int().min(0),
});
export type ProductContent = z.infer<typeof productContentSchema>;

export const setProductContentSchema = z.object({
  locale: localeSchema.default('ar'),
  blocks: z.array(contentBlockSchema).max(40).optional(),
  warnings: z.array(productWarningSchema).max(10).optional(),
  /**
   * The vendor's own download page.
   *
   * Empty clears it. `http` is accepted and upgraded rather than refused: a
   * vendor page on plain HTTP is still the right page, and refusing the save
   * would leave the field empty instead.
   */
  downloadUrl: z.union([z.string().trim().url().max(500), z.literal('')]).optional(),
});
export type SetProductContent = z.infer<typeof setProductContentSchema>;
