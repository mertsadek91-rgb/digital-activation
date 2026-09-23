import { Injectable } from '@nestjs/common';

import {
  type CatalogCard,
  type CatalogQuery,
  type SearchResults,
  catalogFiltersFrom,
  hasCatalogFilters,
} from '@da/contracts';
import { Locale, PublishStatus } from '@da/db';

import { words } from '../common/arabic.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { CatalogService } from './catalog.service.js';

/**
 * The search box.
 *
 * Until now the only way to find anything was to page through the store or to
 * know a category name, and the store page's own comment said so. That is a
 * real gap on a catalog like this one: somebody who wants Office 2021 arrives
 * knowing exactly what they want, and making them browse for it is the
 * shortest path to them leaving.
 *
 * Not Meilisearch, which this repo has an environment variable for and no
 * running instance of. Seventy-three products with two names each is not a
 * search-engine problem — it is a list — and the matching this needs already
 * exists for the 404 suggester, so both now share one tokenizer in
 * `common/arabic.ts`. If a second tokenizer existed, a visitor could be
 * offered a product on the dead-end page that the search box then could not
 * find, which is worse than either being missing.
 *
 * What makes it work on this catalog is the Arabic folding rather than the
 * ranking. Every product here has an Arabic name with an English tail —
 * "أشتراك أدوبي أكروبات برو … Adobe Acrobat Pro DC" — so a search for "adobe"
 * and a search for "ادوبي" have to reach the same row, and the store's own
 * data spells the same Arabic word two ways.
 */

/**
 * How a match is scored.
 *
 * Deliberately crude and deliberately explainable. A phrase that appears whole
 * beats a bag of words that happens to overlap, and a word in the name beats
 * the same word in the description — someone searching "office" wants the
 * product called Office, not the six products whose description mentions it.
 */
const WEIGHT = {
  /** The query, entire, inside the name. "office 2021" in "… Office 2021 …". */
  phraseInName: 100,
  /** The query, entire, inside the slug. Usually a pasted or typed URL. */
  phraseInSlug: 80,
  /** Per query word found in the name or the slug. */
  wordInName: 10,
  /** Per query word found only in the short description. */
  wordInBlurb: 3,
} as const;

/**
 * Below this, it is not a result.
 *
 * One word out of four in a description is noise, and a search that returns
 * everything has told the visitor nothing. Expressed as a share of the query's
 * words so a one-word search is not held to the same bar as a four-word one.
 */
const MIN_COVERAGE = 0.5;

/** The catalog is small; this only exists so a bored crawler cannot scan it. */
const CACHE_MS = 5 * 60 * 1000;

export interface Indexed {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  nameWords: Set<string>;
  blurbWords: Set<string>;
  /** Name and slug, folded and joined, for the whole-phrase test. */
  haystack: string;
}

/**
 * What a row is worth against a query.
 *
 * Pure and exported so it can be pinned by a test: the ordering is the whole
 * product here, and every rule in it is a judgement that is easy to break
 * silently — a wrong weight does not throw, it just puts the bundle above the
 * thing somebody asked for.
 */
