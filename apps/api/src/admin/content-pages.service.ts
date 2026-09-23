import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  AdminPage,
  AdminPageList,
  AdminPageLocale,
  AdminPageRow,
  CreatePage,
  SetPage,
} from '@da/contracts';
import { Locale, type Page, PageTemplate, type Prisma, PublishStatus } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

import {
  PINNED_PAGE_SLUGS,
  blockTypes,
  contentPath,
  isReservedPageSlug,
  mergeSeo,
  publishedAtAfter,
  seoField,
  toEditableDocument,
  toStoredDocument,
} from './content-documents.js';
import { recordMove } from './content-redirect.js';

/**
 * Editorial pages — the policies, the warranty, whatever is written next.
 *
 * Until this existed a page was a row that `db:legacy:pages` wrote once, and
 * the refund policy could be corrected only by a deploy. The panel edits the
 * page as the storefront sees it: one slug, served at `/<slug>` and
 * `/en/<slug>`, with an Arabic row and an English row behind it. The slug is
 * the group's; the title, body, SEO copy and status are each row's own.
 *
 * Every save of a row writes a PageVersion — the schema has carried the table
 * since day one for exactly this, and a policy page is the one document a
 * shop may later need to show exactly as it read on a given date.
 */
@Injectable()
export class ContentPagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminPageList> {
    const rows = await this.prisma.client.page.findMany({
      orderBy: [{ slug: 'asc' }, { locale: 'asc' }],
    });

    const groups = new Map<string, Page[]>();
    for (const row of rows) groups.set(row.slug, [...(groups.get(row.slug) ?? []), row]);

