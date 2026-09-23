import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminBrand, AdminBrandList, AdminBrandLocale, SetBrand } from '@da/contracts';
import { type BrandTranslation, Locale, Prisma, PublishStatus } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

import {
  blockTypes,
  contentPath,
  toEditableDocument,
  toStoredDocument,
} from './content-documents.js';
import { recordMove } from './content-redirect.js';

/**
 * Brand hubs — the /brands/<slug> pages.
 *
 * The hub renders `BrandTranslation.intro` above the brand's shelf and takes
 * its title and description from the same row, and nothing but a script had
 * ever written any of the three. So every hub in the catalog shipped with the
 * fallback: the brand's name as the title and no description at all.
 *
 * No create here. A brand comes into being with its first product, in the
 * product screen, and a brand with no products is a hub with an empty shelf —
 * this catalog already has two, and they are the ones `isActive` exists to hide.
 */
@Injectable()
export class ContentBrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminBrandList> {
    const rows = await this.prisma.client.brand.findMany({
      orderBy: [{ position: 'asc' }, { slug: 'asc' }],
      include: {
        translations: true,
        _count: { select: { products: { where: { status: PublishStatus.PUBLISHED } } } },
      },
    });

    return {
      rows: rows.map((row) => {
        const ar = row.translations.find((entry) => entry.locale === Locale.AR);
        const en = row.translations.find((entry) => entry.locale === Locale.EN);
        return {
          id: row.id,
          slug: row.slug,
          path: contentPath.brand(row.slug),
          nameAr: ar?.name ?? '',
          nameEn: en?.name ?? '',
          isActive: row.isActive,
          productCount: row._count.products,
          seoComplete: (
            [
              ['ar', ar],
              ['en', en],
            ] as const
          )
            .filter(([, translation]) =>
              Boolean(translation?.seoTitle && translation.seoDescription),
            )
            .map(([locale]) => locale),
        };
      }),
    };
  }

  async get(id: string): Promise<AdminBrand> {
    const brand = await this.load(id);
    return {
      id: brand.id,
      slug: brand.slug,
      path: contentPath.brand(brand.slug),
      name: brand.name,
      website: brand.website ?? '',
      isActive: brand.isActive,
      productCount: brand._count.products,
      ar: toLocale(
        'ar',
        brand.translations.find((entry) => entry.locale === Locale.AR),
      ),
      en: toLocale(
        'en',
        brand.translations.find((entry) => entry.locale === Locale.EN),
      ),
    };
  }

  async update(id: string, input: SetBrand, actorId: string | undefined): Promise<AdminBrand> {
    const brand = await this.load(id);
    const nextSlug = input.slug && input.slug !== brand.slug ? input.slug : null;

    if (nextSlug) {
      const taken = await this.prisma.client.brand.count({ where: { slug: nextSlug } });
      if (taken > 0) {
        throw new BadRequestException(
          say('توجد علامة بهذا الرابط.', 'A brand already has that URL.'),
        );
      }
    }

    const translation = input.translation;
    const locale = translation?.locale === 'en' ? Locale.EN : Locale.AR;

    let storedIntro: unknown[] | undefined;
    if (translation?.intro) {
      const stored = toStoredDocument(translation.intro);
      if (!stored.ok) {
        throw new BadRequestException(
          say(
            `الكتلة رقم ${String(stored.index + 1)} (${stored.type}) غير مكتملة، ولن تعرض صفحة العلامة المقدّمة.`,
            `Block ${String(stored.index + 1)} (${stored.type}) is incomplete; the brand page would drop its intro.`,
          ),
        );
      }
      storedIntro = stored.blocks;
    }

    const before = snapshot(brand);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.brand.update({
        where: { id },
        data: {
          ...(nextSlug ? { slug: nextSlug } : {}),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          ...(input.website === undefined
            ? {}
            : { website: input.website === '' ? null : input.website }),
        },
      });

      if (translation) {
        // Blank SEO copy is stored as null: the hub tests for null to fall back
        // to the name, and an empty string would render an empty <title>.
        const data = {
          ...(translation.name === undefined ? {} : { name: translation.name }),
          ...(storedIntro === undefined
            ? {}
            : {
                // An empty intro is null rather than `[]`, so "nothing written"
                // is one state in the column.
                intro:
                  storedIntro.length === 0 ? Prisma.DbNull : (storedIntro as Prisma.InputJsonValue),
              }),
          ...(translation.seoTitle === undefined ? {} : { seoTitle: translation.seoTitle || null }),
          ...(translation.seoDescription === undefined
            ? {}
            : { seoDescription: translation.seoDescription || null }),
        };
        await tx.brandTranslation.upsert({
          where: { brandId_locale: { brandId: id, locale } },
          update: data,
          // A missing translation starts from the untranslated name, which is
          // what the hub was already showing in its place.
          create: { brandId: id, locale, name: translation.name ?? brand.name, ...data },
        });
      }

      // Always, not only when active: the hub answers for an inactive brand
      // too (it is hidden from lists, not from its own URL), and the old
      // address is on every product page that ever linked to it.
      if (nextSlug) {
        await recordMove(tx, {
          from: contentPath.brand(brand.slug),
          to: contentPath.brand(nextSlug),
          actorId,
        });
      }
    });

    const after = await this.load(id);
    await this.audit.record({
      actorId,
      action: 'brand.content_changed',
      entity: 'Brand',
      entityId: id,
      before,
      after: snapshot(after),
    });

    return this.get(id);
  }

  private async load(id: string) {
    const brand = await this.prisma.client.brand.findUnique({
      where: { id },
      include: {
        translations: true,
        _count: { select: { products: { where: { status: PublishStatus.PUBLISHED } } } },
      },
    });
    if (!brand) throw new NotFoundException(say('لا توجد علامة بهذا المعرّف.', 'No such brand.'));
    return brand;
  }
}

function toLocale(locale: 'ar' | 'en', row: BrandTranslation | undefined): AdminBrandLocale {
  return {
    locale,
    exists: row !== undefined,
    name: row?.name ?? '',
    intro: toEditableDocument(row?.intro ?? []),
    seoTitle: row?.seoTitle ?? '',
    seoDescription: row?.seoDescription ?? '',
  };
}

function snapshot(brand: {
  slug: string;
  isActive: boolean;
  website: string | null;
  translations: BrandTranslation[];
}) {
  return {
    slug: brand.slug,
    isActive: brand.isActive,
    website: brand.website,
    translations: brand.translations.map((entry) => ({
      locale: entry.locale,
      name: entry.name,
      seoTitle: entry.seoTitle,
      seoDescription: entry.seoDescription,
      intro: blockTypes(entry.intro),
    })),
  };
}
