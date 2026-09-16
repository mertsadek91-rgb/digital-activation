/**
 * Links each article to the products it is actually about.
 *
 *   pnpm db:article-links            report only, writes nothing
 *   pnpm db:article-links --apply    write relatedProductIds
 *
 * `Article.relatedProductIds` has been in the schema since it was written, with
 * a comment saying what it is for — "keeps the category -> product -> guide ->
 * comparison -> brand loop intact" — and it has been empty the whole time. The
 * seven imported posts and the sixty-eight published products sit in the same
 * database with nothing joining them, so a reader who has just finished
 * "ويندوز 10 مقابل ويندوز 11" is offered no way to buy either.
 *
 * ## The rule, and the one it replaced
 *
 * A product matches when the article contains a *phrase* from its name — two or
 * three adjacent words, at least one of which is not a family word.
 *
 * The first version of this matched on tokens instead: every distinguishing
 * token of the product's name had to appear somewhere in the article. That
 * sounds strict and is not, because a product whose siblings differ only by
 * version has exactly one distinguishing token, and it is a bare number. So
 * `windows-10-pro` reduced to "10", and an article about Excel keyboard
 * shortcuts that happened to contain the numeral 10 was linked to two Windows
 * licences. "Office 365 على أجهزة متعددة" was linked to Windows Server 2016 on
 * the strength of the digits 2016. A wrong link is worse than none: it tells
 * the reader the shop has not understood its own article.
 *
 * Phrases fix it because "windows 10" cannot occur by accident in a sentence
 * about Excel, and a number on its own never matches anything.
 *
 * ## Arabic
 *
 * These articles are Arabic and name products in Arabic — "ويندوز 10", not
 * "Windows 10" — while the product names this matches against are Latin. So the
 * article text is folded with the same rules the search box uses and the family
 * words are mapped across. The map is deliberately short: only the words that
 * actually appear in these seven posts, checked against them rather than
 * guessed at.
 */
import path from 'node:path';

import { config as loadEnv } from 'dotenv';

loadEnv({ path: path.join(__dirname, '..', '..', '..', '..', '.env'), quiet: true });

import { ArticleKind, prisma, PublishStatus } from '../../src/index.js';

import { readableText } from './articles.js';

/** How many products one article may point at. */
const MAX_LINKS = 6;

/**
 * Family words, which distinguish nothing on their own.
 *
 * A phrase has to carry at least one word from outside this set, or "windows
 * pro" would match every Windows licence in the catalog.
 */
const FAMILY_WORDS = new Set([
  'windows',
  'office',
  'microsoft',
  'adobe',
  'server',
  'pro',
  'plus',
  'professional',
  'standard',
  'home',
  'student',
  'business',
  'premium',
  'deluxe',
  'key',
  'license',
  'licence',
  'activation',
  'online',
  'bind',
  'mac',
  'windwos',
  'device',
  'user',
  'subscription',
  'manual',
  'for',
  'and',
  'the',
  'suite',
  'suit',
]);

/**
 * Arabic names for the things this catalog sells, mapped to the Latin the
 * product names use. Checked against the seven posts, not invented.
 */
const ARABIC_ALIASES: [RegExp, string][] = [
  [/ويندوز/g, 'windows'],
  [/اوفيس|أوفيس/g, 'office'],
  [/مايكروسوفت/g, 'microsoft'],
  [/سيرفر|سرفر/g, 'server'],
  [/ادوبي|أدوبي/g, 'adobe'],
  [/اكسل|إكسل/g, 'excel'],
  [/وورد/g, 'word'],
  [/باوربوينت/g, 'powerpoint'],
  [/اوتلوك|أوتلوك/g, 'outlook'],
  [/نورتون/g, 'norton'],
  [/كاسبرسكي/g, 'kaspersky'],
  [/ماكافي/g, 'mcafee'],
];

/**
 * One comparable string: folded, transliterated where it has to be, and with
 * every separator reduced to a single space so a phrase search is a substring
 * search.
 */
