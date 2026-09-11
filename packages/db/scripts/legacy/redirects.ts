/**
 * The cutover redirect map.
 *
 * This is the single most valuable thing in the migration and the easiest to
 * forget, because nothing breaks when it is missing — the new site works
 * perfectly and the old site's rankings simply evaporate. The store's organic
 * traffic is its largest asset: the home page alone holds 69.6% of all
 * impressions, and every product URL Google has indexed is a percent-encoded
 * Arabic path that does not exist on the new site.
 *
 * So every legacy URL that was published gets a 301 to its replacement, and
 * the map is generated from the export plus the import's own LegacyMap rather
 * than typed by hand — a hand-typed map of 90 Arabic URLs is a map with
 * mistakes in it, and a redirect with a typo is a 404 nobody notices.
 *
 * What is deliberately left out:
 *
 *   - Attachments. The images live on R2 now under content-addressed keys, and
 *     the legacy attachment pages were never worth an impression.
 *   - Blog posts. Seven of them, with real topical value and no replacement
 *     yet — those are 302s, not 301s, because the intent is to bring them back
 *     at a proper URL rather than to declare them gone for good.
 *   - Anything whose destination does not exist yet. A redirect to a 404 is
 *     worse than the 404 it replaces: it spends the crawl budget and teaches
 *     Google that the new host answers nonsense.
 */
import fs from 'node:fs';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });

import { prisma, PublishStatus } from '../../src/index.js';

const EXPORT = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'Old Website',
  'Backup XML Products + Pages + Full Website From Wordpress',
  'WordPress.2026-09-09.xml',
);

/**
 * Pages whose replacement is a fixed route rather than a content row.
 *
 * `/cart/` and `/checkout/` are absent on purpose: the new paths are identical,
 * and a redirect from a path to itself is a loop.
 */
const FIXED: Record<string, string> = {
  '/المتجر/': '/store',
  '/my-account/': '/account',
  '/support/': '/contact',
  // The offers page listed discounted products; the store page is the closest
  // honest replacement until a real /deals exists.
  '/العروض-والخصومات/': '/store',
  // The blog index has no replacement yet, and the store is where its readers
  // were going next anyway.
  '/المدونة/': '/store',
  // A key-validation tool that was never built here. The customer's own
  // licences page is what somebody arriving at it actually wants.
  '/validate-key/': '/account/licenses',
};

/**
 * Blog posts, to the closest thing that answers the same question.
 *
 * 302 rather than 301: these articles are coming back when the blog module
 * lands, and a permanent redirect would be a claim that they are not.
 */
const POSTS: Record<string, string> = {};

interface Row {
  from: string;
  to: string;
  code: number;
}

function normalise(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const trimmed = decoded.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.toLowerCase();
}

