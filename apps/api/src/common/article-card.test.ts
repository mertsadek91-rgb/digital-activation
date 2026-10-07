import { Locale } from '@da/db';
import { describe, expect, it } from 'vitest';

import { toArticleCard } from './article-card.js';

const row = {
  slug: 'activate-windows',
  locale: Locale.AR,
  title: 'تفعيل ويندوز',
  summary: null,
  readingMinutes: 4,
  publishedAt: null,
};

describe('toArticleCard (TASK-0121)', () => {
  it('carries no image when the article has none', () => {
    expect(toArticleCard(row).hero).toBeNull();
    expect(toArticleCard({ ...row, hero: null }).hero).toBeNull();
  });

  it('carries the image with this language’s alt, or the title when none was written', () => {
    const hero = {
      key: 'catalog/abc.webp',
      width: 1200,
      height: 630,
      alts: [{ locale: Locale.EN, alt: 'Windows activation' }],
    };
    const ar = toArticleCard({ ...row, hero });
    expect(ar.hero).toMatchObject({ width: 1200, height: 630, alt: 'تفعيل ويندوز' });
    expect(ar.hero?.url).toMatch(/catalog\/abc\.webp$/);
    const en = toArticleCard({ ...row, locale: Locale.EN, hero });
    expect(en.hero?.alt).toBe('Windows activation');
  });

  it('falls back to 1200×630 when the asset has no recorded size', () => {
    const card = toArticleCard({
      ...row,
      hero: { key: 'k.webp', width: null, height: null, alts: [] },
    });
    expect(card.hero).toMatchObject({ width: 1200, height: 630 });
  });
});
