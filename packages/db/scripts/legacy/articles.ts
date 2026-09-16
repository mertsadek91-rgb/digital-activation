/**
 * The blog, brought across.
 *
 * Seven posts, and they were left out of the first migration on purpose: the
 * redirect generator skipped them because there was nowhere for them to land.
 * There is now — `Article` has been in the schema since it was written, and
 * `/blog` has been a reserved route just as long.
 *
 * They are worth carrying. Four of the seven are the store's only non-product
 * pages that answer a question somebody types into a search engine rather than
 * a shopping query — "اختصارات Excel", "ويندوز 10 مقابل ويندوز 11" — and on a
 * migration whose whole risk is losing organic traffic, throwing away the only
 * editorial content on the site would be the one avoidable loss.
 *
 * ## The excerpt bug
 *
 * Three of the seven carry a `<style>` block, and those same three are the
 * three WordPress gives an empty excerpt. So WordPress derives the excerpt by
 * stripping tags from the body — which removes `<style>` and `</style>` and
 * leaves the CSS *between* them as text. That is why the live site prints
 *
 *     da-article { font-family: 'Tajawal', 'Cairo'... direction: rtl; tex
 *
 * under three of its article cards.
 *
 * Stripping tags is not reading text. This script drops the whole subtree of
 * every element whose content is not prose before it takes a summary, which is
 * the same rule `sanitizeRichText` applies at render time in the API — stated
 * twice because they run in different processes on different data, and the one
 * that matters here runs once at import.
 */
import crypto from 'node:crypto';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';
import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });

import { ArticleKind, Locale, prisma, PublishStatus } from '../../src/index.js';

const XML_PATH = path.join(
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
 * Readable slugs, chosen rather than transliterated.
 *
 * Five of the seven legacy URLs are percent-encoded Arabic, which is a valid
 * URL and an unreadable one — it is forty characters of `%d9%88` in every
 * share, every analytics row and every backlink. So they are renamed, and the
 * legacy path gets a redirect rather than being kept.
 *
 * Keyed by the legacy slug *decoded*, so this table is checkable by reading it.
 * The encoded form is what the export carries, and a map keyed by `%d8%aa%d8`
 * would be a map nobody could review.
 *
 * The two that were already Latin keep their slug exactly. Those are the URLs
 * most likely to have been linked to as text, and renaming them would spend a
 * redirect to gain nothing.
 */
const SLUGS: Record<string, string> = {
  'office-365-vs-office-2021': 'office-365-vs-office-2021',
  'كيفية-الحصول-على-نسخ-أصلية-من-ويندوز-10-و-11': 'genuine-windows-10-11-keys',
  'خطوات-تفعيل-اشتراك-microsoft-office-365-على-أجهزة-متعدد':
    'activate-office-365-on-multiple-devices',
  'تعلم-اختصارات-excel-أفضل-الاختصارات-والتع': 'excel-keyboard-shortcuts',
  'تعلم-اختصارات-word-أفضل-الاختصارات-والتع': 'word-keyboard-shortcuts',
  'ويندوز-10-مقابل-ويندوز-11-ما-الذي-يجب-أن-تخت': 'windows-10-vs-windows-11',
  // No year in the slug. The title carries "(2026)" because the figures in it
  // are from 2026; the article will be refreshed and the URL should survive it.
  'eset-مقابل-norton-مقابل-mcafee-مقارنة-برامج-الحماية-م': 'eset-vs-norton-vs-mcafee',
};

/**
 * The chosen slug, or a guess if this export ever grows a post the table above
 * has not been told about.
 *
 * The guess is deliberately poor company for the table: left to itself it
 * turned "تعلم اختصارات Excel" into `excel` and "ويندوز 10 مقابل ويندوز 11 في
 * 2026" into `10-11-2026`, which reads as a date. It exists so an unknown post
 * still imports and still gets a redirect, and the dry run prints which posts
 * fell through to it so they can be named properly before `--apply`.
 */
function slugFor(
  legacySlug: string,
  title: string,
  index: number,
): { slug: string; chosen: boolean } {
  const mapped = SLUGS[decodeSlug(legacySlug)];
  if (mapped) return { slug: mapped, chosen: true };

  // The Latin words in an Arabic title are the product names — "Excel",
  // "Office 365", "ESET", "Norton" — which is the best a guess can do here.
  const latin = title
    .replace(/[^ -~]+/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (latin.length >= 4) return { slug: latin.slice(0, 60).replace(/-+$/, ''), chosen: false };
  return { slug: `article-${String(index + 1)}`, chosen: false };
}

/** Percent-decoding that survives a slug the exporter left unencoded. */
function decodeSlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A redirect's `from`, in the one shape the lookup will match.
 *
 * Decoded, trailing slash removed, lower-cased — character for character what
 * `normalisePath` in the API does to an incoming request before it queries this
 * column, and what the cutover map's own generator already stores. The schema
 * comment above the column says the opposite ("stored exactly as Google has
 * them indexed"); the code is what decides, and both writers and the reader
 * decode. Stored encoded, these seven rows would have been written, counted as
 * a success, and matched nothing.
 */
function redirectFrom(url: string): string {
  const decoded = decodeSlug(new URL(url).pathname);
  const trimmed = decoded.replace(/\/+$/, '');
  return (trimmed === '' ? '/' : trimmed).toLowerCase();
}

/** Elements whose text is not prose, and whose subtree goes with them. */
const NOT_PROSE = ['script', 'style', 'noscript', 'template', 'svg', 'xmp', 'plaintext'];

/**
 * The readable text of a fragment of HTML.
 *
 * Removes non-prose subtrees *before* removing tags, which is the whole
 * difference between this and what produced the CSS on the live site.
 */
export function readableText(html: string): string {
  let out = html;
  for (const tag of NOT_PROSE) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ');
    out = out.replace(new RegExp(`<\\s*/?${tag}\\b[^>]*>`, 'gi'), ' ');
  }
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  out = out.replace(/<[^>]+>/g, ' ');

  return out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A summary that stops at a sentence rather than mid-word. */
export function summarise(text: string, max = 180): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('، '), cut.lastIndexOf(' '));
  return `${cut.slice(0, stop > 60 ? stop : max).trim()}…`;
}

/**
 * Arabic reads slower per word than English and this is Arabic prose, so the
 * divisor is deliberately lower than the 220 wpm usually quoted for English.
 */
function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 160));
}

