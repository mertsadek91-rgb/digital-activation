/**
 * Carries the legacy site's remaining pages over as content.
 *
 * Four of them are policies — privacy, acceptable use, refunds in Arabic and
 * in English — and they are the reason this script exists rather than a fifth
 * hand-written seed file. Legal text is not mine to reword, a payment provider
 * asks for those URLs during onboarding, and every one of them is a live page
 * on the old site that has to have somewhere to land at cutover.
 *
 * The conversion is deliberately dumb, and reads the plain text rather than
 * the markup: the source is Elementor output, where the same paragraph is
 * wrapped in six nested divs with inline styles, and anything that tried to
 * preserve that structure would carry the page builder into the new store.
 * What survives is the text and its shape — a numbered line is a heading, a
 * short line under one is a list item, everything else is a paragraph.
 *
 * Idempotent: a page that already exists is left exactly as it is, because by
 * the second run somebody may have edited it.
 */
import fs from 'node:fs';
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });

import { prisma, Locale, type Prisma, PublishStatus } from '../../src/index.js';

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
 * Which legacy page becomes which new one.
 *
 * Keyed by the decoded legacy path, because that is what Google has indexed
 * and what the redirect map is built from. The English refund page is the
 * same policy in English, so it becomes the `en` row of the same slug rather
 * than a page of its own — one URL, two languages, which is how every other
 * page on this site works.
 */
const PAGES: { legacyPath: string; slug: string; locale: Locale; title: string }[] = [
  {
    legacyPath: '/سياسة-الخصوصية/',
    slug: 'privacy',
    locale: Locale.AR,
    title: 'سياسة الخصوصية',
  },
  { legacyPath: '/سياسة-الاستخدام/', slug: 'terms', locale: Locale.AR, title: 'سياسة الاستخدام' },
  { legacyPath: '/سياسة-الاسترجاع/', slug: 'refunds', locale: Locale.AR, title: 'سياسة الاسترجاع' },
  {
    legacyPath: '/refund-and-return-policy/',
    slug: 'refunds',
    locale: Locale.EN,
    title: 'Refund and Return Policy',
  },
];

/**
 * A block, in the shape Prisma will accept into a Json column.
 *
 * `Prisma.InputJsonValue` rather than an interface with an index signature:
 * an interface is not assignable to it, because TypeScript cannot promise an
 * interface has no extra non-serialisable members.
 */
type Block = Prisma.InputJsonObject;

/** A numbered or colon-terminated line is a heading in all four of these. */
function isHeading(line: string): boolean {
  if (/^\d+\s*[-–.)]\s*\S/.test(line)) return true;
  return line.length < 80 && line.endsWith(':');
}

/** Short lines directly under a heading read as a list in the original. */
function isListItem(line: string): boolean {
  return line.length <= 90 && !/[.؟!]$/.test(line);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toBlocks(text: string, title: string): Block[] {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    // The theme prints a breadcrumb and repeats the title as the first line.
    .filter((line) => line !== 'Home' && line !== title && !line.startsWith(title));

  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({
      type: 'richText',
      html: paragraph.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
    });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length === 0) return;
    blocks.push({
      type: 'richText',
      html: `<ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`,
    });
    list = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;

    if (isHeading(line)) {
      flushList();
      flushParagraph();
      blocks.push({ type: 'heading', level: 2, text: line.replace(/^\d+\s*[-–.)]\s*/, '') });
      continue;
    }

    // A run of short, unpunctuated lines following a heading is a list. One
    // such line on its own is a sentence, so a run of two is the threshold.
    const previous = blocks[blocks.length - 1];
    const nextLine = lines[index + 1];
    const inList =
      list.length > 0 ||
      (isListItem(line) &&
        previous?.type === 'heading' &&
        paragraph.length === 0 &&
        nextLine !== undefined &&
        isListItem(nextLine));

    if (inList && isListItem(line)) {
      list.push(line);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushList();
  flushParagraph();
  return blocks;
}

function plainText(html: string): string {
  return html
    .replace(/\[\/?[^\]]+\]/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function main(): Promise<void> {
  if (!fs.existsSync(EXPORT)) {
    console.error(`The WordPress export is not where this expects it:\n  ${EXPORT}`);
    process.exitCode = 1;
    return;
  }

  const xml = fs.readFileSync(EXPORT, 'utf8');
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];

  const byPath = new Map<string, { link: string; content: string; id: string }>();
  for (const item of items) {
    const type = /<wp:post_type><!\[CDATA\[(.*?)\]\]><\/wp:post_type>/.exec(item)?.[1];
    const status = /<wp:status><!\[CDATA\[(.*?)\]\]><\/wp:status>/.exec(item)?.[1];
    if (type !== 'page' || status !== 'publish') continue;

    const link = /<link>(.*?)<\/link>/.exec(item)?.[1] ?? '';
    const content = /<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/.exec(
      item,
    )?.[1];
    const id = /<wp:post_id>(\d+)<\/wp:post_id>/.exec(item)?.[1] ?? '';
    if (!content) continue;

    byPath.set(decodeURIComponent(new URL(link).pathname), { link, content, id });
  }

  let created = 0;
  let skipped = 0;

  for (const page of PAGES) {
    const source = byPath.get(page.legacyPath);
    if (!source) {
      console.warn(`  not found in the export: ${page.legacyPath}`);
      continue;
    }

    const blocks = toBlocks(plainText(source.content), page.title);
    if (blocks.length === 0) {
      console.warn(`  empty after conversion: ${page.legacyPath}`);
      continue;
    }

    const existing = await prisma.page.findUnique({
      where: { slug_locale: { slug: page.slug, locale: page.locale } },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      console.log(`  kept  ${page.slug} (${page.locale}) — already present`);
      continue;
    }

    await prisma.page.create({
      data: {
        slug: page.slug,
        locale: page.locale,
        status: PublishStatus.PUBLISHED,
        publishedAt: new Date(),
        title: page.title,
        blocks,
        seo: {},
      },
    });
    created += 1;
    console.log(`  wrote ${page.slug} (${page.locale}) — ${String(blocks.length)} blocks`);

    // Recorded so the redirect map can be rebuilt from the database alone.
    await prisma.legacyMap.upsert({
      where: { legacyType_legacyId: { legacyType: 'page', legacyId: source.id } },
      update: { legacyUrl: source.link, entity: 'Page', entityId: page.slug },
      create: {
        legacyType: 'page',
        legacyId: source.id,
        legacyUrl: source.link,
        entity: 'Page',
        entityId: page.slug,
      },
    });
  }

  console.log(`pages: ${String(created)} written, ${String(skipped)} left alone`);
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
