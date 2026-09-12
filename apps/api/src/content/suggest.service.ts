import { Injectable } from '@nestjs/common';

import { ROUTES, type Suggestion } from '@da/contracts';
import { Locale, PublishStatus } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * What the visitor was probably looking for.
 *
 * The cutover ships 96 redirects generated from the WordPress export, and that
 * map covers every URL the export knew about. What it cannot cover is every
 * link anybody else ever published — a forum post from 2021, a printed
 * invoice, a partner's page, a URL somebody typed from memory. Those arrive as
 * 404s, and a 404 during a migration is not a mistake the visitor made: it is
 * a page that genuinely used to be there.
 *
 * So the dead end gets a guess. `NotFoundLog` already records the path for the
 * panel, where somebody turns the repeated ones into real redirects; this is
 * the half that helps the person standing in front of the wall right now,
 * before anybody has read that list.
 *
 * Two sources, in order of confidence:
 *
 *   - `LegacyMap`, which is not a guess at all. It holds the URL each imported
 *     row had on the old store. The redirect generator already walked it, but
 *     it matched on the normalised path, and a legacy Arabic URL reaches this
 *     system in more than one percent-encoding — so an exact lookup here
 *     catches what normalisation missed.
 *   - Shared words. Every legacy product URL is a percent-encoded Arabic
 *     phrase and every new slug is English, so matching slug-to-slug finds
 *     nothing; the Arabic *name* is what those words are shared with. Both are
 *     searched, in both languages, which is also what makes a typed English
 *     slug work.
 */

/** Below this share of the asked-for words in common, it is not a suggestion. */
const MIN_SCORE = 0.4;

/** Words this short are prepositions and file extensions, not subjects. */
const MIN_WORD = 3;

/**
 * Words that are part of the address rather than part of the question.
 *
 * A path carries its own routing vocabulary — `/en/store/…`, `/product/…`,
 * `/collections/…` — and the visitor did not type any of it looking for a
 * product called "store". Counted, they dilute the score to the point of
 * silence: `/en/store/acrobat-professional` scores one word in three and falls
 * under the threshold, so the store answers "no idea" to somebody who typed
 * the name of a product it sells. Both spellings are here because the legacy
 * store used `/product/` and this one uses `/store/`.
 */
const ROUTE_WORDS = new Set([
  'store',
  'shop',
  'product',
  'products',
  'collection',
  'collections',
  'category',
  'categories',
  'page',
  'index',
  'html',
  'htm',
  'php',
  'aspx',
  'منتج',
  'المنتج',
  'قسم',
  'التصنيف',
  'صفحه',
]);

/** More than four turns "did you mean" into a second store page. */
const LIMIT = 4;

/**
 * The catalog is re-read at most this often.
 *
 * A 404 is rare by design, but a crawler that has found an old sitemap
 * produces them in bursts — and the one thing a dead-end page must not do is
 * put a table scan behind every dead end.
 */
const CACHE_MS = 5 * 60 * 1000;

interface Candidate {
  kind: Suggestion['kind'];
  slug: string;
  title: string;
  titleEn: string | null;
  words: Set<string>;
}

/**
 * Splits a path or a name into words, and levels the spellings apart.
 *
 * Arabic-aware, and it has to be twice over.
 *
 * First, `\w` in a JavaScript regex is ASCII-only, so splitting on it would
 * reduce every Arabic legacy URL — which is all of them — to nothing.
 *
 * Second, and this is what decides whether any of this works on the real
 * traffic: the same Arabic word is routinely written more than one way, and
 * URLs are where that shows most. أ إ آ and ا are the same letter carrying
 * different hamza marks that people and slug generators drop at will; ة and ه
 * are interchanged at the end of a word; ى and ي likewise. The store's own
 * data has both — a product named "أشتراك" against a legacy URL spelling it
 * "اشتراك". Matching those as different words means matching nothing, so
 * every form is folded to one before comparison. The diacritics and the
 * tatweel are stripped for the same reason: they decorate a word without
 * changing which word it is.
 */
export function words(value: string): Set<string> {
  let text = value;
  try {
    text = decodeURIComponent(value);
  } catch {
    // A malformed percent-escape is a crawler probing. Match on the raw text.
  }

  const folded = text
    .toLowerCase()
    // The tatweel, and every non-spacing mark — which for Arabic is the
    // harakat. Written as a Unicode property rather than as a literal range
    // because a character class holding combining marks is ambiguous about
    // what it matches, and the linter is right to say so.
    .replace(/ـ/g, '')
    .replace(/\p{Mn}/gu, '')
    // Every alif, one alif.
    .replace(/[آأإٱ]/g, 'ا')
    // Taa marbuta reads as haa at the end of a word.
    .replace(/ة/g, 'ه')
    // Alif maqsura reads as yaa.
    .replace(/[ىي]/g, 'ي')
    // Hamza on a seat, without the seat.
    .replace(/[ؤئ]/g, 'ء');

  return new Set(
    folded.split(/[^\p{Letter}\p{Number}]+/u).filter((word) => word.length >= MIN_WORD),
  );
}

/**
 * The words in a path that are actually about something.
 *
 * What the matcher scores against, and the reason it is a separate function is
 * that the score is a *share* of these: leaving the routing vocabulary in
 * makes every path look less like every product, in proportion to how deep it
 * is nested.
 */
export function subjectWords(path: string): Set<string> {
  return new Set([...words(path)].filter((word) => !ROUTE_WORDS.has(word)));
}

@Injectable()
export class SuggestService {
  constructor(private readonly prisma: PrismaService) {}

  private cache: { at: number; rows: Candidate[] } | null = null;

