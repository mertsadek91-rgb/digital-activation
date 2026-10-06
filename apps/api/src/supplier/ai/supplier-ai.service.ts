import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type DraftProduct,
  type GenerateCopy,
  type GeneratedCopy,
  type GeneratedLocaleCopy,
  SUPPLIER_AI_SETTING_KEY,
  type SupplierAiModels,
  type SupplierAiSettings,
  type SupplierAiStatus,
  type SupplierAiTest,
  activationMethodSchema,
  editableBlockSchema,
  generatedLocaleCopySchema,
  licensePeriodUnitSchema,
  platformSchema,
  productKindSchema,
  supplierAiSettingsSchema,
} from '@da/contracts';
import { Locale, PublishStatus } from '@da/db';
import { z } from 'zod';

import { bodyText } from '../../admin/readiness.js';
import { AuditService } from '../../auth/audit.service.js';
import { say } from '../../common/panel-locale.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { proposePrice } from '../pricing.js';

import {
  DEFAULT_OPENCODE_BASE,
  OpenCodeClient,
  OpenCodeError,
  type ResolvedProtocol,
  extractJson,
  familyOf,
  protocolFor,
} from './opencode.js';
import {
  type ProductFacts,
  type StyleSample,
  copySystemPrompt,
  copyUserPrompt,
  draftSystemPrompt,
  draftUserPrompt,
} from './prompts.js';

type Actor = { staffId: string; ip?: string | undefined; userAgent?: string | undefined };

/** The model's identity answer, loosely: every field is checked again below. */
const draftAnswerSchema = z.object({
  nameEn: z.string().trim().min(2).max(200),
  nameAr: z.string().trim().min(2).max(200),
  slug: z.string().trim().max(120),
  kind: productKindSchema.catch('KEY'),
  licensePeriodUnit: licensePeriodUnitSchema.catch('LIFETIME'),
  licensePeriodValue: z.coerce.number().int().min(1).max(120).nullable().catch(null),
  deviceCount: z.coerce.number().int().min(1).max(10_000).catch(1),
  platform: platformSchema.catch('WINDOWS'),
  activationMethod: activationMethodSchema.catch('RETAIL_ONLINE'),
  brand: z.string().trim().max(80).nullable().catch(null),
});

/**
 * AI product copy and product drafts, through the owner's OpenCode account.
 *
 * Every output is a proposal returned to the panel. This service writes no
 * product row; saving goes through the existing copy, content and create
 * endpoints, where validation, sanitising and the audit log already live.
 */
