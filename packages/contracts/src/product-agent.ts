import { z } from 'zod';

import { publishStatusSchema } from './catalog-edit.js';
import { cardIconSchema } from './supplier-ai.js';

/**
 * The product agent (CR-0007): a person ticks products — published ones to
 * rewrite, or supplier lines to turn into new products — presses start, and
 * the API works through them one at a time in the background.
 *
 * For each product it decides the section (keeps it, corrects it, or creates
 * a new one), writes the Arabic and English page through the same AI copy
 * the editor uses, finds the brand's logo on its official site, takes the
 * logo's colours for the product card, and publishes when the publish gate
 * passes. The owner asked for the output to be approved automatically and
 * followed up afterwards, so every rewrite keeps a snapshot of what it
 * replaced and can be undone from the batch screen.
 *
 * Between two products the worker waits (`cooldownSeconds`): every product is
 * several large model calls, and asking for them back to back is how an
 * account hits its provider's rate limit halfway through a batch of fifty.
 */

export const AGENT_BATCH_KINDS = ['REWRITE', 'CREATE'] as const;
export const agentBatchKindSchema = z.enum(AGENT_BATCH_KINDS);
export type AgentBatchKind = z.infer<typeof agentBatchKindSchema>;

export const AGENT_BATCH_STATUSES = ['RUNNING', 'PAUSED', 'DONE', 'CANCELLED'] as const;
export const agentBatchStatusSchema = z.enum(AGENT_BATCH_STATUSES);
export type AgentBatchStatus = z.infer<typeof agentBatchStatusSchema>;

export const AGENT_ITEM_STATUSES = [
  'QUEUED',
  'RUNNING',
  'DONE',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
  'REVERTED',
] as const;
export const agentItemStatusSchema = z.enum(AGENT_ITEM_STATUSES);
export type AgentItemStatus = z.infer<typeof agentItemStatusSchema>;

/** When the agent draws a product card: never, only for a product with no picture, or always. */
export const agentCardModeSchema = z.enum(['never', 'missing', 'always']);
export type AgentCardMode = z.infer<typeof agentCardModeSchema>;

/** Seconds between two products. 90 keeps a batch near forty products an hour. */
export const AGENT_DEFAULT_COOLDOWN = 90;
export const AGENT_MIN_COOLDOWN = 30;
export const AGENT_MAX_COOLDOWN = 900;
/** The most products one batch takes. */
export const AGENT_MAX_BATCH = 200;

export const agentOptionsSchema = z.object({
  /** Write the Arabic and English page. */
  copy: z.boolean().default(true),
  /** Check the product's section, correct it, or create one that is missing. */
  category: z.boolean().default(true),
  /** May create a section that does not exist yet. Off: only existing ones. */
  newCategories: z.boolean().default(true),
  card: agentCardModeSchema.default('missing'),
  /** Publish when the publish gate passes: the owner's "approve automatically". */
  publish: z.boolean().default(true),
  /** House notes for this batch only ("mention the golden warranty"). */
  instructions: z.string().trim().max(1000).default(''),
});
export type AgentOptions = z.infer<typeof agentOptionsSchema>;

export const startAgentBatchSchema = z.object({
  kind: agentBatchKindSchema,
  /** Product ids for REWRITE, supplier line ids for CREATE. */
  ids: z
    .array(z.string().trim().min(1).max(64))
    .min(1)
    .max(AGENT_MAX_BATCH)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate ids.' }),
  options: agentOptionsSchema.default(agentOptionsSchema.parse({})),
  cooldownSeconds: z.coerce
    .number()
    .int()
    .min(AGENT_MIN_COOLDOWN)
    .max(AGENT_MAX_COOLDOWN)
    .default(AGENT_DEFAULT_COOLDOWN),
});
export type StartAgentBatch = z.infer<typeof startAgentBatchSchema>;

// --- what one item records ------------------------------------------------------

/**
 * One line of an item's log, as a code the panel translates plus a detail
 * (a section's name, a URL, a server message) shown as it is.
 */
export const AGENT_LOG_CODES = [
  'started',
  'drafted',
  'exists',
  'created',
  'linked',
  'planned',
  'translationAdded',
  'categoryKept',
  'categoryAssigned',
  'categoryCreated',
  'categorySkipped',
  'copyWritten',
  'copySkipped',
  'logoBrand',
  'logoWeb',
  'logoNone',
  'cardSaved',
  'cardSkipped',
  'published',
  'publishBlocked',
  'rateLimited',
  'workerLost',
  'retried',
  'failed',
  'reverted',
] as const;
export const agentLogCodeSchema = z.enum(AGENT_LOG_CODES);
export type AgentLogCode = z.infer<typeof agentLogCodeSchema>;

export const agentLogEntrySchema = z.object({
  at: z.string(),
  code: agentLogCodeSchema,
  level: z.enum(['info', 'warn', 'error']),
  detail: z.string().max(2000).default(''),
});
export type AgentLogEntry = z.infer<typeof agentLogEntrySchema>;

export const agentItemResultSchema = z.object({
  productSlug: z.string().nullable(),
  /** The product was made by this item (CREATE). */
  created: z.boolean(),
  category: z
    .object({
      action: z.enum(['kept', 'assigned', 'created']),
      names: z.array(z.string()),
      reason: z.string().max(500),
    })
    .nullable(),
  copyLocales: z.array(z.enum(['ar', 'en'])),
  card: z
    .object({
      logoSource: z.enum(['brand', 'web', 'none']),
      /** Where the logo was found, for a person to check. */
      logoUrl: z.string().nullable(),
      /** The logo's main colours, the first used for the card. */
      palette: z.array(z.string()),
      mediaId: z.string(),
    })
    .nullable(),
  /** Published by this item; null when publishing was not asked for. */
  published: z.boolean().nullable(),
  /** The publish gate's reasons, when it refused. */
  blockers: z.array(z.string()),
});
export type AgentItemResult = z.infer<typeof agentItemResultSchema>;

