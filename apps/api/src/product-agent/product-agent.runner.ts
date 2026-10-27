import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  type AgentItemResult,
  type AgentLogCode,
  type AgentLogEntry,
  type AgentOptions,
  type AgentPlan,
  type AgentSnapshot,
  type CardSpecInput,
  agentOptionsSchema,
  agentSnapshotSchema,
  cardSpecSchema,
  createProductSchema,
  generateCopySchema,
} from '@da/contracts';
import {
  AgentBatchKind,
  AgentBatchStatus,
  AgentItemStatus,
  Locale,
  Prisma,
  PublishStatus,
} from '@da/db';
import sharp from 'sharp';

import { AdminService } from '../admin/admin.service.js';
import { CatalogEditService } from '../admin/catalog-edit.service.js';
import { ProductContentService } from '../admin/product-content.service.js';
import { TaxonomyService } from '../admin/taxonomy.service.js';
import { runWithPanelLocale, type PanelLocale } from '../common/panel-locale.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SupplierAiService, slugify } from '../supplier/ai/supplier-ai.service.js';
import { CardService } from '../supplier/card/card.service.js';
import { SupplierService } from '../supplier/supplier.service.js';

import {
  BACKOFF_MS,
  MAX_ATTEMPTS,
  SkipItemError,
  appendLog,
  checkPlan,
  emptyResult,
  hasBody,
  isTransient,
  plainName,
} from './agent-rules.js';
import { findLogo, normaliseDomain } from './logo-finder.js';
import { type PlanCategory, planSystemPrompt, planUserPrompt } from './plan-prompts.js';

type Actor = { staffId: string; ip?: string | undefined; userAgent?: string | undefined };

/** The store's own teal, as the card designer uses for a brand without a colour. */
const FALLBACK_COLOR = '#087f70';
/** The card spec takes a logo as a data URL of at most this many characters. */
const LOGO_DATA_URL_MAX = 1_400_000;

/** One running item: its id, and the log and heartbeat it writes as it goes. */
class ItemContext {
  log: AgentLogEntry[];
  calledModel = false;

  constructor(
    private readonly prisma: PrismaService,
    readonly id: string,
    log: unknown,
  ) {
    this.log = appendLog(log, 'started', 'info');
  }

  async step(step: string): Promise<void> {
    await this.prisma.client.agentItem.update({
      where: { id: this.id },
      data: { step, heartbeatAt: new Date(), log: this.log },
    });
  }

  note(code: AgentLogCode, level: AgentLogEntry['level'], detail = ''): void {
    this.log = appendLog(this.log, code, level, detail);
  }
}

/**
 * Works one product through the agent's steps (CR-0007): for a supplier line
 * a draft and a new product linked to the line, then — for every product —
 * a snapshot of what will be replaced, one planning call, the section, the
 * Arabic and English page, the card, and publishing.
 *
 * Every write goes through the service the panel's own editors use, so
 * validation, sanitising, the publish gate and the audit log apply exactly as
 * they do to a person's edit; the actor in the audit log is the person who
 * started the batch.
 */
@Injectable()
export class ProductAgentRunner {
  private readonly logger = new Logger(ProductAgentRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: SupplierAiService,
    private readonly supplier: SupplierService,
    private readonly card: CardService,
    private readonly catalog: CatalogEditService,
    private readonly content: ProductContentService,
    private readonly admin: AdminService,
    private readonly taxonomy: TaxonomyService,
    private readonly media: MediaService,
  ) {}

