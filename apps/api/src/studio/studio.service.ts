import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ARTICLE_LENGTH,
  type ArticleIdea,
  type EditableBlock,
  ROUTES,
  STUDIO_STATE_KEY,
  type StudioArticleResult,
  type StudioChat,
  type StudioJob,
  type StudioState,
  type StudioView,
  type WriteArticle,
  articleIntentSchema,
  editableBlockSchema,
  studioJobKey,
  studioJobSchema,
  studioStateSchema,
} from '@da/contracts';
import { ArticleKind, Locale, type Prisma, PublishStatus } from '@da/db';
import { z } from 'zod';

import { ContentArticlesService } from '../admin/content-articles.service.js';
import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SupplierAiService, slugify } from '../supplier/ai/supplier-ai.service.js';
import { nameSimilarity } from '../supplier/names.js';

import {
  type Inventory,
  articleSystemPrompt,
  articleUserPrompt,
  ideasSystemPrompt,
  ideasUserPrompt,
} from './studio-prompts.js';
import { bodyWordCount, countWords, keepKnownLinks } from './studio-text.js';

type Actor = { staffId: string };

/**
 * How long one model call may take (BUG-0028). An article of 1,500-2,000
 * words written as JSON by a thinking model runs past the client's default
 * three minutes; ideas are shorter. Jobs run in the background, so waiting
 * costs nothing but the panel's patience.
 */
const ARTICLE_TIMEOUT_MS = 9 * 60 * 1000;
const IDEAS_TIMEOUT_MS = 5 * 60 * 1000;
/**
 * Past anything a job takes — an article is up to two calls of
 * ARTICLE_TIMEOUT_MS — so a RUNNING job older than this has died.
 */
const JOB_STALE_MS = 30 * 60 * 1000;
const JOB_KEEP_MS = 24 * 60 * 60 * 1000;
/** Below this the draft is sent back once to be lengthened. */
const TOO_SHORT = ARTICLE_LENGTH.min - 100;
const MIN_LINKS = 3;

const ideaAnswerSchema = z.object({
  reply: z.string().catch(''),
  ideas: z
    .array(
      z.object({
        title: z.string().trim().min(5).max(200),
        primaryKeyword: z.string().trim().min(2).max(120),
        secondaryKeywords: z.array(z.string().trim().min(2).max(120)).max(10).catch([]),
        intent: articleIntentSchema.catch('informational'),
        rationale: z.string().trim().max(600).catch(''),
        outline: z.array(z.string().trim().min(2).max(200)).max(14).catch([]),
        relatedProductSlugs: z.array(z.string()).catch([]),
        relatedArticleSlugs: z.array(z.string()).catch([]),
      }),
    )
    .max(16),
});

const articleAnswerSchema = z.object({
  title: z.string().trim().min(5).max(200),
  slug: z.string().trim().max(120).catch(''),
  summary: z.string().trim().min(20),
  seoTitle: z.string().trim().min(10),
  seoDescription: z.string().trim().min(30),
  relatedProductSlugs: z.array(z.string()).catch([]),
  imagePrompt: z.string().trim().catch(''),
  imageAlt: z.string().trim().catch(''),
  blocks: z.array(z.unknown()).min(5),
});

/**
 * The article studio (CR-0006): ideas from the site's own inventory and a
 * conversation with the model, and full draft articles written from them.
 *
 * Nothing is published. A draft is saved through the blog editor's own
 * create and update — so its blocks, SEO fields and audit trail are exactly
 * what a hand-written post has — and the owner reviews, adds the image and
 * publishes it there.
 */
@Injectable()
export class StudioService {
  private readonly logger = new Logger(StudioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: SupplierAiService,
    private readonly articles: ContentArticlesService,
  ) {}

  // --- state ----------------------------------------------------------------

  private async state(): Promise<StudioState> {
    const row = await this.prisma.client.setting.findUnique({ where: { key: STUDIO_STATE_KEY } });
    const parsed = studioStateSchema.safeParse(row?.value ?? {});
    return parsed.success ? parsed.data : { ideas: [], thread: [] };
  }

