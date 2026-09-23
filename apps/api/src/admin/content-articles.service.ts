import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  AdminArticle,
  AdminArticleList,
  AdminArticleLocale,
  AdminArticleRow,
  CreateArticle,
  SetArticle,
} from '@da/contracts';
import { type Article, ArticleKind, Locale, type Prisma, PublishStatus } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

import {
  blockTypes,
  contentPath,
  mergeSeo,
  publishedAtAfter,
  readingMinutes,
  seoField,
  toEditableDocument,
  toStoredDocument,
} from './content-documents.js';
import { recordMove } from './content-redirect.js';

/**
 * The blog, for the people who write it.
 *
 * Every post so far arrived through a script — the WordPress import, then the
 * `db:blog` passes that cleaned the markup and wrote the SEO copy — so a typo
 * in a published post waited for somebody who could run one. Posts only
 * (`kind: POST`): guides, comparisons and glossary entries have a URL prefix
 * reserved in ROUTES and no storefront route behind it yet, and an editor that
 * made them would be making pages nobody can open.
 *
 * Grouped by slug like pages, and for a sharper reason: a post does not fall
 * back across locales, and its hreflang set is found by looking up the other
 * rows with the same slug. Two halves of one post with different slugs stop
 * declaring each other the moment they diverge.
 */