export function scoreRow(row: Indexed, asked: Set<string>, phrase: string): number {
  let score = 0;

  // The whole query, in order, inside the name. This is what makes an exact
  // product name the first result rather than the third.
  if (phrase.length > 0 && row.haystack.includes(phrase)) score += WEIGHT.phraseInName;
  if (phrase.length > 0 && row.slug.toLowerCase().includes(phrase.replace(/\s+/g, '-'))) {
    score += WEIGHT.phraseInSlug;
  }

  let covered = 0;
  for (const word of asked) {
    if (row.nameWords.has(word)) {
      score += WEIGHT.wordInName;
      covered += 1;
    } else if (row.blurbWords.has(word)) {
      score += WEIGHT.wordInBlurb;
      covered += 1;
    }
  }

  // Every word matters, in proportion. A search for "office 2021 pro plus"
  // that finds only "office" has found the category, not the product.
  return covered / asked.size >= MIN_COVERAGE ? score : 0;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  private cache: { at: number; locale: Locale; rows: Indexed[] } | null = null;

  async search(input: { q: string; query: CatalogQuery }): Promise<SearchResults> {
    const locale = input.query.locale === 'en' ? Locale.EN : Locale.AR;
    const q = input.q.trim();

    // An empty query is not an error and not "everything": it is a page that
    // has not been asked anything yet.
    if (q.length === 0) {
      return { q, products: [], total: 0, page: input.query.page, perPage: input.query.perPage };
    }

    const asked = words(q);
    if (asked.size === 0) {
      return { q, products: [], total: 0, page: input.query.page, perPage: input.query.perPage };
    }

    const phrase = [...words(q)].join(' ');
    let ranked = (await this.index(locale))
      .map((row) => ({ row, score: scoreRow(row, asked, phrase) }))
      .filter((entry) => entry.score > 0)
      // Ties broken by the shorter name: between a product and the bundle that
      // contains it, the plainer one is what was asked for.
      .sort((a, b) => b.score - a.score || a.row.name.length - b.row.name.length);

    // The listing filters, when any are set, narrow the ranked list without
    // reordering it. Relevance stays the order: a price sort on search
    // results would put the cheapest loose match above the exact product.
    if (hasCatalogFilters(catalogFiltersFrom(input.query))) {
      const keep = await this.catalog.matchingIds(
        ranked.map((entry) => entry.row.id),
        input.query,
      );
      ranked = ranked.filter((entry) => keep.has(entry.row.id));
    }

    const page = ranked.slice(
      (input.query.page - 1) * input.query.perPage,
      input.query.page * input.query.perPage,
    );

    return {
      q,
      products: await this.cards(
        page.map((entry) => entry.row.id),
        input.query,
      ),
      total: ranked.length,
      page: input.query.page,
      perPage: input.query.perPage,
    };
  }

  /**
   * Every published product's searchable text, read once and kept briefly.
   *
   * Both translations go into one bag rather than only the requested locale.
   * An Arabic visitor searching "adobe" is searching in Latin letters on an
   * Arabic page — which is what people actually do with software names — and a
   * locale-pure index would answer nothing.
   */
  private async index(locale: Locale): Promise<Indexed[]> {
    if (this.cache && this.cache.locale === locale && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.rows;
    }

    const products = await this.prisma.client.product.findMany({
      where: { status: PublishStatus.PUBLISHED },
      select: {
        id: true,
        slug: true,
        translations: { select: { locale: true, name: true, shortDesc: true } },
        brand: { select: { name: true } },
      },
    });

    const rows = products.map((product) => {
      const wanted = product.translations.find((entry) => entry.locale === locale);
      const other = product.translations.find((entry) => entry.locale !== locale);
      const shown = wanted ?? other;

      const names = product.translations.map((entry) => entry.name).join(' ');
      const blurbs = product.translations.map((entry) => entry.shortDesc ?? '').join(' ');

      return {
        id: product.id,
        slug: product.slug,
        name: shown?.name ?? product.slug,
        blurb: shown?.shortDesc ?? '',
        nameWords: words(`${names} ${product.slug} ${product.brand?.name ?? ''}`),
        blurbWords: words(blurbs),
        haystack: [...words(`${names} ${product.slug}`)].join(' '),
      };
    });

    this.cache = { at: Date.now(), locale, rows };
    return rows;
  }

  /**
   * The matched products as store cards, in the order the ranking put them.
   *
   * Prices, stock and the golden-warranty flag all come from the catalog's own
   * card builder rather than from anything here: a search result showing a
   * different price from the grid one click away would be the worst kind of
   * bug, because nobody notices until an order is placed.
   */
  private async cards(ids: string[], query: CatalogQuery): Promise<CatalogCard[]> {
    if (ids.length === 0) return [];
    const byId = await this.catalog.cardsByIds(ids, query);
    // Prisma returns rows in its own order, and the ranking is the whole point.
    return ids.map((id) => byId.get(id)).filter((card): card is CatalogCard => card !== undefined);
  }
}
