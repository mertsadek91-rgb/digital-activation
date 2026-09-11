import { Injectable, NotFoundException } from '@nestjs/common';

import { type ContentPage, blockDocumentSchema } from '@da/contracts';
import { Locale, type Prisma, PublishStatus } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Editorial pages.
 *
 * A page exists per locale, and the fallback is deliberate: an Arabic visitor
 * asking for a page that has only been written in English gets the English one
 * rather than a 404. A missing translation is a content gap, and answering a
 * real question in the wrong language beats answering nothing — the header
 * links to these pages in both languages whether or not both have been written.
 */
@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  async page(slug: string, locale: string, preview?: string): Promise<ContentPage> {
    const wanted = locale === 'en' ? Locale.EN : Locale.AR;
    const token = process.env.PREVIEW_TOKEN;
    const allowDrafts = Boolean(token && preview && preview === token);

    const rows = await this.prisma.client.page.findMany({
      where: {
        slug,
        ...(allowDrafts ? {} : { status: PublishStatus.PUBLISHED }),
      },
    });
    if (rows.length === 0) throw new NotFoundException(`No page with slug "${slug}"`);

    const page = rows.find((row) => row.locale === wanted) ?? rows[0];
    if (!page) throw new NotFoundException(`No page with slug "${slug}"`);

    return {
      slug: page.slug,
      locale: page.locale === Locale.EN ? 'en' : 'ar',
      title: page.title,
      blocks: parseBlocks(page.blocks),
      seo: parseSeo(page.seo),
      updatedAt: page.updatedAt.toISOString(),
    };
  }

  /** Published slugs, for the sitemap and for prerendering. */
  async publishedSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
    const rows = await this.prisma.client.page.findMany({
      where: { status: PublishStatus.PUBLISHED },
      orderBy: { slug: 'asc' },
      select: { slug: true, updatedAt: true },
    });

    // One entry per slug: the Arabic and English rows are the same URL with
    // different hreflang, not two pages.
    const seen = new Map<string, Date>();
    for (const row of rows) {
      const current = seen.get(row.slug);
      if (!current || row.updatedAt > current) seen.set(row.slug, row.updatedAt);
    }
    return [...seen].map(([slug, updatedAt]) => ({ slug, updatedAt }));
  }
}

/** Prisma's Json columns are `unknown` at the type level; parse, do not cast. */
function parseBlocks(value: Prisma.JsonValue): ContentPage['blocks'] {
  const parsed = blockDocumentSchema.safeParse(value ?? []);
  return parsed.success ? parsed.data : [];
}

function parseSeo(value: Prisma.JsonValue): ContentPage['seo'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { title: null, description: null };
  }
  const record = value as Record<string, unknown>;
  return {
    title: typeof record.title === 'string' ? record.title : null,
    description: typeof record.description === 'string' ? record.description : null,
  };
}