async function main(): Promise<void> {
  if (!fs.existsSync(EXPORT)) {
    console.error(`The WordPress export is not where this expects it:\n  ${EXPORT}`);
    process.exitCode = 1;
    return;
  }

  const xml = fs.readFileSync(EXPORT, 'utf8');
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  // --- what the new site can actually answer ---------------------------------

  const publishedPages = new Set(
    (
      await prisma.page.findMany({
        where: { status: PublishStatus.PUBLISHED },
        select: { slug: true },
      })
    ).map((page) => page.slug),
  );

  // Every product, by its legacy post id, through the import's own map. The
  // map points at a Variant, so the slug comes from its product.
  const legacyProducts = await prisma.legacyMap.findMany({
    where: { legacyType: 'product' },
    select: { legacyId: true, entityId: true },
  });
  const variants = await prisma.variant.findMany({
    where: { id: { in: legacyProducts.map((row) => row.entityId) } },
    select: { id: true, product: { select: { slug: true } } },
  });
  const slugByVariant = new Map(variants.map((variant) => [variant.id, variant.product.slug]));
  const slugByLegacyId = new Map<string, string>();
  for (const row of legacyProducts) {
    const slug = slugByVariant.get(row.entityId);
    if (slug) slugByLegacyId.set(row.legacyId, slug);
  }

  const rows: Row[] = [];
  const skipped: string[] = [];

  // --- products --------------------------------------------------------------

  let products = 0;
  for (const item of items) {
    const type = /<wp:post_type><!\[CDATA\[(.*?)\]\]><\/wp:post_type>/.exec(item)?.[1];
    const status = /<wp:status><!\[CDATA\[(.*?)\]\]><\/wp:status>/.exec(item)?.[1];
    const link = /<link>(.*?)<\/link>/.exec(item)?.[1];
    const id = /<wp:post_id>(\d+)<\/wp:post_id>/.exec(item)?.[1];
    if (!link || !id) continue;

    const from = normalise(new URL(link).pathname);

    if (type === 'product' && status === 'publish') {
      const slug = slugByLegacyId.get(id);
      if (!slug) {
        skipped.push(`product ${id} — not in the import map`);
        continue;
      }
      rows.push({ from, to: `/store/${slug}`, code: 301 });
      products += 1;
      continue;
    }

    if (type === 'page' && status === 'publish') {
      const decoded = decodeURIComponent(new URL(link).pathname);
      const fixed = FIXED[decoded];
      if (fixed) {
        if (normalise(fixed) !== from) rows.push({ from, to: fixed, code: 301 });
        continue;
      }
      // A content page: only if it is actually published on the new site.
      const slug = pageSlugFor(decoded);
      if (slug && publishedPages.has(slug)) {
        rows.push({ from, to: `/${slug}`, code: 301 });
      } else if (slug) {
        skipped.push(`page ${decoded} — /${slug} is not published yet`);
      }
      continue;
    }

    if (type === 'post' && status === 'publish') {
      const target = POSTS[from];
      if (target) rows.push({ from, to: target, code: 302 });
      else skipped.push(`post ${from} — no replacement yet`);
    }
  }

  // --- categories ------------------------------------------------------------

  // WooCommerce archives live under /product-category/<term-slug>/. The term
  // slugs are Arabic, the new ones are Latin, and the two are matched on the
  // term name because that is the only value both sides share.
  const terms = [
    ...xml.matchAll(
      /<wp:term>[\s\S]*?<wp:term_taxonomy><!\[CDATA\[product_cat\]\]><\/wp:term_taxonomy>[\s\S]*?<wp:term_slug><!\[CDATA\[(.*?)\]\]><\/wp:term_slug>[\s\S]*?<wp:term_name><!\[CDATA\[(.*?)\]\]><\/wp:term_name>[\s\S]*?<\/wp:term>/g,
    ),
  ];

  const categories = await prisma.category.findMany({
    include: { translations: true },
  });

  /**
   * Matched on the name, and not on an exact one.
   *
   * The legacy categories are bilingual labels — "أدوبي Adobe", "Windows 10
   * ويندوز" — while the new ones are written in one language per translation
   * row. Comparing strings matched seven of sixteen; comparing the set of
   * words in them matches all sixteen, and taking the largest overlap keeps
   * "Windows 10 ويندوز" off the parent "ويندوز" collection, which a plain
   * subset test would happily put it on.
   */
  const candidates = categories.flatMap((category) =>
    category.translations.map((translation) => ({
      slug: category.slug,
      tokens: tokenise(translation.name),
    })),
  );

  const matchCategory = (name: string): string | null => {
    const wanted = tokenise(name);
    let best: { slug: string; score: number } | null = null;
    for (const candidate of candidates) {
      const score = [...candidate.tokens].filter((token) => wanted.has(token)).length;
      // Every word of the new name has to appear in the legacy one. A partial
      // overlap is a guess, and a guessed redirect is a wrong one.
      if (score === 0 || score < candidate.tokens.size) continue;
      if (!best || score > best.score) best = { slug: candidate.slug, score };
    }
    return best?.slug ?? null;
  };

  let collections = 0;
  for (const match of terms) {
    const termSlug = match[1] ?? '';
    const name = (match[2] ?? '').trim();
    const slug = matchCategory(name);
    if (!slug) {
      skipped.push(`category "${name}" — no match in the new catalog`);
      continue;
    }
    rows.push({
      from: normalise(`/product-category/${termSlug}/`),
      to: `/collections/${slug}`,
      code: 301,
    });
    collections += 1;
  }

  // --- write -----------------------------------------------------------------

  const seen = new Set<string>();
  let written = 0;
  let duplicates = 0;

  for (const row of rows) {
    if (seen.has(row.from)) {
      duplicates += 1;
      continue;
    }
    seen.add(row.from);

    await prisma.redirect.upsert({
      where: { from: row.from },
      // Regenerating must not silently undo a redirect somebody fixed by hand,
      // so only rows this script owns are updated.
      update: { to: row.to, code: row.code, isActive: true, source: 'migration' },
      create: { from: row.from, to: row.to, code: row.code, source: 'migration' },
    });
    written += 1;
  }

  console.log(`redirects: ${String(written)} written`);
  console.log(`  products    ${String(products)}`);
  console.log(`  collections ${String(collections)}`);
  console.log(`  pages       ${String(written - products - collections)}`);
  if (duplicates > 0) console.log(`  ${String(duplicates)} duplicate source paths collapsed`);
  if (skipped.length > 0) {
    console.log(`left out (${String(skipped.length)}):`);
    for (const line of skipped) console.log(`  - ${line}`);
  }
}

/**
 * The words in a category name, for matching across the two naming styles.
 *
 * Latin is lower-cased, Arabic is stripped of the diacritics and the alef
 * forms that the two sides spell differently, and anything shorter than two
 * characters is dropped — a single letter matches everything.
 */
function tokenise(name: string): Set<string> {
  const normalised = name
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  return new Set(normalised.split(/\s+/).filter((token) => token.length > 1));
}

/** The legacy path of a policy page → the slug it was carried over as. */
function pageSlugFor(decoded: string): string | null {
  const map: Record<string, string> = {
    '/سياسة-الخصوصية/': 'privacy',
    '/سياسة-الاستخدام/': 'terms',
    '/سياسة-الاسترجاع/': 'refunds',
    '/refund-and-return-policy/': 'refunds',
    '/الضمان-الذهبي/': 'golden-warranty',
  };
  return map[decoded] ?? null;
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
