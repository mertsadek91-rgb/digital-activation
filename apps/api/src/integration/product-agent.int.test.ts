import { randomBytes } from 'node:crypto';

import { BadRequestException } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { DraftProduct, GeneratedCopy, GeneratedLocaleCopy } from '@da/contracts';
import { Locale, PublishStatus } from '@da/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ProductAgentService } from '../product-agent/product-agent.service.js';
import { ProductAgentWorker } from '../product-agent/product-agent.worker.js';
import { SupplierAiService } from '../supplier/ai/supplier-ai.service.js';

import { type Harness, HAS_DATABASE, bootApp } from './harness.js';

/**
 * The product agent end to end (CR-0007): a batch started through the
 * service, claimed by the worker under its lock, worked by the runner
 * through the editors' own services, and undone — against a real database.
 *
 * Only the model is replaced: the plan, the copy and the draft come back as
 * a model would answer. The card is switched off here (it needs S3, and its
 * logo search is pinned by the unit tests).
 */
describe.skipIf(!HAS_DATABASE)('product agent', () => {
  let harness: Harness;
  let agent: ProductAgentService;
  let worker: ProductAgentWorker;
  let ai: SupplierAiService;
  let actor: { staffId: string };
  const run = randomBytes(4).toString('hex');

  /** What the planning call answers with next. */
  let plan: Record<string, unknown> = {};
  /** Throws instead of writing copy, when set. */
  let copyError: Error | null = null;
  /** The worker switches as they were, put back after the suite. */
  let saved: { agent: string | undefined; cron: string | undefined } = {
    agent: undefined,
    cron: undefined,
  };

  const page = (locale: 'ar' | 'en'): GeneratedLocaleCopy => ({
    shortDesc: locale === 'ar' ? 'مفتاح أصلي يصلك فوراً' : 'A genuine key, delivered at once',
    seoTitle:
      locale === 'ar' ? `برنامج حماية ${run} – مفتاح أصلي` : `Antivirus ${run} – genuine key`,
    seoDescription:
      locale === 'ar'
        ? 'اشترِ مفتاح برنامج الحماية الأصلي واستلمه فوراً على بريدك مع دعم محلي عبر واتساب.'
        : 'Buy a genuine antivirus licence key and get it by email at once, with local WhatsApp support.',
    keywords: ['antivirus'],
    blocks: [
      {
        type: 'answerFirst',
        text:
          locale === 'ar'
            ? 'هذا مفتاح ترخيص أصلي لبرنامج الحماية يصلك فوراً بعد الدفع، مع خطوات تفعيل واضحة.'
            : 'This is a genuine licence key for the antivirus, delivered right after payment with clear activation steps.',
      },
      { type: 'heading', level: 2, text: locale === 'ar' ? 'ماذا تحصل' : 'What you get' },
      { type: 'richText', html: '<p>Written by the agent.</p>' },
    ],
  });

  async function tick(): Promise<void> {
    // Due now, whatever cooldown the last item left.
    await harness.db.agentBatch.updateMany({ data: { nextRunAt: new Date(0) } });
    await worker.tick();
  }

  beforeAll(async () => {
    harness = await bootApp();
    // The worker is driven by hand here, never by its interval.
    harness.get(SchedulerRegistry).deleteInterval('product-agent');
    agent = harness.get(ProductAgentService);
    worker = harness.get(ProductAgentWorker);
    ai = harness.get(SupplierAiService);
    saved = { agent: process.env.PRODUCT_AGENT, cron: process.env.CRON_JOBS };
    process.env.PRODUCT_AGENT = 'on';
    process.env.CRON_JOBS = 'on';

    const staff = await harness.db.staffUser.create({
      data: {
        email: `agent-${run}@example.test`,
        name: 'Agent test',
        passwordHash: 'not-a-real-hash',
        role: 'ADMIN',
      },
    });
    actor = { staffId: staff.id };

    vi.spyOn(ai, 'status').mockResolvedValue({
      model: 'test-model',
      protocol: 'auto',
      temperature: 0.5,
      instructions: '',
      configured: true,
      resolvedProtocol: 'chat',
    });
    vi.spyOn(ai, 'completeJson').mockImplementation(() => Promise.resolve(plan));
    vi.spyOn(ai, 'generateCopy').mockImplementation((): Promise<GeneratedCopy> => {
      if (copyError) return Promise.reject(copyError);
      return Promise.resolve({ model: 'test-model', ar: page('ar'), en: page('en'), notes: [] });
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    for (const [key, value] of [
      ['PRODUCT_AGENT', saved.agent],
      ['CRON_JOBS', saved.cron],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await harness.close();
  });

  const cardWords = {
    title: 'Antivirus',
    ribbon: ['سنة'],
    chips: [
      { label: 'تسليم فوري', icon: 'clock' },
      { label: 'مفتاح أصلي', icon: 'shield' },
    ],
  };
  const options = {
    copy: true,
    category: true,
    newCategories: true,
    card: 'never' as const,
    publish: true,
    instructions: '',
  };

  it('rewrites a product, creates its missing section and translation, and undoes it all', async () => {
    const product = await harness.db.product.create({
      data: {
        slug: `agent-rewrite-${run}`,
        status: PublishStatus.DRAFT,
        translations: {
          create: {
            locale: Locale.AR,
            name: `برنامج حماية ${run}`,
            seoTitle: 'old title',
            body: [{ type: 'heading', level: 2, text: 'Old body' }],
          },
        },
        variants: { create: { sku: `AGENT-RW-${run}`.toUpperCase(), priceUsd: '12.00' } },
      },
    });
    plan = {
      category: {
        action: 'create',
        categoryIds: [],
        create: {
          nameAr: `برامج الحماية ${run}`,
          nameEn: `Security ${run}`,
          slug: `security-${run}`,
          parentId: null,
        },
        reason: 'No section fits an antivirus.',
      },
      names: { ar: `برنامج حماية ${run}`, en: `Antivirus ${run}` },
      brand: { name: null, domain: null },
      card: cardWords,
    };

    const batch = await agent.start(
      { kind: 'REWRITE', ids: [product.id], options, cooldownSeconds: 120 },
      actor,
    );
    expect(batch.items[0]?.status).toBe('QUEUED');

    await tick();
    const done = await agent.batch(batch.id);
    const item = done.items[0];
    expect(item?.status).toBe('DONE');
    expect(item?.result?.category).toMatchObject({ action: 'created' });
    expect(item?.result?.copyLocales).toEqual(['ar', 'en']);
    // No picture, so the publish gate refuses, and says why.
    expect(item?.result?.published).toBe(false);
    expect(item?.result?.blockers.length).toBeGreaterThan(0);
    expect(item?.canRevert).toBe(true);
    expect(done.status).toBe('DONE');

    const after = await harness.db.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { translations: true, categories: { include: { category: true } } },
    });
    expect(after.translations.map((t) => t.locale).sort()).toEqual([Locale.AR, Locale.EN]);
    expect(after.translations.find((t) => t.locale === Locale.AR)?.seoTitle).toContain(run);
    expect(after.categories[0]?.category.slug).toBe(`security-${run}`);
    expect(after.primaryCategoryId).toBe(after.categories[0]?.categoryId);
    expect(after.status).toBe(PublishStatus.DRAFT);

    // The cooldown holds the next product back.
    const held = await harness.db.agentBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(held.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 100_000);

    const undone = await agent.revert(item?.id ?? '', actor);
    expect(undone.items[0]?.status).toBe('REVERTED');
    const restored = await harness.db.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { translations: true, categories: true },
    });
    expect(restored.translations.map((t) => t.locale)).toEqual([Locale.AR]);
    expect(restored.translations[0]?.seoTitle).toBe('old title');
    expect(restored.translations[0]?.body).toEqual([
      { type: 'heading', level: 2, text: 'Old body' },
    ]);
    expect(restored.categories).toEqual([]);
    await expect(agent.revert(item?.id ?? '', actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a product from a supplier line, links it, and skips the line next time', async () => {
    const section = await harness.db.category.create({
      data: {
        slug: `office-${run}`,
        status: PublishStatus.PUBLISHED,
        translations: { create: { locale: Locale.AR, name: `أوفيس ${run}` } },
      },
    });
    const source =
      (await harness.db.supplierSource.findFirst({ orderBy: { createdAt: 'asc' } })) ??
      (await harness.db.supplierSource.create({
        data: { name: 'Test supplier', spreadsheetId: `test-${randomBytes(12).toString('hex')}` },
      }));
    const line = await harness.db.supplierItem.create({
      data: {
        sourceId: source.id,
        nameKey: `agent office ${run}`,
        name: `Agent Office ${run} Lifetime`,
        category: 'Office',
        costUsd: '10.00',
      },
    });
    const draft: DraftProduct = {
      model: 'test-model',
      slug: `agent-office-${run}`,
      nameAr: `أوفيس ${run} مدى الحياة`,
      nameEn: `Office ${run} Lifetime`,
      kind: 'KEY',
      sku: `AGENT-OFFICE-${run}`.toUpperCase(),
      licensePeriodUnit: 'LIFETIME',
      licensePeriodValue: null,
      deviceCount: 1,
      platform: 'WINDOWS',
      activationMethod: 'RETAIL_ONLINE',
      priceUsd: '15.00',
      brandId: null,
      categoryIds: [],
      notes: [],
    };
    const drafted = vi.spyOn(ai, 'draftProduct').mockResolvedValue(draft);
    plan = {
      category: { action: 'assign', categoryIds: [section.id, 'not-a-section'], reason: 'Office.' },
      names: { ar: draft.nameAr, en: draft.nameEn },
      brand: { name: 'Microsoft', domain: 'microsoft.com' },
      card: cardWords,
    };

    const batch = await agent.start(
      { kind: 'CREATE', ids: [line.id], options, cooldownSeconds: 30 },
      actor,
    );
    await tick();
    const item = (await agent.batch(batch.id)).items[0];
    expect(item?.status).toBe('DONE');
    expect(item?.result?.created).toBe(true);
    expect(item?.productSlug).toBe(draft.slug);

    const product = await harness.db.product.findUniqueOrThrow({
      where: { slug: draft.slug },
      include: { variants: { include: { supplierLink: true } }, categories: true },
    });
    expect(product.variants[0]?.supplierLink?.itemId).toBe(line.id);
    expect(product.categories.map((c) => c.categoryId)).toEqual([section.id]);

    // The line is linked now: a second batch skips it without a model call.
    drafted.mockClear();
    const again = await agent.start(
      { kind: 'CREATE', ids: [line.id], options, cooldownSeconds: 30 },
      actor,
    );
    await tick();
    const skipped = (await agent.batch(again.id)).items[0];
    expect(skipped?.status).toBe('SKIPPED');
    expect(drafted).not.toHaveBeenCalled();
    const after = await harness.db.agentBatch.findUniqueOrThrow({ where: { id: again.id } });
    expect(after.nextRunAt.getTime()).toBeLessThan(Date.now() + 5_000);

    // Undoing a created product returns it to draft; it is not deleted.
    await agent.revert(item?.id ?? '', actor);
    const reverted = await harness.db.product.findUniqueOrThrow({ where: { slug: draft.slug } });
    expect(reverted.status).toBe(PublishStatus.DRAFT);
  });

  it('puts a rate-limited product back in the queue and holds the batch back', async () => {
    const product = await harness.db.product.create({
      data: {
        slug: `agent-limited-${run}`,
        translations: {
          create: [
            { locale: Locale.AR, name: `محدود ${run}` },
            { locale: Locale.EN, name: `Limited ${run}` },
          ],
        },
        variants: { create: { sku: `AGENT-LIM-${run}`.toUpperCase(), priceUsd: '5.00' } },
      },
    });
    plan = {
      category: { action: 'keep', categoryIds: [], reason: '' },
      names: { ar: `محدود ${run}`, en: `Limited ${run}` },
      brand: { name: null, domain: null },
      card: cardWords,
    };
    copyError = new BadRequestException('OpenCode 429 for test-model (chat): rate limit');
    try {
      const batch = await agent.start(
        {
          kind: 'REWRITE',
          ids: [product.id],
          options: { ...options, category: false },
          cooldownSeconds: 30,
        },
        actor,
      );
      await tick();
      const item = await harness.db.agentItem.findFirstOrThrow({ where: { batchId: batch.id } });
      expect(item.status).toBe('QUEUED');
      expect(item.attempts).toBe(1);
      const held = await harness.db.agentBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(held.status).toBe('RUNNING');
      expect(held.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

      // Cancelled, the queued product never starts.
      await agent.setStatus(batch.id, 'cancel', actor);
      const cancelled = await harness.db.agentItem.findFirstOrThrow({
        where: { batchId: batch.id },
      });
      expect(cancelled.status).toBe('CANCELLED');
    } finally {
      copyError = null;
    }
  });

  it('undoes to the original after a rate-limited first attempt wrote part of the product', async () => {
    const [x, y] = await Promise.all(
      ['x', 'y'].map((name) =>
        harness.db.category.create({
          data: {
            slug: `requeue-${name}-${run}`,
            status: PublishStatus.PUBLISHED,
            translations: { create: { locale: Locale.AR, name: `قسم ${name} ${run}` } },
          },
        }),
      ),
    );
    const product = await harness.db.product.create({
      data: {
        slug: `agent-requeue-${run}`,
        primaryCategoryId: x?.id ?? null,
        translations: { create: { locale: Locale.AR, name: `مُعاد ${run}`, seoTitle: 'original' } },
        categories: { create: { categoryId: x?.id ?? '' } },
        variants: { create: { sku: `AGENT-RQ-${run}`.toUpperCase(), priceUsd: '9.00' } },
      },
    });
    plan = {
      category: { action: 'assign', categoryIds: [y?.id], reason: 'Belongs in Y.' },
      names: { ar: `مُعاد ${run}`, en: `Requeued ${run}` },
      brand: { name: null, domain: null },
      card: cardWords,
    };
    const batch = await agent.start(
      {
        kind: 'REWRITE',
        ids: [product.id],
        options: { ...options, publish: false },
        cooldownSeconds: 30,
      },
      actor,
    );

    // First attempt: the section and the English translation are written,
    // then the copy call is rate limited.
    copyError = new BadRequestException('OpenCode 429 for test-model (chat): rate limit');
    await tick();
    copyError = null;
    const between = await harness.db.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { translations: true },
    });
    expect(between.primaryCategoryId).toBe(y?.id);
    expect(between.translations).toHaveLength(2);

    await tick();
    const item = (await agent.batch(batch.id)).items[0];
    expect(item?.status).toBe('DONE');

    await agent.revert(item?.id ?? '', actor);
    const restored = await harness.db.product.findUniqueOrThrow({
      where: { id: product.id },
      include: { translations: true, categories: true },
    });
    expect(restored.primaryCategoryId).toBe(x?.id);
    expect(restored.categories.map((c) => c.categoryId)).toEqual([x?.id]);
    expect(restored.translations.map((t) => t.locale)).toEqual([Locale.AR]);
    expect(restored.translations[0]?.seoTitle).toBe('original');
  });

  it('cancels, rather than requeues, a product whose batch was cancelled while it ran', async () => {
    const product = await harness.db.product.create({
      data: {
        slug: `agent-cancel-${run}`,
        translations: {
          create: [
            { locale: Locale.AR, name: `ملغى ${run}` },
            { locale: Locale.EN, name: `Cancelled ${run}` },
          ],
        },
        variants: { create: { sku: `AGENT-CN-${run}`.toUpperCase(), priceUsd: '9.00' } },
      },
    });
    plan = {
      category: { action: 'keep', categoryIds: [], reason: '' },
      names: { ar: `ملغى ${run}`, en: `Cancelled ${run}` },
      brand: { name: null, domain: null },
      card: cardWords,
    };
    const batch = await agent.start(
      {
        kind: 'REWRITE',
        ids: [product.id],
        options: { ...options, category: false },
        cooldownSeconds: 30,
      },
      actor,
    );
    vi.spyOn(ai, 'generateCopy').mockImplementationOnce(async () => {
      await agent.setStatus(batch.id, 'cancel', actor);
      throw new BadRequestException('OpenCode 429 for test-model (chat): rate limit');
    });
    await tick();
    const item = await harness.db.agentItem.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(item.status).toBe('CANCELLED');
    // And it can be retried.
    const retried = await agent.retry(item.id, actor);
    expect(retried.items[0]?.status).toBe('QUEUED');
    await agent.setStatus(batch.id, 'cancel', actor).catch(() => undefined);
  });

  it('refuses to start without a configured model, and lists what can be picked', async () => {
    vi.spyOn(ai, 'status').mockResolvedValueOnce({
      model: null,
      protocol: 'auto',
      temperature: 0.5,
      instructions: '',
      configured: true,
      resolvedProtocol: null,
    });
    await expect(
      agent.start({ kind: 'REWRITE', ids: ['x'], options, cooldownSeconds: 90 }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);

    const candidates = await agent.candidates();
    const rewritten = candidates.products.find((p) => p.slug === `agent-rewrite-${run}`);
    expect(rewritten?.lastRun?.status).toBe('REVERTED');
    expect(candidates.supplierLines.some((l) => l.name === `Agent Office ${run} Lifetime`)).toBe(
      false,
    );
  });
});
