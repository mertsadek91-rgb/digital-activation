import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type AiCopyJob,
  type AiSectionJob,
  type GenerateSection,
  type SectionResult,
  aiSectionJobKey,
  aiSectionJobSchema,
  sectionResultSchema,
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
  aiCopyJobKey,
  aiCopyJobSchema,
  editableBlockSchema,
  generatedLocaleCopySchema,
  licensePeriodUnitSchema,
  platformSchema,
  productKindSchema,
  supplierAiSettingsSchema,
} from '@da/contracts';
import { Locale, type Prisma, PublishStatus } from '@da/db';
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
import { sectionSystemPrompt, sectionUserPrompt } from './section-prompts.js';
import {
  type CurrentPage,
  type ProductFacts,
  type StyleSample,
  copySystemPrompt,
  copyUserPrompt,
  draftSystemPrompt,
  draftUserPrompt,
} from './prompts.js';

/** Longer than any generation can run: past it a RUNNING job has died. */
const JOB_STALE_MS = 15 * 60 * 1000;
/** Finished jobs are kept a day, for a panel left open overnight. */
const JOB_KEEP_MS = 24 * 60 * 60 * 1000;

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
  async completeJson(
    system: string,
    prompt: string,
    maxTokens: number,
    /** Longer for long answers (BUG-0028); the client's default otherwise. */
    timeoutMs?: number,
  ): Promise<unknown> {
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
        timeoutMs,
      });
      return extractJson(text);
    } catch (error) {
      throw this.asBadRequest(error);
    }
  }

  // --- copy -----------------------------------------------------------------

  async generateCopy(
    input: GenerateCopy,
    /** Called with the result so far each time one language finishes. */
    onPartial?: (partial: GeneratedCopy) => Promise<void>,
  ): Promise<GeneratedCopy> {
    const settings = await this.settings();
    const protocol = this.protocol(settings);
    const model = settings.model ?? '';
    const facts = await this.facts(input.productSlug);
    const sample = await this.styleSample(input.productSlug);
    const client = this.client();
    const notes: string[] = [];
    const result: GeneratedCopy = { model, ar: null, en: null, notes };

    // Both languages at once: they share nothing but the facts, and in
    // sequence two answers from a large model took minutes.
    try {
      await Promise.all(
        input.locales.map(async (locale) => {
          const current = input.mode === 'improve' ? await this.currentPage(input, locale) : null;
          result[locale] = await this.askForCopy(client, {
            model,
            protocol,
            system: copySystemPrompt(settings.instructions),
            prompt: copyUserPrompt({
              locale,
              facts,
              focusKeywords: input.focusKeywords,
              sample: locale === 'ar' && !current ? sample : null,
              current,
              instructions: input.instructions,
            }),
            temperature: settings.temperature,
            notes,
            locale,
          });
          // Shown in the panel while the other language is still writing.
          await onPartial?.({ ...result, notes: [...notes] });
        }),
      );
    } catch (error) {
      throw this.asBadRequest(error);
    }
    return result;
  }

  /**
   * The page's copy in one language for "improve": what the editor sent (its
   * unsaved state included), or else what is stored.
   */
  private async currentPage(input: GenerateCopy, locale: 'ar' | 'en'): Promise<CurrentPage> {
    const sent = input.current[locale];
    if (sent) {
      return {
        seoTitle: sent.seoTitle,
        seoDescription: sent.seoDescription,
        shortDesc: sent.shortDesc,
        body: pageText(sent.blocks),
      };
    }
    const row = await this.prisma.client.productTranslation.findFirst({
      where: {
        product: { slug: input.productSlug },
        locale: locale === 'en' ? Locale.EN : Locale.AR,
      },
      select: { seoTitle: true, seoDescription: true, shortDesc: true, body: true },
    });
    return {
      seoTitle: row?.seoTitle ?? '',
      seoDescription: row?.seoDescription ?? '',
      shortDesc: row?.shortDesc ?? '',
      body: pageText(row?.body ?? []),
    };
  }

  // --- copy jobs --------------------------------------------------------------

  /**
   * Starts copy generation in the background and returns the job at once
   * (BUG-0026). Generation outlives the 100 s Cloudflare holds a request open,
   * which surfaced in the panel as a CORS failure. What can fail fast — no
   * key, no model, no such product — still fails here, in the request.
   *
   * The job lives in the `Setting` table, so any replica can answer the poll
   * and a reload of the panel does not lose it. Finished jobs older than a
   * day are removed as new ones start.
   */
  async startCopyJob(input: GenerateCopy): Promise<AiCopyJob> {
    this.client();
    this.protocol(await this.settings());
    const exists = await this.prisma.client.product.count({ where: { slug: input.productSlug } });
    if (!exists) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    const job: AiCopyJob = {
      id: randomUUID(),
      status: 'RUNNING',
      productSlug: input.productSlug,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    await this.saveJob(job);
    void this.pruneJobs();

    void this.generateCopy(input, (partial) => this.saveJob({ ...job, result: partial })).then(
      (result) =>
        this.saveJob({ ...job, status: 'DONE', result, finishedAt: new Date().toISOString() }),
      (error: unknown) =>
        this.saveJob({
          ...job,
          status: 'FAILED',
          error: (error instanceof Error ? error.message : 'unknown error').slice(0, 1000),
          finishedAt: new Date().toISOString(),
        }),
    );
    return job;
  }

  async copyJob(id: string): Promise<AiCopyJob> {
    const row = await this.prisma.client.setting.findUnique({ where: { key: aiCopyJobKey(id) } });
    const parsed = aiCopyJobSchema.safeParse(row?.value);
    if (!parsed.success)
      throw new NotFoundException(say('لا توجد مهمة بهذا المعرّف.', 'No such job.'));
    const job = parsed.data;
    // A job whose process died (a deploy, a restart) would read RUNNING
    // forever; past the longest a generation can take, it has failed.
    if (job.status === 'RUNNING' && Date.now() - Date.parse(job.startedAt) > JOB_STALE_MS) {
      const failed: AiCopyJob = {
        ...job,
        status: 'FAILED',
        error: say(
          'توقفت المهمة قبل أن تكتمل (أُعيد تشغيل الخادم على الأغلب). أعد المحاولة.',
          'The job stopped before it finished (most likely a server restart). Try again.',
        ),
        finishedAt: new Date().toISOString(),
      };
      await this.saveJob(failed);
      return failed;
    }
    return job;
  }

  // --- one section of a page (CR-0005) ----------------------------------------

  /**
   * Writes or improves one section — SEO fields, activation how-to, FAQ,
   * steps or specification table — in the background, as copy jobs do.
   * Fast failures (no key, no model, no product) still fail in the request.
   */
  async startSectionJob(input: GenerateSection): Promise<AiSectionJob> {
    this.client();
    this.protocol(await this.settings());
    const exists = await this.prisma.client.product.count({ where: { slug: input.productSlug } });
    if (!exists) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    const job: AiSectionJob = {
      id: randomUUID(),
      status: 'RUNNING',
      section: input.section,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    await this.saveSectionJob(job);
    void this.pruneJobs();
    void this.generateSection(input).then(
      (result) =>
        this.saveSectionJob({
          ...job,
          status: 'DONE',
          result,
          finishedAt: new Date().toISOString(),
        }),
      (error: unknown) =>
        this.saveSectionJob({
          ...job,
          status: 'FAILED',
          error: (error instanceof Error ? error.message : 'unknown error').slice(0, 1000),
          finishedAt: new Date().toISOString(),
        }),
    );
    return job;
  }

  async sectionJob(id: string): Promise<AiSectionJob> {
    const row = await this.prisma.client.setting.findUnique({
      where: { key: aiSectionJobKey(id) },
    });
    const parsed = aiSectionJobSchema.safeParse(row?.value);
    if (!parsed.success)
      throw new NotFoundException(say('لا توجد مهمة بهذا المعرّف.', 'No such job.'));
    const job = parsed.data;
    if (job.status === 'RUNNING' && Date.now() - Date.parse(job.startedAt) > JOB_STALE_MS) {
      const failed: AiSectionJob = {
        ...job,
        status: 'FAILED',
        error: say(
          'توقفت المهمة قبل أن تكتمل (أُعيد تشغيل الخادم على الأغلب). أعد المحاولة.',
          'The job stopped before it finished (most likely a server restart). Try again.',
        ),
        finishedAt: new Date().toISOString(),
      };
      await this.saveSectionJob(failed);
      return failed;
    }
    return job;
  }

  async generateSection(input: GenerateSection): Promise<SectionResult> {
    const settings = await this.settings();
    const protocol = this.protocol(settings);
    const facts = await this.facts(input.productSlug);
    const stored = await this.prisma.client.productTranslation.findFirst({
      where: {
        product: { slug: input.productSlug },
        locale: input.locale === 'en' ? Locale.EN : Locale.AR,
      },
      select: { body: true },
    });
    const current = hasContent(input.current) ? JSON.stringify(input.current) : null;
    const client = this.client();
    const system = sectionSystemPrompt(input.section, settings.instructions);
    const base = sectionUserPrompt({
      section: input.section,
      locale: input.locale,
      facts,
      pageText: pageText(stored?.body ?? []),
      current,
      instructions: input.instructions,
      focusKeywords: input.focusKeywords,
    });

    let prompt = base;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const text = await client.complete({
          model: settings.model ?? '',
          protocol,
          system,
          prompt,
          maxTokens: 8000,
          temperature: settings.temperature,
        });
        const raw = extractJson(text) as Record<string, unknown>;
        // Blocks carry their type; the model is not asked to repeat it.
        const shaped =
          input.section === 'faq' || input.section === 'steps' || input.section === 'specTable'
            ? { section: input.section, block: { ...raw, type: input.section } }
            : { ...raw, section: input.section };
        const parsed = sectionResultSchema.safeParse(shaped);
        if (parsed.success) return parsed.data;
        lastError = parsed.error.issues
          .slice(0, 6)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
      } catch (error) {
        if (error instanceof OpenCodeError && error.status !== null && error.status !== 200) {
          throw this.asBadRequest(error);
        }
        lastError = error instanceof Error ? error.message : 'unreadable answer';
      }
      prompt = `${base}\n\nYour previous answer was rejected: ${lastError}. Return the corrected JSON object only.`;
    }
    throw this.asBadRequest(
      new OpenCodeError(`The model's answer did not fit the section: ${lastError}`, null),
    );
  }

  private async saveSectionJob(job: AiSectionJob): Promise<void> {
    const key = aiSectionJobKey(job.id);
    const value = job as unknown as Prisma.InputJsonValue;
    await this.prisma.client.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  private async saveJob(job: AiCopyJob): Promise<void> {
    const key = aiCopyJobKey(job.id);
    const value = job as unknown as Prisma.InputJsonValue;
    await this.prisma.client.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  private async pruneJobs(): Promise<void> {
    try {
      await this.prisma.client.setting.deleteMany({
        where: {
          OR: [
            { key: { startsWith: aiCopyJobKey('') } },
            { key: { startsWith: aiSectionJobKey('') } },
          ],
          updatedAt: { lt: new Date(Date.now() - JOB_KEEP_MS) },
        },
      });
    } catch (error) {
      this.logger.warn(
        `Pruning AI jobs failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
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
        // Room for thinking models to reason and still answer; an exhausted
        // budget is retried larger by the client (BUG-0027).
        maxTokens: 12_000,
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

/**
 * A body's blocks as plain text for a prompt, keeping each block's role
 * ("## heading", "FAQ: q — a") so the model sees the structure it is
 * rewriting. Unknown blocks are skipped.
 */
export function pageText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const strip = (html: string): string =>
    html
      .replace(/<\/(p|li|h[2-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  const out: string[] = [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    switch (b.type) {
      case 'heading':
        out.push(`## ${text(b.text)}`);
        break;
      case 'answerFirst':
        out.push(text(b.text));
        break;
      case 'richText':
        out.push(strip(text(b.html)));
        break;
      case 'steps':
        out.push(
          `Steps${b.title ? ` (${text(b.title)})` : ''}:`,
          ...((b.steps as { text?: string }[] | undefined) ?? []).map(
            (step, i) => `${String(i + 1)}. ${step.text ?? ''}`,
          ),
        );
        break;
      case 'specTable':
        out.push(
          ...((b.rows as { label?: string; value?: string }[] | undefined) ?? []).map(
            (row) => `${row.label ?? ''}: ${row.value ?? ''}`,
          ),
        );
        break;
      case 'faq':
        out.push(
          ...((b.items as { q?: string; a?: string }[] | undefined) ?? []).map(
            (item) => `FAQ: ${item.q ?? ''} — ${item.a ?? ''}`,
          ),
        );
        break;
    }
  }
  return out.filter(Boolean).join('\n\n');
}

/** Whether a section's current content has anything in it worth improving. */
function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasContent);
  if (typeof value === 'object')
    return Object.values(value as Record<string, unknown>).some(hasContent);
  return false;
}
