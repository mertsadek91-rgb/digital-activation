import { z } from 'zod';

import {
  activationMethodSchema,
  licensePeriodUnitSchema,
  platformSchema,
  productKindSchema,
} from './catalog.js';
import { editableBlockSchema } from './product-content.js';
import { localeSchema } from './primitives.js';

/**
 * AI product copy through the owner's OpenCode Zen account (CR-0004).
 *
 * OpenCode Zen is one key in front of many models, and each model family
 * speaks its own protocol: Claude and Qwen the Anthropic Messages API, GPT and
 * Grok the OpenAI Responses API, Gemini Google's generateContent, and the
 * rest OpenAI chat completions. The model list comes from the account; the
 * protocol is worked out from the model id unless a person overrides it.
 *
 * Nothing generated is published. A draft comes back to the panel, a person
 * reads it, and saving goes through the same copy and content endpoints a
 * hand edit does — so sanitising, the publish gate and the audit log apply.
 */

export const AI_PROTOCOLS = ['auto', 'messages', 'responses', 'chat', 'gemini'] as const;
export const aiProtocolSchema = z.enum(AI_PROTOCOLS);
export type AiProtocol = z.infer<typeof aiProtocolSchema>;

export const SUPPLIER_AI_SETTING_KEY = 'supplier.ai';

export const supplierAiSettingsSchema = z.object({
  /** An id from the account's model list. Null until one is chosen. */
  model: z.string().trim().min(1).max(120).nullable().default(null),
  protocol: aiProtocolSchema.default('auto'),
  temperature: z.coerce.number().min(0).max(1).default(0.5),
  /** House notes added to every prompt: tone, words to avoid, claims not to make. */
  instructions: z.string().trim().max(2000).default(''),
});
export type SupplierAiSettings = z.infer<typeof supplierAiSettingsSchema>;

export const supplierAiStatusSchema = supplierAiSettingsSchema.extend({
  /** False when OPENCODE_API_KEY is not set on the API. */
  configured: z.boolean(),
  /** The protocol `auto` resolves to for the chosen model. */
  resolvedProtocol: aiProtocolSchema.nullable(),
});
export type SupplierAiStatus = z.infer<typeof supplierAiStatusSchema>;

export const supplierAiModelsSchema = z.object({
  models: z.array(z.object({ id: z.string(), protocol: aiProtocolSchema, family: z.string() })),
});
export type SupplierAiModels = z.infer<typeof supplierAiModelsSchema>;

export const supplierAiTestSchema = z.object({
  ok: z.boolean(),
  model: z.string(),
  protocol: aiProtocolSchema,
  reply: z.string(),
  ms: z.number().int(),
});
export type SupplierAiTest = z.infer<typeof supplierAiTestSchema>;

// --- copy ---------------------------------------------------------------------

export const generateCopySchema = z.object({
  productSlug: z.string().trim().min(1),
  locales: z.array(localeSchema).min(1).max(2).default(['ar', 'en']),
  /** Keywords the person wants the copy built around, comma-separated. */
  focusKeywords: z.string().trim().max(300).default(''),
});
export type GenerateCopy = z.infer<typeof generateCopySchema>;

/** One locale's generated copy, in the shapes the copy and content editors save. */
export const generatedLocaleCopySchema = z.object({
  shortDesc: z.string().trim().min(1).max(200),
  seoTitle: z.string().trim().min(1).max(200),
  seoDescription: z.string().trim().min(1).max(500),
  keywords: z.array(z.string().trim().min(1).max(80)).max(12),
  blocks: z.array(editableBlockSchema).min(1).max(20),
});
export type GeneratedLocaleCopy = z.infer<typeof generatedLocaleCopySchema>;

export const generatedCopySchema = z.object({
  model: z.string(),
  ar: generatedLocaleCopySchema.nullable(),
  en: generatedLocaleCopySchema.nullable(),
  /** Validation problems the model's answer had, fixed or dropped on the way. */
  notes: z.array(z.string()),
});
export type GeneratedCopy = z.infer<typeof generatedCopySchema>;

// --- a new product from a sheet line --------------------------------------------

export const draftProductSchema = z.object({
  model: z.string(),
  slug: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  kind: productKindSchema,
  sku: z.string(),
  licensePeriodUnit: licensePeriodUnitSchema,
  licensePeriodValue: z.number().int().nullable(),
  deviceCount: z.number().int(),
  platform: platformSchema,
  activationMethod: activationMethodSchema,
  /** Cost × markup, from the source's settings. */
  priceUsd: z.string(),
  brandId: z.string().nullable(),
  categoryIds: z.array(z.string()),
  notes: z.array(z.string()),
});
export type DraftProduct = z.infer<typeof draftProductSchema>;

export const linkBySkuSchema = z.object({ sku: z.string().trim().min(1) });

// --- product card image ---------------------------------------------------------

export const CARD_ICONS = ['key', 'bolt', 'shield', 'user', 'clock'] as const;
export const cardIconSchema = z.enum(CARD_ICONS);

export const cardSpecSchema = z.object({
  title: z.string().trim().min(1).max(80),
  ribbon: z.array(z.string().trim().min(1).max(14)).max(3),
  chips: z.tuple([
    z.object({ label: z.string().trim().min(1).max(24), icon: cardIconSchema }),
    z.object({ label: z.string().trim().min(1).max(24), icon: cardIconSchema }),
  ]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'لون بصيغة ‎#rrggbb'),
  /** Draw the brand's logo; false draws the brand name in its colour. */
  useLogo: z.boolean().default(true),
});
export type CardSpecInput = z.infer<typeof cardSpecSchema>;

export const cardDefaultsSchema = z.object({
  spec: cardSpecSchema,
  brandName: z.string().nullable(),
  hasLogo: z.boolean(),
  /** False when the bundled Tajawal font files are missing on the API. */
  fontsAvailable: z.boolean(),
  hasImages: z.boolean(),
});
export type CardDefaults = z.infer<typeof cardDefaultsSchema>;

export const cardPreviewSchema = z.object({
  dataUrl: z.string(),
  notes: z.array(z.string()),
});
export type CardPreview = z.infer<typeof cardPreviewSchema>;

export const saveCardSchema = cardSpecSchema.extend({
  /** Make it the product's main image. */
  isHero: z.boolean().default(false),
});
export type SaveCard = z.infer<typeof saveCardSchema>;
