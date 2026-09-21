/**
 * Publishes the new Arabic posts.
 *
 *   pnpm db:blog-new          report only, writes nothing
 *   pnpm db:blog-new --apply  write
 *
 * Idempotent by slug: a post that already exists is updated rather than
 * duplicated, and `publishedAt` is set once and never moved — a post that
 * looks newly published every time the script runs teaches a crawler to
 * distrust the date on everything else.
 *
 * `relatedProductIds` is resolved from slugs here rather than stored as ids in
 * the data file, so a product that has been renamed or archived is reported
 * instead of silently leaving a post pointing at nothing. The live product grid
 * under each post reads those ids, which is also why no post quotes a price:
 * the grid carries today's, and an article cannot.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '..', '..', '.env'), quiet: true });

import { ArticleKind, Locale, prisma, PublishStatus } from '../../../../src/index.js';

import { NEW_POSTS_EN } from './new-posts-en.js';
import { NEW_POSTS } from './new-posts.js';

/**
 * Both languages, as separate rows sharing a slug.
 *
 * `Article` is unique on (kind, slug, locale), so the Arabic and English
 * versions of one post are two rows rather than two fields — and the sitemap
 * submits a post only in the languages it was actually written in, which is
 * why an English row has to exist before /en/blog/<slug> is anything but a
 * 404. It was, for all eleven posts, until now.
 */
const SETS = [
  { locale: Locale.AR, posts: NEW_POSTS },
  { locale: Locale.EN, posts: NEW_POSTS_EN },
] as const;

const MAX = { title: 60, description: 160 } as const;

function countWords(blocks: readonly unknown[]): number {
  const text = blocks
    .map((block) => {
      if (block === null || typeof block !== 'object') return '';
      const record = block as Record<string, unknown>;
      if (typeof record.html === 'string') return record.html;
      if (typeof record.text === 'string') return record.text;
      return JSON.stringify(record.rows ?? record.items ?? '');
    })
    .join(' ');
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1).length;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const only = process.argv.find((argument) => argument.startsWith('--locale='))?.slice(9);
  let written = 0;

  for (const { locale, posts } of SETS) {
    if (only === 'ar' && locale !== Locale.AR) continue;
    if (only === 'en' && locale !== Locale.EN) continue;

    for (const post of posts) {
      if (post.seo.title.length > MAX.title) {
        console.log(`REFUSED ${post.slug} — title ${String(post.seo.title.length)} chars`);
        process.exitCode = 1;
        continue;
      }
      if (post.seo.description.length > MAX.description) {
        console.log(
          `REFUSED ${post.slug} — description ${String(post.seo.description.length)} chars`,
        );
        process.exitCode = 1;
        continue;
      }

      const products = await prisma.product.findMany({
        where: { slug: { in: post.products }, status: PublishStatus.PUBLISHED },
        select: { id: true, slug: true },
      });
      const missing = post.products.filter((slug) => !products.some((row) => row.slug === slug));
      if (missing.length > 0) {
        // Reported, not fatal: a post about Windows 10 support is still worth
        // publishing if one of its four products has been archived.
        console.log(`   note: ${post.slug} names ${missing.join(', ')} — not published, skipped`);
      }

      const existing = await prisma.article.findFirst({
        where: { kind: ArticleKind.POST, slug: post.slug, locale },
      });

      const words = countWords(post.blocks);
      const minutes = Math.max(1, Math.round(words / 200));

      console.log(
        `${existing ? 'update' : 'create'}  ${locale === Locale.AR ? 'ar' : 'en'}  ${post.slug}`,
      );
      console.log(`   ${post.title}`);
      console.log(
        `   ${String(words)} words · ${String(minutes)} min · ${String(post.blocks.length)} blocks · ${String(products.length)} products`,
      );
      console.log(`   title: ${post.seo.title}`);
      written += 1;

      if (!apply) continue;

      const data = {
        title: post.title,
        summary: post.summary,
        blocks: post.blocks as never,
        seo: post.seo as never,
        readingMinutes: minutes,
        relatedProductIds: products.map((row) => row.id),
        status: PublishStatus.PUBLISHED,
      };

      if (existing) {
        await prisma.article.update({ where: { id: existing.id }, data });
      } else {
        await prisma.article.create({
          data: {
            ...data,
            slug: post.slug,
            kind: ArticleKind.POST,
            locale,
            // Set once, on creation. Never moved by a later run.
            publishAt: new Date(),
            publishedAt: new Date(),
          },
        });
      }
    }
  }

  console.log('');
  console.log(
    apply
      ? `published ${String(written)} posts`
      : `WOULD PUBLISH ${String(written)} posts (dry run)`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
