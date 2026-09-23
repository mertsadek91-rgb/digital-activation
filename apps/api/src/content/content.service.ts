import { Injectable, NotFoundException } from '@nestjs/common';

import {
  type Article,
  BLOG_MORE_SIZE,
  type BlogIndex,
  type ContentPage,
  blockDocumentSchema,
} from '@da/contracts';
import { ArticleKind, Locale, type Prisma, PublishStatus } from '@da/db';

import { toArticleCard } from '../common/article-card.js';
import { sanitizeBlocks } from '../common/rich-text.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Editorial pages.
 *
 * A page exists per locale, and the fallback is deliberate: an Arabic visitor
 * asking for a page that has only been written in English gets the English one
 * rather than a 404. A missing translation is a content gap, and answering a
 * real question in the wrong language beats answering nothing — the header
 * links to these pages in both languages whether or not both have been written.
 */
@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async page(slug: string, locale: string, preview?: string): Promise<ContentPage> {
    const wanted = locale === 'en' ? Locale.EN : Locale.AR;
    const token = process.env.PREVIEW_TOKEN;
    const allowDrafts = Boolean(token && preview && preview === token);

    const rows = await this.prisma.client.page.findMany({
      where: {
        slug,
        ...(allowDrafts ? {} : { status: PublishStatus.PUBLISHED }),
      },
    });
    if (rows.length === 0) throw new NotFoundException(`No page with slug "${slug}"`);

    const page = rows.find((row) => row.locale === wanted) ?? rows[0];
    if (!page) throw new NotFoundException(`No page with slug "${slug}"`);

    return {
      slug: page.slug,
      locale: page.locale === Locale.EN ? 'en' : 'ar',
      title: page.title,
      blocks: parseBlocks(page.blocks),
      seo: parseSeo(page.seo),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /**
   * Where a legacy URL goes now, if anywhere.
   *
   * Looked up per request rather than shipped as a map, because the storefront
   * only asks after every real route has declined the path — which is to say,
   * on what would otherwise be a 404. That makes this the cheapest possible
   * place to count the hit, and the count is the only way to answer the
   * question worth asking after a cutover: which old URLs are still being
   * followed, and by whom.
   */
  async redirectFor(pathname: string): Promise<{ to: string; code: number } | null> {
    const from = normalisePath(pathname);
    if (!from) return null;

    const row = await this.prisma.client.redirect.findUnique({ where: { from } });
    if (!row || !row.isActive) return null;

    // Counted after the lookup and never awaited into the answer: a redirect
    // that waited on its own bookkeeping would be slower than the page it
    // replaces.
    void this.prisma.client.redirect
      .update({
        where: { id: row.id },
        data: { hits: { increment: 1 }, lastHitAt: new Date() },
      })
      .catch(() => undefined);

    return { to: row.to, code: row.code };
  }

  /**
   * Records a path that answered 404.
   *
   * The table's whole value is the legacy URLs the generated map could not
   * predict — the ones linked from somewhere the export knows nothing about,
   * an old forum post or a printed invoice. Every row is either a redirect
   * waiting to be written or a crawler to ignore.
   *
   * Two guards, because this is a write on an anonymous request: paths that
   * are obviously automated probing are dropped rather than stored, and the
   * row is keyed on the path so a thousand hits are one row. Without the
   * first, the table fills with `/wp-login.php` within a day of going live and
   * the real signal is buried.
   */
  async recordNotFound(input: {
    path: string;
    referer?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void> {
    const path = normalisePath(input.path);
    if (!path || path === '/' || path.length > 500) return;
    if (PROBES.some((pattern) => pattern.test(path))) return;

    await this.prisma.client.notFoundLog.upsert({
      where: { path },
      update: {
        hits: { increment: 1 },
        lastSeenAt: new Date(),
        // A path that comes back after being marked resolved is not resolved.
        resolvedAt: null,
        referer: input.referer ?? undefined,
      },
      create: {
        path,
        referer: input.referer ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  // --- the blog -------------------------------------------------------------

  /**
   * Every published post, newest first.
   *
   * No pagination. There are seven, and a paginated index over seven rows is a
   * second page that exists only to be crawled and found empty. It gains one
   * the day the blog needs one.
   *
   * Unlike an editorial page there is no cross-locale fallback: the imported
   * posts are Arabic, and serving Arabic prose under an English URL would
   * declare a translation that does not exist. The English index is honestly
   * empty until something is written for it.
   */
  async articles(locale: string, preview?: string): Promise<BlogIndex> {
    const wanted = locale === 'en' ? Locale.EN : Locale.AR;
    const where = {
      kind: ArticleKind.POST,
      locale: wanted,
      ...(this.allowDrafts(preview) ? {} : { status: PublishStatus.PUBLISHED }),
    };

    const rows = await this.prisma.client.article.findMany({
      where,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      // A ceiling on a public, uncached-at-origin read. The blog is a few
      // dozen posts; this only matters the day it is not.
      take: 500,
    });

    return { posts: rows.map(toArticleCard), total: rows.length };
  }

  async article(slug: string, locale: string, preview?: string): Promise<Article> {
    const wanted = locale === 'en' ? Locale.EN : Locale.AR;
    const allowDrafts = this.allowDrafts(preview);

    const post = await this.prisma.client.article.findFirst({
      where: {
        slug,
        kind: ArticleKind.POST,
        locale: wanted,
        ...(allowDrafts ? {} : { status: PublishStatus.PUBLISHED }),
      },
    });
    if (!post) throw new NotFoundException(`No post with slug "${slug}"`);

    // Newest others, never this one. Published only even in preview: a draft
    // suggested under a finished post is a link to something unfinished.
    const more = await this.prisma.client.article.findMany({
      where: {
        kind: ArticleKind.POST,
        locale: wanted,
        status: PublishStatus.PUBLISHED,
        slug: { not: slug },
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: BLOG_MORE_SIZE,
    });

    // Which languages this post exists in, for the page's hreflang set. Drafts
    // are excluded even in preview: declaring an alternate that answers 404 to
    // everyone but the editor is worse than declaring none.
    const written = await this.prisma.client.article.findMany({
      where: { slug, kind: ArticleKind.POST, status: PublishStatus.PUBLISHED },
      select: { locale: true },
    });
    const locales = written.map((row) => (row.locale === Locale.EN ? 'en' : 'ar'));

    return {
      ...toArticleCard(post),
      blocks: parseBlocks(post.blocks),
      seo: parseSeo(post.seo),
      updatedAt: post.updatedAt.toISOString(),
      isDraft: post.status !== PublishStatus.PUBLISHED,
      more: more.map(toArticleCard),
      // A draft being previewed is not published, so it is not in the list
      // above — but the page still needs a locale to declare.
      locales: locales.length > 0 ? locales : [wanted === Locale.EN ? 'en' : 'ar'],
    };
  }

  /**
   * The products one post is linked to, in the order the linker chose.
   *
   * Ids rather than cards: the cards are the catalog's to build, and this
   * module has no business formatting a price.
   */
  async relatedProductIds(slug: string, locale: string, preview?: string): Promise<string[]> {
    const wanted = locale === 'en' ? Locale.EN : Locale.AR;
    const post = await this.prisma.client.article.findFirst({
      where: {
        slug,
        kind: ArticleKind.POST,
        locale: wanted,
        ...(this.allowDrafts(preview) ? {} : { status: PublishStatus.PUBLISHED }),
      },
      select: { relatedProductIds: true },
    });
    return post?.relatedProductIds ?? [];
  }

  /**
   * Published post slugs with their lastmod and, unlike the page equivalent,
   * the languages each one exists in.
   *
   * A page falls back across locales, so every page URL renders in both and a
   * blanket pair of hreflang alternates is true for it. A post does not — the
   * imported ones are Arabic and `/en/blog/<slug>` answers 404 — so the sitemap
   * has to be told which alternates are real rather than assuming two.
   */
  async publishedPostSlugs(): Promise<
    { slug: string; updatedAt: Date; locales: ('ar' | 'en')[] }[]
  > {
    const rows = await this.prisma.client.article.findMany({
      where: { kind: ArticleKind.POST, status: PublishStatus.PUBLISHED },
      orderBy: { slug: 'asc' },
      select: { slug: true, updatedAt: true, locale: true },
    });

    const seen = new Map<string, { updatedAt: Date; locales: Set<'ar' | 'en'> }>();
    for (const row of rows) {
      const entry = seen.get(row.slug) ?? { updatedAt: row.updatedAt, locales: new Set() };
      if (row.updatedAt > entry.updatedAt) entry.updatedAt = row.updatedAt;
      entry.locales.add(row.locale === Locale.EN ? 'en' : 'ar');
      seen.set(row.slug, entry);
    }
    return [...seen].map(([slug, entry]) => ({
      slug,
      updatedAt: entry.updatedAt,
      // Arabic first, so `x-default` and the reading order agree.
      locales: (['ar', 'en'] as const).filter((locale) => entry.locales.has(locale)),
    }));
  }

  /**
   * Drafts are visible only to somebody holding the preview token, and only
   * when one is configured. An unset `PREVIEW_TOKEN` must not mean "everybody":
   * `undefined === undefined` would open the whole unpublished catalog.
   */
  private allowDrafts(preview?: string): boolean {
    const token = process.env.PREVIEW_TOKEN;
    return Boolean(token && preview && preview === token);
  }

  /** Published slugs, for the sitemap and for prerendering. */
  async publishedSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    const rows = await this.prisma.client.page.findMany({
      where: { status: PublishStatus.PUBLISHED },
      orderBy: { slug: 'asc' },
      select: { slug: true, updatedAt: true },
    });

    // One entry per slug: the Arabic and English rows are the same URL with
    // different hreflang, not two pages.
    const seen = new Map<string, Date>();
    for (const row of rows) {
      const current = seen.get(row.slug);
      if (!current || row.updatedAt > current) seen.set(row.slug, row.updatedAt);
    }
    return [...seen].map(([slug, updatedAt]) => ({ slug, updatedAt }));
  }
}

/**
 * Paths that are somebody scanning, not somebody who followed a link.
 *
 * None of these ever existed on the legacy WordPress store as a page worth
 * redirecting, and every one of them arrives by the thousand from bots looking
 * for an unpatched install. They are dropped before the write so the 404 list
 * stays readable by a person.
 */
const PROBES = [
  /^\/wp-(login|admin|content|includes|json)/,
  /^\/(xmlrpc|wp-config|\.env|\.git)/,
  /^\/(vendor|phpunit|phpmyadmin|admin\.php|shell|cgi-bin)/,
  /\.(php|asp|aspx|jsp|cgi|sql|bak|old|zip|tar|gz)$/,
  // A missing asset is a build problem, not a redirect somebody should write.
  // The three Tajawal faces filled ten rows each within an hour of this log
  // existing, which is how the missing `public/fonts` directory was found —
  // useful once, noise every time after.
  /\.(woff2?|ttf|otf|eot|css|m?js|map|png|jpe?g|gif|svg|webp|avif|ico|txt|xml|pdf)$/,
];

/**
 * The shape the map is keyed by: decoded, lower-cased, no trailing slash.
 *
 * Both sides have to agree exactly or nothing matches, and the two sides are a
 * generator reading a WordPress export and a browser sending a percent-encoded
 * Arabic path. The normalisation lives here so there is one definition of it.
 */
function normalisePath(pathname: string): string | null {
  if (!pathname.startsWith('/')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A malformed percent-escape is a crawler probing, not a customer.
    return null;
  }
  const trimmed = decoded.replace(/\/+$/, '');
  return (trimmed === '' ? '/' : trimmed).toLowerCase();
}

/**
 * Prisma's Json columns are `unknown` at the type level; parse, do not cast.
 *
 * Sanitised on the way out for the same reason the catalog's bodies are: the
 * pages were imported from WordPress too, and `blocks.tsx` renders a richText
 * block as markup rather than as text.
 */
function parseBlocks(value: Prisma.JsonValue): ContentPage['blocks'] {
  const parsed = blockDocumentSchema.safeParse(value ?? []);
  return parsed.success ? sanitizeBlocks(parsed.data) : [];
}

function parseSeo(value: Prisma.JsonValue): ContentPage['seo'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { title: null, description: null };
  }
  const record = value as Record<string, unknown>;
  return {
    title: typeof record.title === 'string' ? record.title : null,
    description: typeof record.description === 'string' ? record.description : null,
  };
}