@Injectable()
export class ContentArticlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminArticleList> {
    const rows = await this.prisma.client.article.findMany({
      where: { kind: ArticleKind.POST },
      include: { author: { select: { name: true } } },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const groups = new Map<string, typeof rows>();
    for (const row of rows) groups.set(row.slug, [...(groups.get(row.slug) ?? []), row]);

    return {
      rows: [...groups].map(([slug, posts]): AdminArticleRow => {
        const newest = posts.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
        const lead = posts.find((post) => post.locale === Locale.AR) ?? newest;
        return {
          slug,
          path: contentPath.post(slug),
          locales: posts.map((post) => ({
            locale: post.locale === Locale.EN ? 'en' : 'ar',
            title: post.title,
            status: post.status,
            updatedAt: post.updatedAt.toISOString(),
          })),
          author: lead.author?.name ?? null,
          publishedAt: lead.publishedAt?.toISOString() ?? null,
          updatedAt: newest.updatedAt.toISOString(),
        };
      }),
    };
  }

  async get(slug: string): Promise<AdminArticle> {
    const rows = await this.load(slug);
    const authors = await this.prisma.client.author.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return {
      slug,
      path: contentPath.post(slug),
      ar: toLocale(
        'ar',
        rows.find((row) => row.locale === Locale.AR),
      ),
      en: toLocale(
        'en',
        rows.find((row) => row.locale === Locale.EN),
      ),
      authors,
    };
  }

  async create(input: CreateArticle, actorId: string | undefined): Promise<AdminArticle> {
    const taken = await this.prisma.client.article.count({
      where: { kind: ArticleKind.POST, slug: input.slug },
    });
    if (taken > 0) {
      throw new BadRequestException(
        say('توجد تدوينة بهذا الرابط.', 'A post already has that URL.'),
      );
    }

    const created = await this.prisma.client.article.create({
      data: {
        slug: input.slug,
        kind: ArticleKind.POST,
        locale: input.locale === 'en' ? Locale.EN : Locale.AR,
        title: input.title,
        status: PublishStatus.DRAFT,
        blocks: [],
        seo: {},
        editorId: actorId ?? null,
      },
    });

    await this.audit.record({
      actorId,
      action: 'article.created',
      entity: 'Article',
      entityId: created.id,
      after: { slug: input.slug, locale: input.locale, title: input.title },
    });

    return this.get(input.slug);
  }

  async update(
    slug: string,
    input: SetArticle,
    actorId: string | undefined,
  ): Promise<AdminArticle> {
    const rows = await this.load(slug);
    const nextSlug = input.slug && input.slug !== slug ? input.slug : null;

    if (nextSlug) {
      const taken = await this.prisma.client.article.count({
        where: { kind: ArticleKind.POST, slug: nextSlug },
      });
      if (taken > 0) {
        throw new BadRequestException(
          say('توجد تدوينة بهذا الرابط.', 'A post already has that URL.'),
        );
      }
    }

    const translation = input.translation;
    const locale = translation?.locale === 'en' ? Locale.EN : Locale.AR;
    const row = translation ? rows.find((entry) => entry.locale === locale) : undefined;

    let storedBlocks: unknown[] | undefined;
    if (translation?.blocks) {
      const stored = toStoredDocument(translation.blocks);
      if (!stored.ok) {
        throw new BadRequestException(
          say(
            `الكتلة رقم ${String(stored.index + 1)} (${stored.type}) غير مكتملة، ولن يعرض المتجر التدوينة بها.`,
            `Block ${String(stored.index + 1)} (${stored.type}) is incomplete; the storefront would render the post empty.`,
          ),
        );
      }
      storedBlocks = stored.blocks;
    }
    if (translation && !row && !translation.title) {
      throw new BadRequestException(
        say('أضف عنواناً لإنشاء هذه اللغة.', 'Give this language a title to create it.'),
      );
    }
    if (translation?.authorId) {
      const author = await this.prisma.client.author.count({ where: { id: translation.authorId } });
      if (author === 0) {
        throw new BadRequestException(say('الكاتب غير موجود.', 'That author does not exist.'));
      }
    }

    const before = rows.map(summarise);
    const wasPublished = rows.some((entry) => entry.status === PublishStatus.PUBLISHED);

    await this.prisma.client.$transaction(async (tx) => {
      if (nextSlug) {
        await tx.article.updateMany({
          where: { kind: ArticleKind.POST, slug },
          data: { slug: nextSlug },
        });
      }

      if (translation) {
        const status = translation.status ?? row?.status ?? PublishStatus.DRAFT;
        const data = {
          ...(translation.title === undefined ? {} : { title: translation.title }),
          // An empty excerpt is stored as null, which is what the card and the
          // meta-description fallback both test for.
          ...(translation.summary === undefined
            ? {}
            : { summary: translation.summary === '' ? null : translation.summary }),
          ...(storedBlocks === undefined
            ? {}
            : {
                blocks: storedBlocks as Prisma.InputJsonValue,
                readingMinutes: readingMinutes(storedBlocks),
              }),
          ...(translation.seoTitle === undefined && translation.seoDescription === undefined
            ? {}
            : {
                seo: mergeSeo(row?.seo, {
                  title: translation.seoTitle,
                  description: translation.seoDescription,
                }) as Prisma.InputJsonValue,
              }),
          ...(translation.authorId === undefined ? {} : { authorId: translation.authorId }),
          status,
          publishedAt: publishedAtAfter({
            current: row?.publishedAt ?? null,
            nextStatus: status,
            requested: translation.publishedAt,
            now: new Date(),
          }),
          editorId: actorId ?? null,
        };

        if (row) {
          await tx.article.update({ where: { id: row.id }, data });
        } else {
          await tx.article.create({
            data: {
              slug: nextSlug ?? slug,
              kind: ArticleKind.POST,
              locale,
              title: translation.title ?? '',
              blocks: [],
              seo: {},
              ...data,
            },
          });
        }
      }

      if (nextSlug && wasPublished) {
        await recordMove(tx, {
          from: contentPath.post(slug),
          to: contentPath.post(nextSlug),
          actorId,
        });
      }
    });

    const after = await this.load(nextSlug ?? slug);
    await this.audit.record({
      actorId,
      action: 'article.updated',
      entity: 'Article',
      entityId: (after.find((entry) => entry.locale === locale) ?? after[0])?.id ?? slug,
      before: { slug, rows: before },
      after: { slug: nextSlug ?? slug, rows: after.map(summarise) },
    });

    return this.get(nextSlug ?? slug);
  }

  private async load(slug: string): Promise<Article[]> {
    const rows = await this.prisma.client.article.findMany({
      where: { kind: ArticleKind.POST, slug },
    });
    if (rows.length === 0) {
      throw new NotFoundException(say('لا توجد تدوينة بهذا الرابط.', 'No post with that URL.'));
    }
    return rows;
  }
}

function toLocale(locale: 'ar' | 'en', row: Article | undefined): AdminArticleLocale {
  if (!row) {
    return {
      locale,
      exists: false,
      title: '',
      summary: '',
      blocks: [],
      seoTitle: '',
      seoDescription: '',
      status: 'DRAFT',
      publishedAt: null,
      authorId: null,
      readingMinutes: 0,
      updatedAt: null,
    };
  }
  return {
    locale,
    exists: true,
    title: row.title,
    summary: row.summary ?? '',
    blocks: toEditableDocument(row.blocks),
    seoTitle: seoField(row.seo, 'title'),
    seoDescription: seoField(row.seo, 'description'),
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    authorId: row.authorId,
    readingMinutes: row.readingMinutes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Short fields whole, the body as its shape — see the page service's note. */
function summarise(row: Article) {
  return {
    locale: row.locale,
    title: row.title,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    authorId: row.authorId,
    summary: row.summary,
    seoTitle: seoField(row.seo, 'title'),
    seoDescription: seoField(row.seo, 'description'),
    blocks: blockTypes(row.blocks),
  };
}