  private async saveState(state: StudioState): Promise<void> {
    const value = state as unknown as Prisma.InputJsonValue;
    await this.prisma.client.setting.upsert({
      where: { key: STUDIO_STATE_KEY },
      update: { value },
      create: { key: STUDIO_STATE_KEY, value },
    });
  }

  async view(): Promise<StudioView> {
    const [state, products, articles, published, status] = await Promise.all([
      this.state(),
      this.prisma.client.product.count({ where: { status: PublishStatus.PUBLISHED } }),
      this.prisma.client.article.count({ where: { kind: ArticleKind.POST } }),
      this.prisma.client.article.count({
        where: { kind: ArticleKind.POST, status: PublishStatus.PUBLISHED },
      }),
      this.ai.status(),
    ]);
    return {
      ...state,
      inventory: { products, articles, publishedArticles: published },
      aiReady: status.configured && Boolean(status.model),
    };
  }

  async setIdeaStatus(id: string, status: 'NEW' | 'DISMISSED'): Promise<StudioView> {
    const state = await this.state();
    const idea = state.ideas.find((entry) => entry.id === id);
    if (!idea) throw new NotFoundException(say('لا توجد فكرة بهذا المعرّف.', 'No such idea.'));
    idea.status = status;
    await this.saveState(state);
    return this.view();
  }