interface LegacyPost {
  legacySlug: string;
  legacyUrl: string;
  title: string;
  content: string;
  excerpt: string;
  date: string;
}

function parse(): LegacyPost[] {
  if (!fs.existsSync(XML_PATH)) throw new Error(`WordPress export not found at ${XML_PATH}`);

  const parser = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: '__cdata',
    trimValues: false,
    parseTagValue: false,
  });
  const doc = parser.parse(fs.readFileSync(XML_PATH, 'utf8')) as Record<string, unknown>;
  const channel = (doc.rss as Record<string, unknown>).channel as Record<string, unknown>;
  const items = channel.item as Record<string, unknown>[];

  const text = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (value !== null && typeof value === 'object' && '__cdata' in value) {
      const inner: unknown = (value as Record<string, unknown>).__cdata;
      if (typeof inner === 'string') return inner;
    }
    return '';
  };

  return items
    .filter((item) => text(item['wp:post_type']) === 'post')
    .filter((item) => text(item['wp:status']) === 'publish')
    .map((item) => ({
      legacySlug: text(item['wp:post_name']),
      legacyUrl: text(item.link),
      title: text(item.title).trim(),
      content: text(item['content:encoded']),
      excerpt: text(item['excerpt:encoded']).trim(),
      date: text(item['wp:post_date']),
    }));
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const posts = parse();

  console.log(`${String(posts.length)} published posts in the export.\n`);

  for (const [index, post] of posts.entries()) {
    const { slug, chosen } = slugFor(post.legacySlug, post.title, index);
    const body = readableText(post.content);

    // The excerpt WordPress kept, when it kept one. Its own derivation is what
    // leaked the CSS, so an empty one is re-derived here rather than trusted.
    const summary = post.excerpt.length > 0 ? readableText(post.excerpt) : summarise(body);
    const minutes = readingMinutes(body);

    const legacyPath = redirectFrom(post.legacyUrl);

    console.log(`  /blog/${slug}`);
    console.log(`    ${post.title}`);
    console.log(
      `    ${String(minutes)} min · ${String(body.split(/\s+/).length)} words · summary from ${
        post.excerpt.length > 0 ? 'the export' : 'the body'
      }`,
    );
    // The summary is printed in full because it is the one field this script
    // derives rather than copies, and a derivation nobody reads is a guess.
    console.log(`    “${summary}”`);
    console.log(`    ${legacyPath} → /blog/${slug}`);
    if (!chosen) console.log('    !! slug guessed from the title — add it to SLUGS');
    // Proof the leak is gone: no stylesheet syntax survives into the summary.
    if (/\{|font-family|direction:\s*rtl/.test(summary)) {
      console.log('    !! summary still carries stylesheet syntax');
    }
    console.log('');

    if (!apply) continue;

    const publishedAt = new Date(post.date.replace(' ', 'T') + 'Z');

    await prisma.article.upsert({
      where: { kind_slug_locale: { kind: ArticleKind.POST, slug, locale: Locale.AR } },
      update: {
        title: post.title,
        summary,
        blocks: [{ type: 'richText', html: post.content }],
        readingMinutes: minutes,
        status: PublishStatus.PUBLISHED,
        publishedAt,
      },
      create: {
        slug,
        kind: ArticleKind.POST,
        locale: Locale.AR,
        status: PublishStatus.PUBLISHED,
        title: post.title,
        summary,
        blocks: [{ type: 'richText', html: post.content }],
        readingMinutes: minutes,
        publishedAt,
      },
    });

    // The legacy URL gets somewhere to land. This is the reason the posts were
    // skipped the first time, and the only part of the job that protects what
    // the old site had already earned.
    if (legacyPath.length > 1) {
      await prisma.redirect.upsert({
        where: { from: legacyPath },
        // `source: 'migration'`, the same mark the cutover map's generator
        // uses: these are part of the same move and should be read, audited and
        // pruned with it rather than as a separate species of row.
        update: { to: `/blog/${slug}`, code: 301, isActive: true, source: 'migration' },
        create: { from: legacyPath, to: `/blog/${slug}`, code: 301, source: 'migration' },
      });
    }
  }

  if (!apply) {
    console.log('\nDry run. Pass --apply to write.');
  } else {
    const written = await prisma.article.count({ where: { kind: ArticleKind.POST } });
    console.log(`\nWrote ${String(written)} articles.`);
  }

  await prisma.$disconnect();
}

/**
 * Only when run directly.
 *
 * `readableText` is exported and another script imports it — and without this
 * guard that import ran this whole file, so `pnpm db:article-links` printed the
 * blog import's report before its own. Worse, both scripts read `--apply` from
 * `process.argv`: linking articles with `--apply` would have re-run the import
 * in write mode as a side effect, overwriting every edit made to the seven
 * posts since they came across.
 */
if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

/** Unused, kept so the import matches the products import's hashing helper. */
export const _fingerprint = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