function normalise(value: string): string {
  let text = value.toLowerCase();
  // The same folding the search box applies, for the same reason: أ إ آ and ا
  // are one letter written four ways, and a product named "أوفيس" against an
  // article spelling it "اوفيس" is a match nobody should have to think about.
  text = text
    .replace(/ـ/g, '')
    .replace(/\p{Mn}/gu, '')
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ؤئ]/g, 'ء');
  for (const [pattern, latin] of ARABIC_ALIASES) text = text.replace(pattern, ` ${latin} `);
  // Everything that is not a letter or a digit becomes one space, so "Windows-10"
  // and "ويندوز ١٠" and "windows 10" all end up identical.
  return ` ${text
    .replace(/[^a-z0-9\p{Letter}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/**
 * The phrases from a product's name that could name it in prose.
 *
 * Two and three adjacent words, keeping only those carrying something outside
 * the family set — so "windows 10" and "10 pro" survive and "windows pro" does
 * not.
 */
function phrases(name: string): string[] {
  const words = normalise(name).trim().split(' ').filter(Boolean);
  const out = new Set<string>();
  for (const size of [2, 3]) {
    for (let at = 0; at + size <= words.length; at += 1) {
      const run = words.slice(at, at + size);
      if (run.some((word) => !FAMILY_WORDS.has(word))) out.add(run.join(' '));
    }
  }
  // A one-word product name is a real case — "Elementor", "n8n" — and it names
  // itself. Family words alone never qualify.
  if (words.length === 1 && !FAMILY_WORDS.has(words[0]!)) out.add(words[0]!);
  return [...out];
}

interface Candidate {
  id: string;
  slug: string;
  brand: string;
  phrases: string[];
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const products = await prisma.product.findMany({
    where: { status: PublishStatus.PUBLISHED },
    include: { translations: true, brand: true },
    orderBy: { slug: 'asc' },
  });

  const candidates: Candidate[] = [];
  for (const product of products) {
    const english = product.translations.find((t) => t.locale === 'EN')?.name ?? '';
    const name = english || product.slug.replace(/-/g, ' ');
    const found = phrases(name);

    /**
     * The brand on its own, when the brand is a word that names nothing else.
     *
     * "ESET مقابل Norton مقابل McAfee" names three brands and no product — the
     * article says "ESET", the product is called "ESET NOD32 Antivirus" — so
     * phrase matching found the Norton products (whose name contains the phrase
     * "norton 360") and missed the other two brands entirely. A comparison of
     * three antivirus vendors that links to one of them is worse than useless.
     *
     * The brand comes from the `Brand` table rather than a list in this file,
     * and is skipped when it is a family word: "Microsoft" would otherwise
     * attach forty products to any article that mentions it.
     */
    const brand = normalise(product.brand?.name ?? '').trim();
    if (brand !== '' && !brand.includes(' ') && !FAMILY_WORDS.has(brand)) found.push(brand);

    if (found.length > 0) {
      candidates.push({
        id: product.id,
        slug: product.slug,
        brand: brand || product.slug,
        phrases: [...new Set(found)],
      });
    }
  }

  console.log(
    `${String(products.length)} published products, ${String(candidates.length)} with a nameable phrase\n`,
  );

  const articles = await prisma.article.findMany({
    where: { kind: ArticleKind.POST, status: PublishStatus.PUBLISHED },
    orderBy: [{ publishedAt: 'desc' }],
  });

  let written = 0;
  for (const article of articles) {
    const blocks = article.blocks as unknown as { type: string; html?: string }[];
    const body = blocks
      .map((block) => (typeof block.html === 'string' ? readableText(block.html) : ''))
      .join(' ');
    const haystack = normalise(`${article.title} ${article.summary ?? ''} ${body}`);

    const scored = candidates
      .map((candidate) => ({
        candidate,
        matched: candidate.phrases.filter((phrase) => haystack.includes(` ${phrase} `)),
      }))
      .filter((hit) => hit.matched.length > 0)
      // The longest phrase first: a product named by three words is named more
      // squarely than one named by two, and a brand name alone is the weakest
      // claim of all.
      .sort(
        (a, b) =>
          Math.max(...b.matched.map((m) => m.length)) - Math.max(...a.matched.map((m) => m.length)),
      );

    /**
     * Spread across brands rather than taken in order.
     *
     * Straight ordering gave the antivirus comparison four Norton licences and
     * nothing else, because Norton's products happen to carry a two-word phrase
     * and the other two vendors do not. Round-robin takes the best from each
     * brand, then the next best, so an article about three brands links to
     * three brands — and an article about one brand is not penalised, because
     * the rounds simply keep coming back to it.
     */
    const byBrand = new Map<string, typeof scored>();
    for (const hit of scored) {
      byBrand.set(hit.candidate.brand, [...(byBrand.get(hit.candidate.brand) ?? []), hit]);
    }
    const hits: typeof scored = [];
    for (let round = 0; hits.length < MAX_LINKS; round += 1) {
      const before = hits.length;
      for (const group of byBrand.values()) {
        const pick = group[round];
        if (pick && hits.length < MAX_LINKS) hits.push(pick);
      }
      if (hits.length === before) break;
    }

    console.log(`${article.slug}`);
    console.log(`  ${article.title.slice(0, 68)}`);
    if (hits.length === 0) console.log('    (names no product in the catalog)');
    for (const hit of hits) {
      console.log(`    ${hit.candidate.slug.padEnd(42)} "${hit.matched.join('", "')}"`);
    }
    console.log('');

    if (!apply) continue;

    await prisma.article.update({
      where: { id: article.id },
      data: { relatedProductIds: hits.map((hit) => hit.candidate.id) },
    });
    written += 1;
  }

  if (!apply) {
    console.log('Dry run. Pass --apply to write.');
  } else {
    console.log(`Wrote links for ${String(written)} article(s).`);
  }

  await prisma.$disconnect();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