/** What a rewrite replaced, kept so it can be undone. */
export const agentSnapshotSchema = z.object({
  status: publishStatusSchema,
  primaryCategoryId: z.string().nullable(),
  categoryIds: z.array(z.string()),
  translations: z.array(
    z.object({
      locale: z.enum(['ar', 'en']),
      seoTitle: z.string().nullable(),
      seoDescription: z.string().nullable(),
      shortDesc: z.string().nullable(),
      body: z.unknown(),
    }),
  ),
  /** Translations this item added, removed again on undo. */
  addedLocales: z.array(z.enum(['ar', 'en'])).default([]),
  /** Pictures this item added, removed again on undo. */
  addedMediaIds: z.array(z.string()).default([]),
});
export type AgentSnapshot = z.infer<typeof agentSnapshotSchema>;

// --- what the panel reads -------------------------------------------------------

export const agentCountsSchema = z.object({
  total: z.number().int(),
  queued: z.number().int(),
  running: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  cancelled: z.number().int(),
  reverted: z.number().int(),
});
export type AgentCounts = z.infer<typeof agentCountsSchema>;

export const agentBatchSummarySchema = z.object({
  id: z.string(),
  kind: agentBatchKindSchema,
  status: agentBatchStatusSchema,
  options: agentOptionsSchema,
  cooldownSeconds: z.number().int(),
  /** When the next product starts, while the batch runs. */
  nextRunAt: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  createdBy: z.string().nullable(),
  counts: agentCountsSchema,
});
export type AgentBatchSummary = z.infer<typeof agentBatchSummarySchema>;

export const agentItemViewSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  status: agentItemStatusSchema,
  label: z.string(),
  productSlug: z.string().nullable(),
  step: z.string().nullable(),
  attempts: z.number().int(),
  log: z.array(agentLogEntrySchema),
  result: agentItemResultSchema.nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  canRevert: z.boolean(),
});
export type AgentItemView = z.infer<typeof agentItemViewSchema>;

export const agentBatchDetailSchema = agentBatchSummarySchema.extend({
  items: z.array(agentItemViewSchema),
});
export type AgentBatchDetail = z.infer<typeof agentBatchDetailSchema>;

export const agentOverviewSchema = z.object({
  /** OPENCODE_API_KEY is set and a model is chosen. */
  aiReady: z.boolean(),
  model: z.string().nullable(),
  /** False when the worker is switched off on this API (PRODUCT_AGENT=off). */
  workerOn: z.boolean(),
  batches: z.array(agentBatchSummarySchema),
});
export type AgentOverview = z.infer<typeof agentOverviewSchema>;

/** The last time the agent worked on a product or line. */
export const agentLastRunSchema = z
  .object({ status: agentItemStatusSchema, at: z.string() })
  .nullable();

export const agentProductCandidateSchema = z.object({
  id: z.string(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  status: publishStatusSchema,
  brand: z.string().nullable(),
  categories: z.array(z.string()),
  hasImage: z.boolean(),
  /** Arabic body words, so thin pages can be picked first. */
  words: z.number().int(),
  lastRun: agentLastRunSchema,
});
export type AgentProductCandidate = z.infer<typeof agentProductCandidateSchema>;

export const agentSupplierCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  costUsd: z.string().nullable(),
  outOfStock: z.boolean(),
  wholesaleOnly: z.boolean(),
  lastRun: agentLastRunSchema,
});
export type AgentSupplierCandidate = z.infer<typeof agentSupplierCandidateSchema>;

export const agentCandidatesSchema = z.object({
  products: z.array(agentProductCandidateSchema),
  /** Supplier lines no variant of ours is linked to yet. */
  supplierLines: z.array(agentSupplierCandidateSchema),
});
export type AgentCandidates = z.infer<typeof agentCandidatesSchema>;

// --- the model's plan for one product -------------------------------------------

/**
 * One model call per product decides the section, the brand's website and
 * the card's words, so the expensive copy calls are the only other ones.
 * Loose on purpose: every field is checked again where it is used.
 */
export const agentPlanSchema = z.object({
  category: z.object({
    action: z.enum(['keep', 'assign', 'create']),
    categoryIds: z.array(z.string()).max(4).default([]),
    create: z
      .object({
        nameAr: z.string().trim().min(2).max(120),
        nameEn: z.string().trim().min(2).max(120),
        slug: z.string().trim().max(120),
        parentId: z.string().nullable().default(null),
      })
      .nullable()
      .default(null),
    reason: z.string().trim().max(500).default(''),
  }),
  names: z.object({
    ar: z.string().trim().min(2).max(200),
    en: z.string().trim().min(2).max(200),
  }),
  brand: z.object({
    name: z.string().trim().max(80).nullable().default(null),
    /** The brand's official site, a bare host such as "eset.com". */
    domain: z.string().trim().max(120).nullable().default(null),
  }),
  card: z.object({
    title: z.string().trim().min(1).max(80),
    ribbon: z.array(z.string().trim().min(1).max(14)).max(3),
    chips: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(24),
          icon: cardIconSchema.catch('key'),
        }),
      )
      .length(2),
  }),
});
export type AgentPlan = z.infer<typeof agentPlanSchema>;
