import type { ArticleCard } from '@da/contracts';
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
}): ArticleCard {
  return {
    slug: row.slug,
    locale: row.locale === Locale.EN ? 'en' : 'ar',
    title: row.title,
    summary: row.summary,
    readingMinutes: row.readingMinutes,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}