@Injectable()
export class SupplierAiService {
  private readonly logger = new Logger(SupplierAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private client(): OpenCodeClient {
    const key = process.env.OPENCODE_API_KEY;
    if (!key) {
      throw new BadRequestException(
        say(
          'مفتاح OpenCode غير مضبوط على الخادم (OPENCODE_API_KEY).',
          'OPENCODE_API_KEY is not set on the API.',
        ),
      );
    }
    return new OpenCodeClient(key, process.env.OPENCODE_BASE_URL ?? DEFAULT_OPENCODE_BASE);
  }

  // --- settings -------------------------------------------------------------

  async settings(): Promise<SupplierAiSettings> {
    const row = await this.prisma.client.setting.findUnique({
      where: { key: SUPPLIER_AI_SETTING_KEY },
    });
    const parsed = supplierAiSettingsSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : supplierAiSettingsSchema.parse({});
  }

  async status(): Promise<SupplierAiStatus> {
    const settings = await this.settings();
    return {
      ...settings,
      configured: Boolean(process.env.OPENCODE_API_KEY),
      resolvedProtocol: settings.model ? this.protocol(settings) : null,
    };
  }

  async setSettings(input: SupplierAiSettings, actor: Actor): Promise<SupplierAiStatus> {
    const before = await this.settings();
    await this.prisma.client.setting.upsert({
      where: { key: SUPPLIER_AI_SETTING_KEY },
      update: { value: input },
      create: { key: SUPPLIER_AI_SETTING_KEY, value: input },
    });
    await this.audit.record({
      actorId: actor.staffId,
      entity: 'Setting',
      entityId: SUPPLIER_AI_SETTING_KEY,
      action: 'supplier.ai_settings_changed',
      before,
      after: input,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.status();
  }

  private protocol(settings: SupplierAiSettings): ResolvedProtocol {
    if (!settings.model)
      throw new BadRequestException(say('اختر نموذجاً أولاً.', 'Choose a model first.'));
    return settings.protocol === 'auto' ? protocolFor(settings.model) : settings.protocol;
  }

  async models(): Promise<SupplierAiModels> {
    try {
      const ids = await this.client().models();
      return {
        models: ids
          .map((id) => ({ id, protocol: protocolFor(id), family: familyOf(id) }))
          .sort((a, b) => a.family.localeCompare(b.family) || a.id.localeCompare(b.id)),
      };
    } catch (error) {
      throw this.asBadRequest(error);
    }
  }

  async test(): Promise<SupplierAiTest> {
    const settings = await this.settings();
    const protocol = this.protocol(settings);
    const model = settings.model ?? '';
    const started = Date.now();
    try {
      const reply = await this.client().complete({
        model,
        protocol,
        system: 'You are a connectivity check. Reply with a single short sentence.',
        prompt: 'Say hello in Arabic and English in one line.',
        maxTokens: 200,
        temperature: 0,
      });
      return {
        ok: true,
        model,
        protocol,
        reply: reply.trim().slice(0, 300),
        ms: Date.now() - started,
      };
    } catch (error) {
      throw this.asBadRequest(error);
    }
  }

  /** One call to the chosen model, its answer parsed as a JSON object. */
  async completeJson(system: string, prompt: string, maxTokens: number): Promise<unknown> {
    const settings = await this.settings();
    const protocol = this.protocol(settings);
    try {
      const text = await this.client().complete({
        model: settings.model ?? '',
        protocol,
        system,
        prompt,
        maxTokens,
        temperature: settings.temperature,
      });
      return extractJson(text);
    } catch (error) {
      throw this.asBadRequest(error);
    }
  }

  // --- copy -----------------------------------------------------------------

  async generateCopy(input: GenerateCopy): Promise<GeneratedCopy> {
    const settings = await this.settings();
    const protocol = this.protocol(settings);
    const model = settings.model ?? '';
    const facts = await this.facts(input.productSlug);
    const sample = await this.styleSample(input.productSlug);
    const client = this.client();
    const notes: string[] = [];
    const result: GeneratedCopy = { model, ar: null, en: null, notes };

    for (const locale of input.locales) {
      const prompt = copyUserPrompt({
        locale,
        facts,
        focusKeywords: input.focusKeywords,
        sample: locale === 'ar' ? sample : null,
      });
      try {
        const copy = await this.askForCopy(client, {
          model,
          protocol,
          system: copySystemPrompt(settings.instructions),
          prompt,
          temperature: settings.temperature,
          notes,
          locale,
        });
        result[locale] = copy;
      } catch (error) {
        throw this.asBadRequest(error);
      }
    }
    return result;
  }

  /**
   * Asks once, validates, and asks once more with the validation errors if
   * the first answer did not fit. Blocks that do not parse are dropped rather
   * than failing the whole answer.
   */
  private async askForCopy(
    client: OpenCodeClient,
    input: {
      model: string;
      protocol: ResolvedProtocol;
      system: string;
      prompt: string;
      temperature: number;
      notes: string[];
      locale: 'ar' | 'en';
    },
  ): Promise<GeneratedLocaleCopy> {
    let prompt = input.prompt;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = await client.complete({
        model: input.model,
        protocol: input.protocol,
        system: input.system,
        prompt,
        maxTokens: 8000,
        temperature: input.temperature,
      });
      try {
        const parsed = normaliseCopy(extractJson(text), input.notes, input.locale);
        const checked = generatedLocaleCopySchema.safeParse(parsed);
        if (checked.success) return checked.data;
        lastError = checked.error.issues
          .slice(0, 8)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'unreadable answer';
      }
      input.notes.push(
        `${input.locale}: attempt ${String(attempt + 1)} rejected (${lastError.slice(0, 200)})`,
      );
      prompt = `${input.prompt}\n\nYour previous answer was rejected: ${lastError}. Return the corrected JSON object only.`;
    }
    throw new OpenCodeError(
      `The model's ${input.locale} answer did not fit the page shape: ${lastError}`,
      null,
    );
  }

  private async facts(slug: string): Promise<ProductFacts> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: {
        translations: { select: { locale: true, name: true } },
        brand: { select: { name: true } },
        categories: {
          include: {
            category: { include: { translations: { select: { locale: true, name: true } } } },
          },
        },
        variants: {
          orderBy: { position: 'asc' },
          include: {
            supplierLink: { include: { item: { select: { name: true, warranty: true } } } },
          },
        },
      },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));
    const name = (locale: Locale) =>
      product.translations.find((t) => t.locale === locale)?.name ?? null;
    return {
      nameAr: name(Locale.AR),
      nameEn: name(Locale.EN),
      brand: product.brand?.name ?? null,
      categories: product.categories.map(
        (link) =>
          link.category.translations.find((t) => t.locale === Locale.EN)?.name ??
          link.category.translations[0]?.name ??
          link.category.slug,
      ),
      kind: product.kind,
      variants: product.variants.map((variant) => ({
        terms: `${variant.licensePeriodUnit === 'LIFETIME' ? 'lifetime licence' : `${String(variant.licensePeriodValue ?? 1)} ${variant.licensePeriodUnit.toLowerCase()}(s)`}, ${String(variant.deviceCount)} device(s)`,
        platform: variant.platform,
        activationMethod: variant.activationMethod,
        deliveryMinutes: Math.max(1, Math.round(variant.deliverySlaSeconds / 60)),
        warrantyDays: variant.warrantyDays,
      })),
      supplierLines: product.variants
        .map((variant) => variant.supplierLink?.item)
        .filter((item): item is { name: string; warranty: string | null } => Boolean(item)),
    };
  }

  /** One finished Arabic page from the store, for tone. Not this product. */
  private async styleSample(excludeSlug: string): Promise<StyleSample | null> {
    const row = await this.prisma.client.productTranslation.findFirst({
      where: {
        locale: Locale.AR,
        seoTitle: { not: null },
        seoDescription: { not: null },
        shortDesc: { not: null },
        product: { status: PublishStatus.PUBLISHED, seoReady: true, slug: { not: excludeSlug } },
      },
      orderBy: { product: { salesCount: 'desc' } },
      select: { seoTitle: true, seoDescription: true, shortDesc: true, body: true },
    });
    if (!row?.seoTitle || !row.seoDescription || !row.shortDesc) return null;
    return {
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      shortDesc: row.shortDesc,
      excerpt: bodyText(row.body).replace(/\s+/g, ' ').trim().slice(0, 700),
    };
  }

  // --- a new product from a sheet line --------------------------------------

  async draftProduct(itemId: string): Promise<DraftProduct> {
    const item = await this.prisma.client.supplierItem.findUnique({
      where: { id: itemId },
      include: { source: true },
    });
    if (!item) throw new NotFoundException(say('لا يوجد سطر بهذا المعرّف.', 'No such sheet line.'));
    const settings = await this.settings();
    const protocol = this.protocol(settings);
    const model = settings.model ?? '';
    const notes: string[] = [];

    let answer: z.infer<typeof draftAnswerSchema>;
    try {
      const text = await this.client().complete({
        model,
        protocol,
        system: draftSystemPrompt(),
        prompt: draftUserPrompt(item),
        maxTokens: 1200,
        temperature: 0,
      });
      answer = draftAnswerSchema.parse(extractJson(text));
    } catch (error) {
      throw this.asBadRequest(error);
    }

    const slug = await this.freeSlug(slugify(answer.slug || answer.nameEn));
    const sku = await this.freeSku(slug.toUpperCase().slice(0, 60));
    const brand = answer.brand
      ? await this.prisma.client.brand.findFirst({
          where: { name: { equals: answer.brand, mode: 'insensitive' } },
          select: { id: true },
        })
      : null;
    if (answer.brand && !brand)
      notes.push(
        say(
          `العلامة "${answer.brand}" غير موجودة في الكتالوج بعد.`,
          `Brand "${answer.brand}" is not in the catalogue yet.`,
        ),
      );
    if (item.wholesaleOnly)
      notes.push(
        say(
          'المورّد يبيع هذا السطر بحد أدنى للكمية (جملة).',
          'The supplier sells this line with a minimum order quantity.',
        ),
      );
    if (!item.costUsd)
      notes.push(
        say(
          'لا سعر لهذا السطر في الشيت؛ حدّد السعر يدوياً.',
          'The sheet has no price for this line; set the price by hand.',
        ),
      );

    // Matched by name to the supplier's category, when we have one called that.
    const category = item.category
      ? await this.prisma.client.categoryTranslation.findFirst({
          where: { name: { equals: item.category, mode: 'insensitive' } },
          select: { categoryId: true },
        })
      : null;

    const price = item.costUsd
      ? proposePrice(item.costUsd, item.source.markupPercent, item.source.rounding).toFixed(2)
      : '0.00';

    return {
      model,
      slug,
      nameAr: answer.nameAr,
      nameEn: answer.nameEn,
      kind: answer.kind,
      sku,
      licensePeriodUnit: answer.licensePeriodUnit,
      licensePeriodValue:
        answer.licensePeriodUnit === 'LIFETIME' ? null : (answer.licensePeriodValue ?? 1),
      deviceCount: answer.deviceCount,
      platform: answer.platform,
      activationMethod: answer.activationMethod,
      priceUsd: price,
      brandId: brand?.id ?? null,
      categoryIds: category ? [category.categoryId] : [],
      notes,
    };
  }

  private async freeSlug(base: string): Promise<string> {
    const root = base || 'product';
    for (let n = 1; n < 50; n += 1) {
      const candidate = n === 1 ? root : `${root}-${String(n)}`;
      const taken = await this.prisma.client.product.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${root}-${Date.now().toString(36)}`;
  }

  private async freeSku(base: string): Promise<string> {
    const root = base.replace(/[^A-Z0-9-]/g, '').replace(/^-+/, '') || 'SKU';
    for (let n = 1; n < 50; n += 1) {
      const candidate = n === 1 ? root : `${root}-${String(n)}`;
      const taken = await this.prisma.client.variant.findUnique({
        where: { sku: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${root}-${Date.now().toString(36).toUpperCase()}`;
  }

  private asBadRequest(error: unknown): Error {
    if (error instanceof BadRequestException || error instanceof NotFoundException) return error;
    const message = error instanceof Error ? error.message : 'unknown error';
    this.logger.warn(`OpenCode call failed: ${message}`);
    return new BadRequestException(message);
  }
}

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/**
 * Brings a model's answer into our shapes before validation: drops blocks we
 * do not save, trims strings to their limits, and keeps the answer-first block
 * first. What it changes it says in `notes`.
 */
export function normaliseCopy(raw: unknown, notes: string[], locale: 'ar' | 'en'): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const record = raw as Record<string, unknown>;
  const clip = (value: unknown, max: number): unknown =>
    typeof value === 'string' && value.length > max ? value.slice(0, max).trimEnd() : value;

  const blocks: unknown[] = [];
  for (const block of Array.isArray(record.blocks) ? record.blocks : []) {
    const parsed = editableBlockSchema.safeParse(block);
    if (parsed.success) blocks.push(parsed.data);
    else {
      const type = (block as { type?: unknown } | null)?.type;
      notes.push(
        `${locale}: dropped a "${typeof type === 'string' ? type : 'unknown'}" block that did not fit`,
      );
    }
  }
  blocks.sort((a, b) => {
    const first = (block: unknown) => ((block as { type: string }).type === 'answerFirst' ? 0 : 1);
    return first(a) - first(b);
  });

  return {
    shortDesc: clip(record.shortDesc, 200),
    seoTitle: clip(record.seoTitle, 200),
    seoDescription: clip(record.seoDescription, 500),
    keywords: Array.isArray(record.keywords)
      ? record.keywords
          .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
          .slice(0, 12)
      : [],
    blocks: blocks.slice(0, 20),
  };
}
