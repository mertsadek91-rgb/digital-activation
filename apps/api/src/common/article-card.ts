import type { ArticleCard, ArticleImage } from '@da/contracts';
import { Locale } from '@da/db';

/**
 * One article, as every list of them renders it.
 *
 * Shared rather than written twice because two modules build the same card from
 * the same rows: the content module for `/blog`, and the catalog module for the
 * latest-articles row on the home page — which is composed there so the home
 * page still answers in one request. Two copies of this mapping would be two
 * places for a summary to start arriving null.
 */
export function toArticleCard(row: {
  slug: string;
  locale: Locale;
  title: string;
  summary: string | null;
  readingMinutes: number;
  publishedAt: Date | null;
  hero?: ArticleHeroRow | null;
}): ArticleCard {
  return {
    slug: row.slug,
    locale: row.locale === Locale.EN ? 'en' : 'ar',
    title: row.title,
    summary: row.summary,
    readingMinutes: row.readingMinutes,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    hero: row.hero ? articleImage(row.hero, row.locale, row.title) : null,
  };
}

/** The asset row behind an article image, with its alt text per language. */
export interface ArticleHeroRow {
  key: string;
  width: number | null;
  height: number | null;
  alts: { locale: Locale; alt: string }[];
}

/**
 * What a query includes so `toArticleCard` can carry the article image
 * (CR-0006). Every list of cards asks for it; one place to say how.
 */
export const ARTICLE_HERO_INCLUDE = {
  hero: { include: { alts: { select: { locale: true, alt: true } } } },
} as const;

/** The article image in this language: its alt text, or the title when none was written. */
export function articleImage(hero: ArticleHeroRow, locale: Locale, title: string): ArticleImage {
  return {
    url: assetUrl(hero.key),
    width: hero.width ?? 1200,
    height: hero.height ?? 630,
    alt: hero.alts.find((alt) => alt.locale === locale)?.alt ?? title,
  };
}

/** Where a stored key is served from: the bucket's public base, as the catalog does. */
function assetUrl(key: string): string {
  const base = process.env.S3_PUBLIC_BASE_URL;
  return base ? new URL(key, base).toString() : `/media/${key}`;
}