  async suggest(input: { path: string; locale: string }): Promise<{ suggestions: Suggestion[] }> {
    const en = input.locale === 'en';
    const prefix = en ? '/en' : '';

    const exact = await this.fromLegacyMap(input.path);
    if (exact) return { suggestions: [{ ...exact, href: `${prefix}${exact.href}` }] };

    const asked = subjectWords(input.path);
    if (asked.size === 0) return { suggestions: [] };

    const scored = (await this.candidates())
      .map((row) => {
        let shared = 0;
        for (const word of asked) if (row.words.has(word)) shared += 1;
        return { row, score: shared / asked.size };
      })
      .filter((entry) => entry.score >= MIN_SCORE)
      // Ties broken by the shorter title: between "Office 2016" and "Office
      // 2016 Pro Plus Bundle With Windows", the plainer one is the guess.
      .sort((a, b) => b.score - a.score || a.row.title.length - b.row.title.length)
      .slice(0, LIMIT);

    return {
      suggestions: scored.map(({ row }) => ({
        kind: row.kind,
        title: (en ? row.titleEn : null) ?? row.title,
        href: `${prefix}${this.href(row.kind, row.slug)}`,
      })),
    };
  }

  private href(kind: Suggestion['kind'], slug: string): string {
    if (kind === 'product') return ROUTES.product(slug);
    if (kind === 'collection') return ROUTES.collection(slug);
    return `/${slug}`;
  }

  /**
   * The old store's own answer, when it kept one for this URL.
   *
   * The import wrote one row per legacy *product post*, and a legacy product
   * post became a Variant here rather than a Product — the old store sold the
   * one-year and three-year ESET as two unrelated products, and this catalog
   * sells them as two variants of one. So the lookup goes through the variant
   * to its product, which is the page that URL should now land on.
   *
   * Matched by suffix because `legacyUrl` is an absolute URL and this is a
   * path, and with the trailing slash allowed either way: WordPress wrote them
   * with one and a link somebody typed usually has not.
   */
  private async fromLegacyMap(path: string): Promise<Suggestion | null> {
    const bare = path.replace(/\/+$/, '');
    const rows = await this.prisma.client.legacyMap.findMany({
      where: {
        entity: { in: ['Variant', 'Page'] },
        OR: [{ legacyUrl: { endsWith: bare } }, { legacyUrl: { endsWith: `${bare}/` } }],
      },
      select: { entity: true, entityId: true },
      take: 1,
    });
    const row = rows[0];
    if (!row) return null;

    if (row.entity === 'Page') {
      const page = await this.prisma.client.page.findFirst({
        where: { id: row.entityId, status: PublishStatus.PUBLISHED },
        select: { slug: true, title: true },
      });
      return page ? { kind: 'page', title: page.title, href: `/${page.slug}` } : null;
    }

    const variant = await this.prisma.client.variant.findFirst({
      where: { id: row.entityId, product: { status: PublishStatus.PUBLISHED } },
      select: {
        product: {
          select: { slug: true, translations: { select: { locale: true, name: true } } },
        },
      },
    });
    if (!variant) return null;

    const product = variant.product;
    const name = product.translations.find((entry) => entry.locale === Locale.AR)?.name;
    return { kind: 'product', title: name ?? product.slug, href: ROUTES.product(product.slug) };
  }

  /**
   * Everything a visitor could have been asking for, with its words.
   *
   * Read in full rather than queried per request. The catalog is 73 products
   * and a handful of collections and pages; a word-overlap score cannot be
   * expressed as an index lookup without a trigram extension this database
   * does not have, and scanning a list this size in memory is cheaper than
   * installing one.
   */
  private async candidates(): Promise<Candidate[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rows;

    const [products, collections, pages] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { status: PublishStatus.PUBLISHED },
        select: { slug: true, translations: { select: { locale: true, name: true } } },
      }),
      this.prisma.client.category.findMany({
        select: { slug: true, translations: { select: { locale: true, name: true } } },
      }),
      this.prisma.client.page.findMany({
        where: { status: PublishStatus.PUBLISHED },
        select: { slug: true, locale: true, title: true },
      }),
    ]);

    const rows: Candidate[] = [];

    for (const product of products) {
      rows.push(this.toCandidate('product', product.slug, product.translations));
    }
    for (const collection of collections) {
      rows.push(this.toCandidate('collection', collection.slug, collection.translations));
    }

    // A Page is one row per locale sharing one slug, unlike a Product, which is
    // one row with its translations hanging off it. Left as they come, the
    // warranty page is two identical suggestions — so they are gathered by slug
    // first, which is also what lets the Arabic and English titles of the same
    // page contribute their words to each other.
    const bySlug = new Map<string, { locale: Locale; name: string }[]>();
    for (const page of pages) {
      const found = bySlug.get(page.slug) ?? [];
      found.push({ locale: page.locale, name: page.title });
      bySlug.set(page.slug, found);
    }
    for (const [slug, titles] of bySlug) {
      rows.push(this.toCandidate('page', slug, titles));
    }

    this.cache = { at: Date.now(), rows };
    return rows;
  }

  private toCandidate(
    kind: Suggestion['kind'],
    slug: string,
    translations: { locale: Locale; name: string }[],
  ): Candidate {
    const ar = translations.find((entry) => entry.locale === Locale.AR)?.name ?? null;
    const en = translations.find((entry) => entry.locale === Locale.EN)?.name ?? null;

    // The slug and both names all contribute words, because the asked-for path
    // could be any of the three: a legacy Arabic URL, a typed English slug, or
    // a link somebody built from the English name.
    const bag = words([slug, ar ?? '', en ?? ''].join(' '));

    return { kind, slug, title: ar ?? en ?? slug, titleEn: en, words: bag };
  }
}