  /** Runs a claimed item to its outcome and schedules the batch's next one. */
  async work(itemId: string): Promise<void> {
    const item = await this.prisma.client.agentItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });
    if (!item) return;
    const { batch } = item;
    const options = agentOptionsSchema.parse(batch.options);
    const actor: Actor = { staffId: batch.createdById };
    const ctx = new ItemContext(this.prisma, item.id, item.log);
    const locale: PanelLocale = batch.locale === 'en' ? 'en' : 'ar';
    const result = emptyResult();

    let status: AgentItemStatus = AgentItemStatus.DONE;
    let error: string | null = null;
    let wait = batch.cooldownSeconds * 1000;
    try {
      await runWithPanelLocale(locale, () =>
        this.process({ ...item, kind: batch.kind }, options, actor, ctx, result),
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'unknown error';
      if (caught instanceof SkipItemError) {
        status = AgentItemStatus.SKIPPED;
        ctx.note(caught.code, 'warn', message);
      } else if (isTransient(caught) && item.attempts < MAX_ATTEMPTS) {
        // The provider is rate limiting or overloaded: this product goes back
        // in the queue and the whole batch waits before asking again.
        status = AgentItemStatus.QUEUED;
        wait = BACKOFF_MS;
        ctx.note('rateLimited', 'warn', message);
      } else {
        status = AgentItemStatus.FAILED;
        error = message.slice(0, 2000);
        ctx.note('failed', 'error', message);
        this.logger.warn(`Product agent item ${item.id} failed: ${message}`);
      }
    }
    if (status === AgentItemStatus.SKIPPED && !ctx.calledModel) wait = 0;

    try {
      // Cancelled while this product ran: back in the queue it would never
      // run again, and could not be retried either (REV-0207).
      if (status === AgentItemStatus.QUEUED) {
        const now = await this.prisma.client.agentBatch.findUnique({
          where: { id: batch.id },
          select: { status: true },
        });
        if (now?.status === AgentBatchStatus.CANCELLED) status = AgentItemStatus.CANCELLED;
      }
      await this.prisma.client.agentItem.update({
        where: { id: item.id },
        data: {
          status,
          error,
          step: null,
          log: ctx.log,
          result: result,
          ...(result.productSlug ? { productSlug: result.productSlug } : {}),
          finishedAt: status === AgentItemStatus.QUEUED ? null : new Date(),
        },
      });
      await this.prisma.client.agentBatch.update({
        where: { id: batch.id },
        data: { nextRunAt: new Date(Date.now() + wait) },
      });
    } catch (caught) {
      // The outcome could not be saved. Leaving the item RUNNING would hold
      // every batch until it went stale; failing it lets the queue move on.
      const message = caught instanceof Error ? caught.message : 'unknown error';
      this.logger.error(`Product agent item ${item.id} outcome not saved: ${message}`);
      await this.prisma.client.agentItem
        .updateMany({
          where: { id: item.id, status: AgentItemStatus.RUNNING },
          data: {
            status: AgentItemStatus.FAILED,
            step: null,
            error: message.slice(0, 2000),
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  }

  private async process(
    item: {
      id: string;
      kind: AgentBatchKind;
      productId: string | null;
      supplierItemId: string | null;
      snapshot: unknown;
    },
    options: AgentOptions,
    actor: Actor,
    ctx: ItemContext,
    result: AgentItemResult,
  ): Promise<void> {
    let slug: string;
    let supplierCategory: string | null = null;

    // A line whose product an earlier attempt already made (it then hit a
    // rate limit, or failed and was retried) carries on with that product.
    const earlier =
      item.kind === AgentBatchKind.CREATE && item.productId
        ? await this.prisma.client.product.findUnique({
            where: { id: item.productId },
            select: { slug: true },
          })
        : null;

    if (earlier) {
      slug = earlier.slug;
      result.created = true;
      result.productSlug = slug;
      const line = await this.prisma.client.supplierItem.findUnique({
        where: { id: item.supplierItemId ?? '' },
        select: { id: true, category: true, _count: { select: { links: true } } },
      });
      supplierCategory = line?.category ?? null;
      // The earlier attempt may have stopped between creating and linking.
      const variant = await this.prisma.client.variant.findFirst({
        where: { product: { slug } },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        select: { sku: true },
      });
      if (line && line._count.links === 0 && variant) {
        await this.supplier.linkBySku(line.id, variant.sku, actor);
        ctx.note('linked', 'info', variant.sku);
      }
    } else if (item.kind === AgentBatchKind.CREATE) {
      const created = await this.createFromLine(item.id, item.supplierItemId ?? '', actor, ctx);
      slug = created.slug;
      supplierCategory = created.category;
      result.created = true;
      result.productSlug = slug;
    } else {
      const product = await this.prisma.client.product.findUnique({
        where: { id: item.productId ?? '' },
        select: { slug: true },
      });
      if (!product) throw new SkipItemError('failed', 'The product no longer exists.');
      slug = product.slug;
      result.productSlug = slug;
    }

    const product = await this.prisma.client.product.findUniqueOrThrow({
      where: { slug },
      include: {
        translations: true,
        categories: { select: { categoryId: true } },
        brand: { select: { website: true } },
        _count: { select: { media: true } },
      },
    });
    await this.prisma.client.agentItem.update({
      where: { id: item.id },
      data: { productId: product.id, productSlug: slug },
    });

    // What a rewrite replaces, saved before the first write so that even a
    // product that fails halfway can be put back. A later attempt of the same
    // item (a rate-limit requeue, a retry) keeps the first attempt's snapshot:
    // the product as it is now may already hold this item's own writes, and
    // undo must restore the original, not those (REV-0207).
    const kept = agentSnapshotSchema.safeParse(item.snapshot);
    const snapshot: AgentSnapshot = kept.success
      ? kept.data
      : {
          status: product.status,
          primaryCategoryId: product.primaryCategoryId,
          categoryIds: product.categories.map((row) => row.categoryId),
          translations: product.translations.map((t) => ({
            locale: t.locale === Locale.EN ? 'en' : 'ar',
            seoTitle: t.seoTitle,
            seoDescription: t.seoDescription,
            shortDesc: t.shortDesc,
            body: t.body ?? null,
          })),
          addedLocales: [],
          addedMediaIds: [],
        };
    const saveSnapshot = () =>
      this.prisma.client.agentItem.update({
        where: { id: item.id },
        data: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
      });
    if (!result.created && !kept.success) await saveSnapshot();

    // --- the plan -------------------------------------------------------------
    await ctx.step('plan');
    const categories = await this.categories();
    // The sections the product is in now, which is what the plan judges.
    const current = product.categories.map((row) => row.categoryId);
    const plan = await this.plan(slug, categories, current, options, supplierCategory, ctx);
    ctx.note('planned', 'info', plan.category.reason);

    // A product with a name in one language only gets the other, so both
    // pages can be written.
    for (const locale of ['ar', 'en'] as const) {
      if (product.translations.some((t) => t.locale === (locale === 'en' ? Locale.EN : Locale.AR)))
        continue;
      await this.prisma.client.productTranslation.create({
        data: {
          productId: product.id,
          locale: locale === 'en' ? Locale.EN : Locale.AR,
          name: plainName(plan.names[locale]),
        },
      });
      snapshot.addedLocales.push(locale);
      ctx.note('translationAdded', 'info', `${locale}: ${plan.names[locale]}`);
    }
    if (!result.created && snapshot.addedLocales.length > 0) await saveSnapshot();

    // --- the section ------------------------------------------------------------
    if (options.category) {
      await ctx.step('category');
      result.category = await this.applyCategory(slug, plan, categories, current, actor, ctx);
    } else {
      ctx.note('categorySkipped', 'info');
    }

    // --- the page, in both languages -------------------------------------------
    if (options.copy) {
      await ctx.step('copy');
      ctx.calledModel = true;
      const improve = !result.created && product.translations.some((t) => hasBody(t.body));
      const copy = await this.ai.generateCopy(
        generateCopySchema.parse({
          productSlug: slug,
          locales: ['ar', 'en'],
          mode: improve ? 'improve' : 'write',
          instructions: options.instructions,
        }),
      );
      for (const locale of ['ar', 'en'] as const) {
        const draft = copy[locale];
        if (!draft) continue;
        await this.content.setContent(slug, { locale, blocks: draft.blocks }, actor.staffId);
        await this.admin.setProductCopy(
          slug,
          {
            locale,
            seoTitle: draft.seoTitle,
            seoDescription: draft.seoDescription,
            shortDesc: draft.shortDesc,
          },
          actor.staffId,
          {},
        );
        result.copyLocales.push(locale);
      }
      ctx.note(
        'copyWritten',
        'info',
        `${result.copyLocales.join(' + ')} · ${copy.model}${copy.notes.length > 0 ? ` · ${copy.notes.join('; ')}` : ''}`,
      );
    } else {
      ctx.note('copySkipped', 'info');
    }

    // --- the card ---------------------------------------------------------------
    const wantsCard =
      options.card === 'always' ||
      (options.card === 'missing' && (result.created || product._count.media === 0));
    if (wantsCard) {
      result.card = await this.drawCard(
        slug,
        plan,
        product.brand?.website ?? null,
        actor,
        ctx,
        (mediaId) => {
          snapshot.addedMediaIds.push(mediaId);
          return result.created ? Promise.resolve() : saveSnapshot().then(() => undefined);
        },
      );
    } else {
      ctx.note('cardSkipped', 'info', options.card === 'never' ? 'off' : 'has images');
    }

    // --- publishing ---------------------------------------------------------------
    if (options.publish) {
      await ctx.step('publish');
      try {
        await this.admin.setStatus(slug, PublishStatus.PUBLISHED, 'ar', actor.staffId, {});
        result.published = true;
        ctx.note('published', 'info');
      } catch (caught) {
        if (!(caught instanceof BadRequestException)) throw caught;
        const response = caught.getResponse() as { blockers?: unknown };
        result.published = false;
        result.blockers = Array.isArray(response.blockers)
          ? response.blockers.filter((b): b is string => typeof b === 'string')
          : [caught.message];
        ctx.note('publishBlocked', 'warn', result.blockers.join(' · '));
      }
    }
  }

  // --- a new product from a supplier line ---------------------------------------

  private async createFromLine(
    agentItemId: string,
    itemId: string,
    actor: Actor,
    ctx: ItemContext,
  ): Promise<{ slug: string; category: string | null }> {
    const line = await this.prisma.client.supplierItem.findUnique({
      where: { id: itemId },
      include: { _count: { select: { links: true } } },
    });
    if (!line) throw new SkipItemError('failed', 'The supplier line no longer exists.');
    if (line._count.links > 0) {
      throw new SkipItemError('exists', 'A variant is already linked to this supplier line.');
    }

    await ctx.step('draft');
    ctx.calledModel = true;
    const draft = await this.ai.draftProduct(line.id);
    ctx.note('drafted', 'info', `${draft.nameEn} · ${draft.slug}`);

    // A product already called that is the same product under a link nobody
    // made: linking it is a person's call (CR-0004), not a second product.
    const twin = await this.prisma.client.productTranslation.findFirst({
      where: {
        OR: [
          { name: { equals: draft.nameEn, mode: 'insensitive' } },
          { name: { equals: draft.nameAr, mode: 'insensitive' } },
        ],
      },
      select: { product: { select: { slug: true } } },
    });
    if (twin) {
      throw new SkipItemError(
        'exists',
        `A product with this name already exists (${twin.product.slug}); link it on the supplier mapping tab.`,
      );
    }

    await ctx.step('create');
    await this.catalog.createProduct(
      createProductSchema.parse({
        slug: draft.slug,
        kind: draft.kind,
        nameAr: draft.nameAr,
        nameEn: draft.nameEn,
        ...(draft.brandId ? { brandId: draft.brandId } : {}),
        categoryIds: draft.categoryIds,
        variant: {
          sku: draft.sku,
          priceUsd: draft.priceUsd,
          licensePeriodUnit: draft.licensePeriodUnit,
          licensePeriodValue: draft.licensePeriodValue,
          deviceCount: draft.deviceCount,
          platform: draft.platform,
          activationMethod: draft.activationMethod,
        },
      }),
      actor.staffId,
    );
    // Recorded at once, so a later failure or retry carries on with this
    // product instead of finding its line linked and skipping it.
    const made = await this.prisma.client.product.findUniqueOrThrow({
      where: { slug: draft.slug },
      select: { id: true },
    });
    await this.prisma.client.agentItem.update({
      where: { id: agentItemId },
      data: { productId: made.id, productSlug: draft.slug },
    });
    ctx.note('created', 'info', draft.slug);
    for (const note of draft.notes) ctx.note('drafted', 'warn', note);

    // Linked, so the price follows the sheet and a struck line becomes
    // "notify me" — the same link the "create from line" button makes.
    await this.supplier.linkBySku(line.id, draft.sku, actor);
    ctx.note('linked', 'info', line.name);
    return { slug: draft.slug, category: line.category };
  }

  // --- the plan -------------------------------------------------------------------

  private async categories(): Promise<PlanCategory[]> {
    const rows = await this.prisma.client.category.findMany({
      orderBy: [{ parentId: 'asc' }, { position: 'asc' }],
      include: {
        translations: { select: { locale: true, name: true } },
        _count: { select: { products: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      nameAr:
        row.translations.find((t) => t.locale === Locale.AR)?.name ??
        row.translations[0]?.name ??
        row.slug,
      nameEn: row.translations.find((t) => t.locale === Locale.EN)?.name ?? null,
      parentId: row.parentId,
      products: row._count.products,
    }));
  }

  private async plan(
    slug: string,
    categories: PlanCategory[],
    current: string[],
    options: AgentOptions,
    supplierCategory: string | null,
    ctx: ItemContext,
  ): Promise<AgentPlan> {
    const facts = await this.ai.facts(slug);
    const known = new Set(categories.map((category) => category.id));
    const allowCreate = options.category && options.newCategories;
    const system = planSystemPrompt(options.instructions);
    const base = planUserPrompt({
      facts,
      currentCategoryIds: current,
      categories,
      allowCreate,
      supplierCategory,
    });
    let prompt = base;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      ctx.calledModel = true;
      const checked = checkPlan(
        await this.ai.completeJson(system, prompt, 3000),
        known,
        current,
        allowCreate,
      );
      if ('plan' in checked) return checked.plan;
      lastError = checked.error;
      prompt = `${base}\n\nYour previous answer was rejected: ${lastError}. Return the corrected JSON object only.`;
    }
    throw new Error(`The model's plan did not fit: ${lastError}`);
  }

  // --- the section ------------------------------------------------------------------

  private async applyCategory(
    slug: string,
    plan: AgentPlan,
    categories: PlanCategory[],
    current: string[],
    actor: Actor,
    ctx: ItemContext,
  ): Promise<AgentItemResult['category']> {
    const nameOf = (id: string) => categories.find((c) => c.id === id)?.nameAr ?? id;
    const { action, reason } = plan.category;

    if (action === 'keep') {
      ctx.note('categoryKept', 'info', current.map(nameOf).join('، '));
      return { action: 'kept', names: current.map(nameOf), reason };
    }

    let ids = plan.category.categoryIds;
    let createdName: string | null = null;
    if (action === 'create' && plan.category.create) {
      const wanted = plan.category.create;
      // A section already called that — made by an earlier product of this
      // batch, or one the model did not recognise — is used, not duplicated.
      const same = categories.find(
        (c) =>
          c.nameAr.trim().toLowerCase() === wanted.nameAr.trim().toLowerCase() ||
          (c.nameEn ?? '').trim().toLowerCase() === wanted.nameEn.trim().toLowerCase(),
      );
      if (same) {
        ids = [same.id, ...ids.filter((id) => id !== same.id)];
      } else {
        const base = slugify(wanted.slug || wanted.nameEn) || 'section';
        let categorySlug = base;
        for (
          let n = 2;
          await this.prisma.client.category.count({ where: { slug: categorySlug } });
          n += 1
        ) {
          categorySlug = `${base}-${String(n)}`;
        }
        await this.taxonomy.createCategory(
          {
            slug: categorySlug,
            nameAr: wanted.nameAr,
            nameEn: wanted.nameEn,
            parentId: wanted.parentId,
          },
          actor.staffId,
        );
        const made = await this.prisma.client.category.findUniqueOrThrow({
          where: { slug: categorySlug },
          select: { id: true },
        });
        ids = [made.id, ...ids];
        createdName = wanted.nameAr;
        ctx.note('categoryCreated', 'info', `${wanted.nameAr} / ${wanted.nameEn}`);
      }
    }
    ids = [...new Set(ids)].slice(0, 3);
    if (ids.length === 0) {
      ctx.note('categoryKept', 'info', current.map(nameOf).join('، '));
      return { action: 'kept', names: current.map(nameOf), reason };
    }
    await this.catalog.setIdentity(
      slug,
      { categoryIds: ids, primaryCategoryId: ids[0] },
      actor.staffId,
    );
    const names = ids.map((id) =>
      createdName && !categories.some((c) => c.id === id) ? createdName : nameOf(id),
    );
    if (!createdName) ctx.note('categoryAssigned', 'info', names.join('، '));
    return { action: createdName ? 'created' : 'assigned', names, reason };
  }

  // --- the card ---------------------------------------------------------------------

  private async drawCard(
    slug: string,
    plan: AgentPlan,
    website: string | null,
    actor: Actor,
    ctx: ItemContext,
    onAdded: (mediaId: string) => Promise<void>,
  ): Promise<AgentItemResult['card']> {
    await ctx.step('logo');
    const defaults = await this.card.defaults(slug);
    let logoSource: 'brand' | 'web' | 'none' = 'none';
    let logoUrl: string | null = null;
    let logoDataUrl: string | undefined;
    let palette: string[] = [];

    if (defaults.hasLogo) {
      logoSource = 'brand';
      palette = [defaults.spec.color];
      ctx.note('logoBrand', 'info', defaults.brandName ?? '');
    } else {
      const domain = normaliseDomain(website) ?? normaliseDomain(plan.brand.domain);
      const found = domain ? await findLogo(domain) : null;
      if (found) {
        logoDataUrl = await asDataUrl(found.png);
        if (logoDataUrl) {
          logoSource = 'web';
          logoUrl = found.sourceUrl;
          palette = found.palette;
          ctx.note('logoWeb', 'info', `${found.sourceUrl} · ${palette.join(' ')}`);
        }
      }
      if (logoSource === 'none') ctx.note('logoNone', 'warn', domain ?? '');
    }

    const spec: CardSpecInput = {
      ...defaults.spec,
      color: palette[0] ?? defaults.spec.color ?? FALLBACK_COLOR,
      useLogo: logoSource !== 'none',
      ...(logoDataUrl ? { logoDataUrl } : {}),
    };
    // The model's words when they fit the card; the product's defaults otherwise.
    const words = cardSpecSchema.safeParse({ ...spec, ...plan.card });
    const final = words.success ? words.data : spec;

    await ctx.step('card');
    const before = new Set((await this.media.list(slug)).images.map((image) => image.id));
    const images = await this.card.save(slug, { ...final, isHero: true }, actor.staffId);
    const added = images.images.find((image) => !before.has(image.id));
    if (!added) throw new Error('The card was saved but does not appear among the images.');
    await onAdded(added.id);
    ctx.note('cardSaved', 'info', final.color);
    return { logoSource, logoUrl, palette, mediaId: added.id };
  }
}

/** A found logo as the card's data URL, smaller if it does not fit the limit. */
async function asDataUrl(png: Buffer): Promise<string | undefined> {
  for (const side of [512, 384, 256]) {
    const bytes = await sharp(png)
      .resize(side, side, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const url = `data:image/png;base64,${bytes.toString('base64')}`;
    if (url.length <= LOGO_DATA_URL_MAX) return url;
  }
  return undefined;
}
