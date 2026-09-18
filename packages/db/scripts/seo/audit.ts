/**
 * What is actually wrong with this catalog's search copy.
 *
 *   pnpm db:seo-audit            everything
 *   pnpm db:seo-audit --locale=en  one locale
 *
 * Writes nothing, ever. The two generators beside it (`db:seo`, `db:bodies`)
 * fill fields the publish gate refuses on, and they did their job — every
 * published product now has a title, a description and a body over the floor.
 * This reads what came out, which is a different question: a field that is
 * present can still be truncated, duplicated across two pages, or the same
 * sentence as seventy other products with the name swapped.
 *
 * The check that matters most is the last one. A gate can see whether a body
 * exists; it cannot see that the body is boilerplate, because boilerplate
 * passes every per-page rule there is. Near-duplication is only visible when
 * pages are compared against each other, and nothing was comparing them.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });

import { Locale, prisma, PublishStatus } from '../../src/index.js';

/** The ceilings from SEO_LENGTH_GUIDE, copied for the reason `index.ts` gives. */
const MAX = { title: 60, description: 160 } as const;

/**
 * How alike two texts are, as a percentage of the smaller one's five-word
 * windows that also appear in the larger.
 *
 * Shingles rather than a word-frequency score: two descriptions of licence
 * keys share most of their vocabulary no matter who wrote them, so counting
 * words would flag honest copy. Sharing whole five-word runs is what happens
 * when one template produced both, and it is rare between two people writing
 * separately about the same subject.
 *
 * Five is the usual window for this, and it behaves here: the Arabic bodies —
 * which came from the WooCommerce import, written by hand over years — sit
 * near zero, while the generated English ones do not.
 */
const WINDOW = 5;
const NEAR_DUPLICATE = 60;

function shingles(text: string): Set<string> {
  const words = text.split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let index = 0; index + WINDOW <= words.length; index += 1) {
    out.add(words.slice(index, index + WINDOW).join(' '));
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (shared / Math.min(a.size, b.size)) * 100;
}

/** The text a reader would see, from a block document. */
function flatten(body: unknown): string {
  if (!Array.isArray(body)) return '';
  let out = '';
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      out += ` ${value}`;
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        // `type` and `level` are structure, not prose, and counting them makes
        // every block document look alike.
        if (key === 'type' || key === 'level') continue;
        walk(inner);
      }
    }
  };
  walk(body);
  return out.replace(/\s+/g, ' ').trim();
}

interface Finding {
  kind: string;
  detail: string;
}

async function main(): Promise<void> {
  const only = process.argv.find((argument) => argument.startsWith('--locale='))?.slice(9);
  const locales: Locale[] =
    only === 'ar' ? [Locale.AR] : only === 'en' ? [Locale.EN] : [Locale.AR, Locale.EN];

  const products = await prisma.product.findMany({
    where: { status: PublishStatus.PUBLISHED },
    orderBy: { slug: 'asc' },
    include: {
      translations: true,
      media: { include: { asset: { include: { alts: true } } } },
    },
  });

  console.log(`published products: ${String(products.length)}`);

  for (const locale of locales) {
    const lang = locale === Locale.AR ? 'ar' : 'en';
    const findings: Finding[] = [];
    const rows: { slug: string; body: string }[] = [];
    const titles = new Map<string, string[]>();
    const metas = new Map<string, string[]>();

    for (const product of products) {
      const translation = product.translations.find((entry) => entry.locale === locale);
      if (!translation) {
        findings.push({ kind: 'no translation row', detail: product.slug });
        continue;
      }

      const title = (translation.seoTitle ?? '').trim();
      const meta = (translation.seoDescription ?? '').trim();

      if (title.length > MAX.title) {
        findings.push({
          kind: 'title truncated in results',
          detail: `${product.slug} ${String(title.length)} chars`,
        });
      }
      if (meta.length > MAX.description) {
        findings.push({
          kind: 'description truncated in results',
          detail: `${product.slug} ${String(meta.length)} chars`,
        });
      }
      if (!translation.shortDesc?.trim()) {
        findings.push({ kind: 'no short description', detail: product.slug });
      }
      if (!Array.isArray(translation.faq) || translation.faq.length === 0) {
        findings.push({ kind: 'no FAQ', detail: product.slug });
      }

      if (title) (titles.get(title) ?? titles.set(title, []).get(title)!).push(product.slug);
      if (meta) (metas.get(meta) ?? metas.set(meta, []).get(meta)!).push(product.slug);

      const body = flatten(translation.body);
      if (body) rows.push({ slug: product.slug, body });
    }

    for (const [text, slugs] of titles) {
      if (slugs.length > 1) {
        findings.push({ kind: 'two pages, one title', detail: `${slugs.join(', ')} — ${text}` });
      }
    }
    for (const [, slugs] of metas) {
      if (slugs.length > 1) {
        findings.push({ kind: 'two pages, one description', detail: slugs.join(', ') });
      }
    }

    // Every pair, because the question is whether the catalog as a whole reads
    // as one page repeated. 72 products is 2,556 comparisons and takes well
    // under a second; sampling would report a number nobody could act on.
    const shingled = rows.map((row) => ({ ...row, grams: shingles(row.body) }));
    const near: { a: string; b: string; percent: number }[] = [];
    for (let i = 0; i < shingled.length; i += 1) {
      for (let j = i + 1; j < shingled.length; j += 1) {
        const percent = overlap(shingled[i]!.grams, shingled[j]!.grams);
        if (percent >= NEAR_DUPLICATE) {
          near.push({ a: shingled[i]!.slug, b: shingled[j]!.slug, percent });
        }
      }
    }
    near.sort((x, y) => y.percent - x.percent);

    const pairs = (shingled.length * (shingled.length - 1)) / 2;
    const words = rows.reduce((total, row) => total + row.body.split(' ').length, 0);

    console.log(`\n=== ${lang} ===`);
    const byKind = new Map<string, Finding[]>();
    for (const finding of findings) {
      (byKind.get(finding.kind) ?? byKind.set(finding.kind, []).get(finding.kind)!).push(finding);
    }
    for (const [kind, list] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(list.length).padStart(4)}  ${kind}`);
      for (const finding of list.slice(0, 4)) console.log(`          ${finding.detail}`);
      if (list.length > 4) console.log(`          … and ${String(list.length - 4)} more`);
    }
    if (findings.length === 0) console.log('  no per-page findings');

    console.log(
      `\n  bodies: ${String(rows.length)}, averaging ${String(Math.round(words / Math.max(1, rows.length)))} words`,
    );
    console.log(
      `  near-duplicate pairs (>=${String(NEAR_DUPLICATE)}% of ${String(WINDOW)}-word windows shared): ` +
        `${String(near.length)} of ${String(pairs)} — ${((near.length / Math.max(1, pairs)) * 100).toFixed(0)}%`,
    );
    for (const pair of near.slice(0, 8)) {
      console.log(`      ${pair.percent.toFixed(0).padStart(3)}%  ${pair.a}  ~  ${pair.b}`);
    }
    if (near.length > 8) console.log(`      … and ${String(near.length - 8)} more pairs`);
  }

  console.log('\nNothing was written. This script only reads.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
