import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  AdminCategory,
  AdminCategoryList,
  CreateCategory,
  CreateProductLink,
  ProductLinks,
  SetCategory,
} from '@da/contracts';
import { Locale, Prisma, PublishStatus } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Sections, and the links between products.
 *
 * Both were data with no screen. The sixteen sections arrived with the
 * WordPress import and could not be renamed, reordered or added to; the
 * relation table has been empty since the day it was created, which is why the
 * checkout's cross-sell guesses from the cart and why the account page's "used
 * alongside" reason has never once been shown to anybody.
 */
@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- sections -------------------------------------------------------------

  async categories(): Promise<AdminCategoryList> {
    const rows = await this.prisma.client.category.findMany({
      orderBy: [{ position: 'asc' }, { slug: 'asc' }],
      include: {
        translations: true,
        _count: {
          select: { products: { where: { product: { status: PublishStatus.PUBLISHED } } } },
        },
      },
    });

    return {
      rows: rows.map((row): AdminCategory => {
        const ar = row.translations.find((entry) => entry.locale === Locale.AR);
        const en = row.translations.find((entry) => entry.locale === Locale.EN);
        return {
          id: row.id,
          slug: row.slug,
          parentId: row.parentId,
          position: row.position,
          status: row.status,
          nameAr: ar?.name ?? '',
          nameEn: en?.name ?? '',
          headlineAr: ar?.headline ?? '',
          headlineEn: en?.headline ?? '',
          productCount: row._count.products,
        };
      }),
    };
  }

  async createCategory(
    input: CreateCategory,
    actorId: string | undefined,
  ): Promise<AdminCategoryList> {
    const taken = await this.prisma.client.category.count({ where: { slug: input.slug } });
    if (taken > 0) {
      throw new BadRequestException(
        say('هذا الرابط مستخدم لقسم آخر.', 'Another section has that URL.'),
      );
    }
    if (input.parentId) {
      const parent = await this.prisma.client.category.count({ where: { id: input.parentId } });
      if (parent === 0) {
        throw new BadRequestException(
          say('القسم الأب غير موجود.', 'That parent section does not exist.'),
        );
      }
    }

    const last = await this.prisma.client.category.findFirst({
      where: { parentId: input.parentId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await this.prisma.client.category.create({
      data: {
        slug: input.slug,
        parentId: input.parentId,
        position: (last?.position ?? -1) + 1,
        /*
         * PUBLISHED, deliberately and against the schema's default.
         *
         * Nothing reads `Category.status` — every section in this catalog is
         * `DRAFT` and every one of them is served, listed and linked from the
         * rail. Creating a section as a draft would make it indistinguishable
         * from the sixteen that already work, while implying a switch that
         * does not exist. Published is the state that matches what actually
         * happens.
         */
        status: PublishStatus.PUBLISHED,
        translations: {
          create: [
            { locale: Locale.AR, name: input.nameAr },
            ...(input.nameEn ? [{ locale: Locale.EN, name: input.nameEn }] : []),
          ],
        },
      },
    });

    await this.audit.record({
      actorId,
      action: 'category.created',
      entity: 'Category',
      entityId: created.id,
      after: { slug: input.slug, nameAr: input.nameAr },
    });

    return this.categories();
  }

  async setCategory(
    id: string,
    input: SetCategory,
    actorId: string | undefined,
  ): Promise<AdminCategoryList> {
    const category = await this.prisma.client.category.findUnique({
      where: { id },
      include: { translations: true },
    });
    if (!category)
      throw new NotFoundException(say('لا يوجد قسم بهذا المعرّف.', 'No such section.'));

    if (input.slug && input.slug !== category.slug) {
      const taken = await this.prisma.client.category.count({ where: { slug: input.slug } });
      if (taken > 0) {
        throw new BadRequestException(
          say('هذا الرابط مستخدم لقسم آخر.', 'Another section has that URL.'),
        );
      }
    }

    /*
     * A section cannot be its own parent, nor its own grandparent.
     *
     * The tree is walked upwards rather than checked one level: A under B
     * under A is a cycle the schema accepts and the breadcrumb builder
     * recurses into forever.
     */
    if (input.parentId) {
      if (input.parentId === id) {
        throw new BadRequestException(
          say('لا يكون القسم أباً لنفسه.', 'A section cannot be its own parent.'),
        );
      }
      let walk: string | null = input.parentId;
      const seen = new Set<string>([id]);
      while (walk) {
        if (seen.has(walk)) {
          throw new BadRequestException(
            say('هذا يصنع حلقة في شجرة الأقسام.', 'That would make a loop in the section tree.'),
          );
        }
        seen.add(walk);
        const parent: { parentId: string | null } | null =
          await this.prisma.client.category.findUnique({
            where: { id: walk },
            select: { parentId: true },
          });
        walk = parent?.parentId ?? null;
      }
    }

    const before = {
      slug: category.slug,
      parentId: category.parentId,
      position: category.position,
      nameAr: category.translations.find((t) => t.locale === Locale.AR)?.name ?? '',
    };

    await this.prisma.client.$transaction(async (tx) => {
      await tx.category.update({
        where: { id },
        data: {
          ...(input.slug === undefined ? {} : { slug: input.slug }),
          ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
          ...(input.position === undefined ? {} : { position: input.position }),
        },
      });

      for (const [locale, name, headline] of [
        [Locale.AR, input.nameAr, input.headlineAr],
        [Locale.EN, input.nameEn, input.headlineEn],
      ] as const) {
        if (name === undefined && headline === undefined) continue;
        await tx.categoryTranslation.upsert({
          where: { categoryId_locale: { categoryId: id, locale } },
          update: {
            ...(name === undefined ? {} : { name }),
            ...(headline === undefined ? {} : { headline: headline === '' ? null : headline }),
          },
          create: {
            categoryId: id,
            locale,
            name: name ?? '',
            ...(headline ? { headline } : {}),
          },
        });
      }

      // Same rule as a product: a renamed section is a redirect, never a dead
      // end. 103 legacy URLs point at these pages.
      if (input.slug && input.slug !== category.slug) {
        const from = `/collections/${category.slug}`;
        const to = `/collections/${input.slug}`;
        await tx.redirect.upsert({
          where: { from },
          update: { to, code: 301, isActive: true },
          create: { from, to, code: 301, isActive: true, source: 'manual' },
        });
        await tx.redirect.updateMany({ where: { to: from }, data: { to } });
      }
    });

    await this.audit.record({
      actorId,
      action: 'category.changed',
      entity: 'Category',
      entityId: id,
      before,
      after: { ...before, ...input },
    });

    return this.categories();
  }

  // --- links between products -----------------------------------------------

  async links(slug: string): Promise<ProductLinks> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    const rows = await this.prisma.client.productRelation.findMany({
      where: { sourceId: product.id },
      orderBy: [{ kind: 'asc' }, { position: 'asc' }],
      include: {
        target: {
          select: {
            slug: true,
            status: true,
            translations: { where: { locale: Locale.AR }, select: { name: true } },
          },
        },
      },
    });

    return {
      productSlug: slug,
      links: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        position: row.position,
        bundleDiscountPercent: row.bundleDiscountPercent?.toFixed(2) ?? null,
        targetSlug: row.target.slug,
        targetName: row.target.translations[0]?.name ?? row.target.slug,
        targetPublished: row.target.status === PublishStatus.PUBLISHED,
      })),
    };
  }

  async addLink(
    slug: string,
    input: CreateProductLink,
    actorId: string | undefined,
  ): Promise<ProductLinks> {
    const [source, target] = await Promise.all([
      this.prisma.client.product.findUnique({ where: { slug }, select: { id: true } }),
      this.prisma.client.product.findUnique({
        where: { slug: input.targetSlug },
        select: { id: true },
      }),
    ]);
    if (!source) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));
    if (!target) {
      throw new BadRequestException(
        say('المنتج المرتبط غير موجود.', 'The product being linked to does not exist.'),
      );
    }
    if (source.id === target.id) {
      throw new BadRequestException(
        say('لا يُربط المنتج بنفسه.', 'A product cannot be linked to itself.'),
      );
    }

    /*
     * A discount only where one can be honoured.
     *
     * `bundleDiscountPercent` is read by the checkout's cross-sell and by
     * nothing else. Stored on a `RELATED` row it is a number that will never
     * be applied, and the first person to look at the data would reasonably
     * conclude the discount was broken rather than never offered.
     */
    if (input.bundleDiscountPercent !== '' && input.kind !== 'CROSS_SELL') {
      throw new BadRequestException(
        say(
          'خصم الحزمة لا يُطبَّق إلا على رابط «بيع متقاطع».',
          'A bundle discount only applies to a cross-sell link.',
        ),
      );
    }

    const existing = await this.prisma.client.productRelation.count({
      where: { sourceId: source.id, targetId: target.id, kind: input.kind },
    });
    if (existing > 0) {
      throw new BadRequestException(say('هذا الرابط موجود بالفعل.', 'That link already exists.'));
    }

    const last = await this.prisma.client.productRelation.findFirst({
      where: { sourceId: source.id, kind: input.kind },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await this.prisma.client.productRelation.create({
      data: {
        sourceId: source.id,
        targetId: target.id,
        kind: input.kind,
        position: (last?.position ?? -1) + 1,
        ...(input.bundleDiscountPercent === ''
          ? {}
          : { bundleDiscountPercent: new Prisma.Decimal(input.bundleDiscountPercent) }),
      },
    });

    await this.audit.record({
      actorId,
      action: 'product.link_added',
      entity: 'ProductRelation',
      entityId: created.id,
      after: { from: slug, to: input.targetSlug, kind: input.kind },
    });

    return this.links(slug);
  }

  async removeLink(id: string, actorId: string | undefined): Promise<ProductLinks> {
    const row = await this.prisma.client.productRelation.findUnique({
      where: { id },
      include: { source: { select: { slug: true } }, target: { select: { slug: true } } },
    });
    if (!row) throw new NotFoundException(say('لا يوجد هذا الرابط.', 'No such link.'));

    await this.prisma.client.productRelation.delete({ where: { id } });

    await this.audit.record({
      actorId,
      action: 'product.link_removed',
      entity: 'ProductRelation',
      entityId: id,
      // The row as it was, so an accidental removal can be put back — the same
      // reason the image delete records one.
      before: {
        from: row.source.slug,
        to: row.target.slug,
        kind: row.kind,
        position: row.position,
        bundleDiscountPercent: row.bundleDiscountPercent?.toFixed(2) ?? null,
      },
    });

    return this.links(row.source.slug);
  }
}