  /** What the site has, in one language, for the model and for link checks. */
  async inventory(locale: 'ar' | 'en'): Promise<Inventory> {
    const wanted = locale === 'en' ? Locale.EN : Locale.AR;
    const prefix = locale === 'en' ? '/en' : '';
    const [products, articles] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { status: PublishStatus.PUBLISHED },
        orderBy: { salesCount: 'desc' },
        take: 400,
        select: {
          slug: true,
          translations: { select: { locale: true, name: true } },
          brand: { select: { name: true } },
          categories: {
            select: {
              category: { select: { translations: { select: { locale: true, name: true } } } },
            },
          },
        },
      }),
      this.prisma.client.article.findMany({
        where: { kind: ArticleKind.POST, locale: wanted },
        orderBy: { createdAt: 'desc' },
        take: 400,
        select: { slug: true, title: true, summary: true, status: true },
      }),
    ]);
    return {
      locale,
      products: products.map((product) => ({
        slug: product.slug,
        name:
          product.translations.find((t) => t.locale === wanted)?.name ??
          product.translations[0]?.name ??
          product.slug,
        brand: product.brand?.name ?? null,
        categories: product.categories
          .map(
            (link) =>
              link.category.translations.find((t) => t.locale === wanted)?.name ??
              link.category.translations[0]?.name,
          )
          .filter((name): name is string => Boolean(name)),
        path: `${prefix}${ROUTES.product(product.slug)}`,
      })),
      articles: articles.map((article) => ({
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        published: article.status === PublishStatus.PUBLISHED,
        path: `${prefix}${ROUTES.post(article.slug)}`,
      })),
    };
  }

  // --- jobs -----------------------------------------------------------------

  private async startJob(
    kind: StudioJob['kind'],
    work: () => Promise<NonNullable<StudioJob['result']>>,
  ): Promise<StudioJob> {
    const job: StudioJob = {
      id: randomUUID(),
      kind,
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
      error: null,
    };
    await this.saveJob(job);
    void this.pruneJobs();
    void work().then(
      (result) =>
        this.saveJob({ ...job, status: 'DONE', result, finishedAt: new Date().toISOString() }),
      (error: unknown) => {
        this.logger.warn(
          `Studio ${kind} job failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
        return this.saveJob({
          ...job,
          status: 'FAILED',
          error: (error instanceof Error ? error.message : 'unknown error').slice(0, 1000),
          finishedAt: new Date().toISOString(),
        });
      },
    );
    return job;
  }

  async job(id: string): Promise<StudioJob> {
    const row = await this.prisma.client.setting.findUnique({ where: { key: studioJobKey(id) } });
    const parsed = studioJobSchema.safeParse(row?.value);
    if (!parsed.success)
      throw new NotFoundException(say('لا توجد مهمة بهذا المعرّف.', 'No such job.'));
    const job = parsed.data;
    if (job.status === 'RUNNING' && Date.now() - Date.parse(job.startedAt) > JOB_STALE_MS) {
      const failed: StudioJob = {
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

  private async saveJob(job: StudioJob): Promise<void> {
    const key = studioJobKey(job.id);
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
          key: { startsWith: studioJobKey('') },
          updatedAt: { lt: new Date(Date.now() - JOB_KEEP_MS) },
        },
      });
    } catch {
      // Housekeeping only.
    }
  }

  private async requireAi(): Promise<void> {
    const status = await this.ai.status();
    if (!status.configured || !status.model) {
      throw new BadRequestException(
        say(
          'اختر نموذج الذكاء الاصطناعي في «شيت المورّد» ← «الذكاء الاصطناعي» أولاً.',
          'Choose the AI model in Supplier sheet → AI first.',
        ),
      );
    }
  }

  // --- ideas ----------------------------------------------------------------

  /**
   * One turn of the conversation: the owner's message (or none, for a fresh
   * set), the model's reply, and a new set of ideas checked against the
   * inventory. Ideas already drafted or dismissed are kept; the previous
   * untouched ones are replaced.
   */
  async chat(input: StudioChat): Promise<StudioJob> {
    await this.requireAi();
    return this.startJob('chat', async () => {
      const [state, inventory] = await Promise.all([this.state(), this.inventory(input.locale)]);
      const raw = await this.ai.completeJson(
        ideasSystemPrompt(),
        ideasUserPrompt({ inventory, thread: state.thread, message: input.message }),
        8000,
        IDEAS_TIMEOUT_MS,
      );
      const answer = ideaAnswerSchema.parse(raw);
      const productSlugs = new Set(inventory.products.map((p) => p.slug));
      const articleSlugs = new Set(inventory.articles.map((a) => a.slug));
      const existingTitles = [
        ...inventory.articles.map((a) => a.title),
        ...state.ideas.filter((i) => i.status !== 'NEW').map((i) => i.title),
      ];
      const now = new Date().toISOString();
      const fresh: ArticleIdea[] = answer.ideas
        // An idea too close to an article that exists is the duplicate the
        // prompt said not to suggest; it is dropped rather than shown.
        .filter((idea) => !existingTitles.some((title) => nameSimilarity(title, idea.title) > 0.82))
        .map((idea) => ({
          id: randomUUID(),
          title: idea.title,
          primaryKeyword: idea.primaryKeyword,
          secondaryKeywords: idea.secondaryKeywords,
          intent: idea.intent,
          rationale: idea.rationale,
          outline: idea.outline,
          relatedProductSlugs: idea.relatedProductSlugs
            .filter((s) => productSlugs.has(s))
            .slice(0, 8),
          relatedArticleSlugs: idea.relatedArticleSlugs
            .filter((s) => articleSlugs.has(s))
            .slice(0, 8),
          locale: input.locale,
          status: 'NEW',
          articleSlug: null,
          imagePrompt: null,
          createdAt: now,
        }));
      const thread = [
        ...state.thread,
        ...(input.message ? [{ role: 'user' as const, text: input.message, at: now }] : []),
        {
          role: 'assistant' as const,
          text: answer.reply || say('هذه اقتراحاتي.', 'Here are my suggestions.'),
          at: now,
        },
      ].slice(-40);
      await this.saveState({
        ideas: [...fresh, ...state.ideas.filter((idea) => idea.status !== 'NEW')].slice(0, 120),
        thread,
      });
      return { reply: thread[thread.length - 1]?.text ?? '', ideas: fresh.length };
    });
  }

  async clearThread(): Promise<StudioView> {
    const state = await this.state();
    await this.saveState({ ...state, thread: [] });
    return this.view();
  }

  // --- one article ------------------------------------------------------------

  async write(input: WriteArticle, actor: Actor): Promise<StudioJob> {
    await this.requireAi();
    const state = await this.state();
    const idea = input.ideaId ? state.ideas.find((entry) => entry.id === input.ideaId) : undefined;
    if (input.ideaId && !idea) {
      throw new NotFoundException(say('لا توجد فكرة بهذا المعرّف.', 'No such idea.'));
    }
    return this.startJob('article', () => this.writeArticle(input, idea ?? null, actor));
  }

  private async writeArticle(
    input: WriteArticle,
    idea: ArticleIdea | null,
    actor: Actor,
  ): Promise<StudioArticleResult> {
    const locale = idea?.locale ?? input.locale;
    const inventory = await this.inventory(locale);
    const settings = await this.ai.settings();
    const brief = idea ?? {
      title: input.title ?? '',
      primaryKeyword: input.primaryKeyword || input.title || '',
      secondaryKeywords: [],
      intent: 'informational' as const,
      outline: [],
      rationale: '',
    };

    // Related items first in the list, so the model reaches for them.
    const related = new Set([
      ...(idea?.relatedProductSlugs ?? []),
      ...(idea?.relatedArticleSlugs ?? []),
    ]);
    const links = [
      ...inventory.products.map((p) => ({
        slug: p.slug,
        path: p.path,
        label: `product: ${p.name}`,
      })),
      ...inventory.articles
        .filter((a) => a.published)
        .map((a) => ({ slug: a.slug, path: a.path, label: `article: ${a.title}` })),
    ].sort((a, b) => Number(related.has(b.slug)) - Number(related.has(a.slug)));
    const allowed = new Set(links.map((link) => link.path));
    const siteHosts = siteHostnames();

    const system = articleSystemPrompt(settings.instructions);
    const base = articleUserPrompt({
      inventory,
      idea: brief,
      links: links.slice(0, 160).map(({ path, label }) => ({ path, label })),
      instructions: input.instructions,
    });

    let best: ReturnType<typeof shapeArticle> | null = null;
    let prompt = base;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.ai.completeJson(system, prompt, 16_000, ARTICLE_TIMEOUT_MS);
      const parsed = articleAnswerSchema.safeParse(raw);
      if (!parsed.success) {
        prompt = `${base}\n\nYour previous answer was rejected: ${parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}. Return the full corrected JSON.`;
        continue;
      }
      const shaped = shapeArticle(parsed.data, allowed, siteHosts);
      if (!best || shaped.words > best.words) best = shaped;
      if (shaped.words >= TOO_SHORT && shaped.links.length >= MIN_LINKS) break;
      prompt = `${base}\n\nYour previous draft had ${String(shaped.words)} body words and ${String(shaped.links.length)} valid internal links. Rewrite it complete at ${String(ARTICLE_LENGTH.min + 100)}–${String(ARTICLE_LENGTH.max - 100)} body words with at least ${String(MIN_LINKS + 1)} internal links from the given paths. Return the full JSON.`;
    }
    if (!best) {
      throw new BadRequestException(
        say(
          'لم يُرجع النموذج مقالاً صالحاً. أعد المحاولة أو اختر نموذجاً آخر.',
          'The model did not return a usable article. Try again or pick another model.',
        ),
      );
    }

    // Saved through the blog editor's own create and update.
    const slug = await this.freeSlug(
      slugify(best.slug || best.title) || `article-${Date.now().toString(36)}`,
    );
    await this.articles.create({ slug, locale, title: best.title }, actor.staffId);
    await this.articles.update(
      slug,
      {
        translation: {
          locale,
          title: best.title,
          summary: best.summary.slice(0, 400),
          seoTitle: best.seoTitle.slice(0, 70),
          seoDescription: best.seoDescription.slice(0, 180),
          blocks: best.blocks,
          status: 'DRAFT',
        },
      },
      actor.staffId,
    );

    const productSlugs = [
      ...new Set([...(idea?.relatedProductSlugs ?? []), ...best.relatedProductSlugs]),
    ];
    const products = await this.prisma.client.product.findMany({
      where: { slug: { in: productSlugs } },
      select: { id: true, slug: true },
    });
    if (products.length > 0) {
      await this.prisma.client.article.updateMany({
        where: { kind: ArticleKind.POST, slug },
        data: { relatedProductIds: products.map((product) => product.id) },
      });
    }

    const notes = [...best.notes];
    if (best.words < ARTICLE_LENGTH.min) {
      notes.push(
        say(
          `المقال ${String(best.words)} كلمة، أقل من الحد المطلوب.`,
          `The article is ${String(best.words)} words, under the target.`,
        ),
      );
    }
    if (best.summaryWords > 70) {
      notes.push(
        say(
          'الملخص أطول من 50 كلمة؛ اختصره في المحرر.',
          'The summary is longer than 50 words; trim it in the editor.',
        ),
      );
    }

    if (idea) {
      const state = await this.state();
      const stored = state.ideas.find((entry) => entry.id === idea.id);
      if (stored) {
        stored.status = 'DRAFTED';
        stored.articleSlug = slug;
        stored.imagePrompt = best.imagePrompt;
        await this.saveState(state);
      }
    }
    await this.audit.record({
      actorId: actor.staffId,
      entity: 'Article',
      entityId: slug,
      action: 'studio.article_drafted',
      after: {
        slug,
        locale,
        words: best.words,
        links: best.links.length,
        ideaId: idea?.id ?? null,
      },
    });

    return {
      slug,
      title: best.title,
      locale,
      wordCount: best.words,
      summaryWords: best.summaryWords,
      internalLinks: best.links,
      relatedProducts: products.map((product) => product.slug),
      imagePrompt: best.imagePrompt,
      imageAlt: best.imageAlt,
      notes,
    };
  }

  private async freeSlug(base: string): Promise<string> {
    for (let n = 1; n < 50; n += 1) {
      const candidate = n === 1 ? base : `${base}-${String(n)}`;
      const taken = await this.prisma.client.article.count({
        where: { kind: ArticleKind.POST, slug: candidate },
      });
      if (taken === 0) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}

/** The hosts a link may name and still be this site. */
function siteHostnames(): string[] {
  const hosts = [
    'digital-activation.com',
    'www.digital-activation.com',
    'new.digital-activation.com',
  ];
  for (const value of [process.env.STOREFRONT_URL, process.env.NEXT_PUBLIC_SITE_URL]) {
    try {
      if (value) hosts.push(new URL(value).hostname);
    } catch {
      // Not a URL; nothing to add.
    }
  }
  return hosts;
}

/**
 * The model's article in our shapes: blocks that parse, links only to paths
 * that exist, the words counted.
 */
export function shapeArticle(
  answer: z.infer<typeof articleAnswerSchema>,
  allowed: ReadonlySet<string>,
  siteHosts: string[],
): {
  title: string;
  slug: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  relatedProductSlugs: string[];
  imagePrompt: string;
  imageAlt: string;
  blocks: EditableBlock[];
  links: string[];
  words: number;
  summaryWords: number;
  notes: string[];
} {
  const notes: string[] = [];
  const blocks: EditableBlock[] = [];
  const links: string[] = [];
  let dropped = 0;
  for (const raw of answer.blocks) {
    const parsed = editableBlockSchema.safeParse(raw);
    if (!parsed.success) {
      dropped += 1;
      continue;
    }
    let block = parsed.data;
    if (block.type === 'richText') {
      const checked = keepKnownLinks(block.html, allowed, siteHosts);
      links.push(...checked.kept);
      if (checked.dropped > 0) {
        notes.push(
          say(
            `أُزيل ${String(checked.dropped)} رابط لا يشير إلى صفحة موجودة.`,
            `Removed ${String(checked.dropped)} link(s) to pages that do not exist.`,
          ),
        );
      }
      block = { ...block, html: checked.html };
    }
    blocks.push(block);
  }
  if (dropped > 0) {
    notes.push(
      say(
        `أُسقطت ${String(dropped)} كتلة غير صالحة.`,
        `Dropped ${String(dropped)} malformed block(s).`,
      ),
    );
  }
  return {
    title: answer.title,
    slug: answer.slug,
    summary: answer.summary,
    seoTitle: answer.seoTitle,
    seoDescription: answer.seoDescription,
    relatedProductSlugs: answer.relatedProductSlugs,
    imagePrompt: answer.imagePrompt,
    imageAlt: answer.imageAlt,
    blocks,
    links: [...new Set(links)],
    words: bodyWordCount(blocks),
    summaryWords: countWords(answer.summary),
    notes,
  };
}