    return {
      rows: [...groups].map(([slug, pages]): AdminPageRow => {
        const newest = pages.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
        return {
          slug,
          path: contentPath.page(slug),
          template: (pages.find((page) => page.locale === Locale.AR) ?? newest).template,
          locales: pages.map((page) => ({
            locale: page.locale === Locale.EN ? 'en' : 'ar',
            title: page.title,
            status: page.status,
            updatedAt: page.updatedAt.toISOString(),
          })),
          updatedAt: newest.updatedAt.toISOString(),
        };
      }),
    };
  }

  async get(slug: string): Promise<AdminPage> {
    const rows = await this.load(slug);
    const ar = rows.find((row) => row.locale === Locale.AR);
    const en = rows.find((row) => row.locale === Locale.EN);
    return {
      slug,
      path: contentPath.page(slug),
      template: (ar ?? en ?? rows[0])?.template ?? PageTemplate.GENERIC,
      slugLocked: PINNED_PAGE_SLUGS.includes(slug),
      ar: toLocale('ar', ar),
      en: toLocale('en', en),
    };
  }

  async create(input: CreatePage, actorId: string | undefined): Promise<AdminPage> {
    this.assertSlugUsable(input.slug);
    const taken = await this.prisma.client.page.count({ where: { slug: input.slug } });
    if (taken > 0) {
      throw new BadRequestException(say('توجد صفحة بهذا الرابط.', 'A page already has that URL.'));
    }

    const created = await this.prisma.client.page.create({
      data: {
        slug: input.slug,
        locale: input.locale === 'en' ? Locale.EN : Locale.AR,
        title: input.title,
        template: input.template,
        // A draft, always: a page is created empty, and a published empty page
        // is a 200 with nothing on it that a crawler will happily index.
        status: PublishStatus.DRAFT,
        blocks: [],
        seo: {},
      },
    });

    await this.audit.record({
      actorId,
      action: 'page.created',
      entity: 'Page',
      entityId: created.id,
      after: {
        slug: input.slug,
        locale: input.locale,
        title: input.title,
        template: input.template,
      },
    });

    return this.get(input.slug);
  }

  async update(slug: string, input: SetPage, actorId: string | undefined): Promise<AdminPage> {
    const rows = await this.load(slug);
    const nextSlug = input.slug && input.slug !== slug ? input.slug : null;

    if (nextSlug) {
      if (PINNED_PAGE_SLUGS.includes(slug)) {
        throw new BadRequestException(
          say(
            'رابط هذه الصفحة ثابت: صفحة مخصّصة في المتجر تقرؤها بهذا الاسم.',
            'This page’s URL is fixed: a dedicated storefront route reads it by name.',
          ),
        );
      }
      this.assertSlugUsable(nextSlug);
      const taken = await this.prisma.client.page.count({ where: { slug: nextSlug } });
      if (taken > 0) {
        throw new BadRequestException(
          say('توجد صفحة بهذا الرابط.', 'A page already has that URL.'),
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
            `الكتلة رقم ${String(stored.index + 1)} (${stored.type}) غير مكتملة، ولن يعرض المتجر الصفحة بها.`,
            `Block ${String(stored.index + 1)} (${stored.type}) is incomplete; the storefront would render the page empty.`,
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

    const before = rows.map(summarise);
    const wasPublished = rows.some((entry) => entry.status === PublishStatus.PUBLISHED);
    const now = new Date();

    await this.prisma.client.$transaction(async (tx) => {
      if (nextSlug || input.template) {
        await tx.page.updateMany({
          where: { slug },
          data: {
            ...(nextSlug ? { slug: nextSlug } : {}),
            ...(input.template ? { template: input.template } : {}),
          },
        });
      }

      if (translation) {
        const status = translation.status ?? row?.status ?? PublishStatus.DRAFT;
        const data = {
          ...(translation.title === undefined ? {} : { title: translation.title }),
          ...(storedBlocks === undefined ? {} : { blocks: storedBlocks as Prisma.InputJsonValue }),
          ...(translation.seoTitle === undefined && translation.seoDescription === undefined
            ? {}
            : {
                seo: mergeSeo(row?.seo, {
                  title: translation.seoTitle,
                  description: translation.seoDescription,
                }) as Prisma.InputJsonValue,
              }),
          status,
          publishedAt: publishedAtAfter({
            current: row?.publishedAt ?? null,
            nextStatus: status,
            now,
          }),
        };

        const saved = row
          ? await tx.page.update({
              where: { id: row.id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.page.create({
              data: {
                slug: nextSlug ?? slug,
                locale,
                template: input.template ?? rows[0]?.template ?? PageTemplate.GENERIC,
                title: translation.title ?? '',
                blocks: [],
                seo: {},
                ...data,
              },
            });

        /*
         * The snapshot, and the one before it.
         *
         * Every page here predates the panel, so its first save has no version
         * row behind it. Without the pre-edit snapshot the first thing the
         * history could show is the page *after* somebody changed it, which is
         * the one state a rollback never needs.
         */
        if (row) {
          const history = await tx.pageVersion.count({ where: { pageId: row.id } });
          if (history === 0) {
            await tx.pageVersion.create({
              data: {
                pageId: row.id,
                version: row.version,
                title: row.title,
                blocks: row.blocks as Prisma.InputJsonValue,
                seo: row.seo as Prisma.InputJsonValue,
              },
            });
          }
        }
        await tx.pageVersion.create({
          data: {
            pageId: saved.id,
            version: saved.version,
            title: saved.title,
            blocks: saved.blocks as Prisma.InputJsonValue,
            seo: saved.seo as Prisma.InputJsonValue,
            createdById: actorId ?? null,
          },
        });
      }

      // Only a page somebody could have reached has an old address worth
      // keeping. A draft renamed twice before launch leaves nothing behind.
      if (nextSlug && wasPublished) {
        await recordMove(tx, {
          from: contentPath.page(slug),
          to: contentPath.page(nextSlug),
          actorId,
        });
      }
    });

    const after = await this.load(nextSlug ?? slug);
    await this.audit.record({
      actorId,
      action: 'page.updated',
      entity: 'Page',
      entityId: (after.find((entry) => entry.locale === locale) ?? after[0])?.id ?? slug,
      before: { slug, rows: before },
      after: { slug: nextSlug ?? slug, rows: after.map(summarise) },
    });

    return this.get(nextSlug ?? slug);
  }

  private async load(slug: string): Promise<Page[]> {
    const rows = await this.prisma.client.page.findMany({ where: { slug } });
    if (rows.length === 0) {
      throw new NotFoundException(say('لا توجد صفحة بهذا الرابط.', 'No page with that URL.'));
    }
    return rows;
  }

  private assertSlugUsable(slug: string): void {
    if (isReservedPageSlug(slug)) {
      throw new BadRequestException(
        say(
          'هذا الرابط محجوز لقسم آخر من المتجر، ولن تُعرض الصفحة عليه.',
          'That URL belongs to another part of the store; a page there would never be shown.',
        ),
      );
    }
  }
}

function toLocale(locale: 'ar' | 'en', row: Page | undefined): AdminPageLocale {
  if (!row) {
    return {
      locale,
      exists: false,
      title: '',
      blocks: [],
      seoTitle: '',
      seoDescription: '',
      status: 'DRAFT',
      publishedAt: null,
      version: 0,
      updatedAt: null,
    };
  }
  return {
    locale,
    exists: true,
    title: row.title,
    blocks: toEditableDocument(row.blocks),
    seoTitle: seoField(row.seo, 'title'),
    seoDescription: seoField(row.seo, 'description'),
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A row, as the audit log keeps it.
 *
 * Titles, status and SEO copy in full — they are short and they are what gets
 * asked about ("who changed the meta description?") — and the body as its
 * shape only. The versions table already holds every body; a second copy in
 * the append-only log is a log nobody can read.
 */
function summarise(row: Page) {
  return {
    locale: row.locale,
    title: row.title,
    status: row.status,
    version: row.version,
    seoTitle: seoField(row.seo, 'title'),
    seoDescription: seoField(row.seo, 'description'),
    blocks: blockTypes(row.blocks),
  };
}
