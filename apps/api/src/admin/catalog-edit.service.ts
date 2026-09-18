import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  CreateProduct,
  CreateVariant,
  CreatedProduct,
  ProductIdentity,
  ProductTerms,
  SetProductIdentity,
  SetVariantTerms,
  VariantTerms,
} from '@da/contracts';
import { Locale, Prisma, PublishStatus } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * A product's identity and a variant's commercial terms.
 *
 * Both reached the database from migration scripts and neither could be
 * changed from any screen afterwards, which is a strange thing for a shop: the
 * name it sells under, the brand, the URL, the price. One product had sat as a
 * draft for weeks because its price was zero — the publish gate refused it,
 * correctly, and there was no field anywhere that took a number.
 *
 * Every write here is audited with the row as it was, because every one of
 * them is either a public promise or a public URL.
 */
@Injectable()
export class CatalogEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- creating -------------------------------------------------------------

  /**
   * A new product, with the one variant that makes it a product.
   *
   * Both in a single transaction. A product with no variant has no price,
   * cannot be bought and cannot be published — it is a name, not a product —
   * and leaving one behind because the second call failed would put a thing in
   * the catalog that every screen afterwards has to make excuses for.
   *
   * Always a draft, and the first variant is a draft too. The publish gate
   * wants a title, a meta description, a hero image and 120 words; a product
   * born published is born broken in public.
   */
  async createProduct(
    input: CreateProduct,
    actorId: string | undefined,
  ): Promise<CreatedProduct> {
    const sku = normaliseSku(input.variant.sku);
    const [slugTaken, skuTaken] = await Promise.all([
      this.prisma.client.product.count({ where: { slug: input.slug } }),
      this.prisma.client.variant.count({ where: { sku } }),
    ]);
    if (slugTaken > 0) {
      throw new BadRequestException(
        say('هذا الرابط مستخدم لمنتج آخر.', 'Another product already has that URL.'),
      );
    }
    if (skuTaken > 0) {
      throw new BadRequestException(
        say('هذا الرمز مستخدم لمتغيّر آخر.', 'Another variant already has that SKU.'),
      );
    }
    if (input.categoryIds.length > 0) {
      const found = await this.prisma.client.category.count({
        where: { id: { in: input.categoryIds } },
      });
      if (found !== new Set(input.categoryIds).size) {
        throw new BadRequestException(say('قسم غير موجود.', 'One of those categories does not exist.'));
      }
    }

    const product = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          slug: input.slug,
          kind: input.kind,
          status: PublishStatus.DRAFT,
          ...(input.brandId ? { brandId: input.brandId } : {}),
          // The first category is the primary one unless somebody says
          // otherwise later: a product in exactly one section has an obvious
          // answer, and leaving it null means no breadcrumb at all.
          ...(input.categoryIds[0] ? { primaryCategoryId: input.categoryIds[0] } : {}),
          translations: {
            create: [
              { locale: Locale.AR, name: input.nameAr },
              ...(input.nameEn ? [{ locale: Locale.EN, name: input.nameEn }] : []),
            ],
          },
          ...(input.categoryIds.length > 0
            ? { categories: { create: input.categoryIds.map((categoryId) => ({ categoryId })) } }
            : {}),
        },
      });

      await tx.variant.create({
        data: {
          productId: created.id,
          sku,
          priceUsd: new Prisma.Decimal(input.variant.priceUsd),
          licensePeriodUnit: input.variant.licensePeriodUnit,
          // The same normalisation the edit form applies: a count beside
          // LIFETIME is a count of nothing.
          licensePeriodValue:
            input.variant.licensePeriodUnit === 'LIFETIME'
              ? null
              : (input.variant.licensePeriodValue ?? 1),
          deviceCount: input.variant.deviceCount,
          platform: input.variant.platform,
          activationMethod: input.variant.activationMethod,
          fulfillmentMode: input.variant.fulfillmentMode,
          // The only variant there is, so it is the one the page opens on.
          isDefault: true,
          status: PublishStatus.DRAFT,
        },
      });

      return created;
    });

    await this.audit.record({
      actorId,
      action: 'product.created',
      entity: 'Product',
      entityId: product.id,
      after: { slug: input.slug, sku, kind: input.kind, nameAr: input.nameAr },
    });

    return { slug: input.slug, sku };
  }

  /** A second variant on a product that already exists. */
  async createVariant(
    slug: string,
    input: CreateVariant,
    actorId: string | undefined,
  ): Promise<ProductTerms> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: { id: true, variants: { select: { position: true } } },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    const sku = normaliseSku(input.sku);
    const taken = await this.prisma.client.variant.count({ where: { sku } });
    if (taken > 0) {
      throw new BadRequestException(
        say('هذا الرمز مستخدم لمتغيّر آخر.', 'Another variant already has that SKU.'),
      );
    }

    const variant = await this.prisma.client.variant.create({
      data: {
        productId: product.id,
        sku,
        priceUsd: new Prisma.Decimal(input.priceUsd),
        licensePeriodUnit: input.licensePeriodUnit,
        licensePeriodValue:
          input.licensePeriodUnit === 'LIFETIME' ? null : (input.licensePeriodValue ?? 1),
        deviceCount: input.deviceCount,
        platform: input.platform,
        activationMethod: input.activationMethod,
        fulfillmentMode: input.fulfillmentMode,
        // Never the default: the product already has one, and silently moving
        // which variant a page opens on is not what "add" means.
        isDefault: false,
        position: product.variants.reduce((high, row) => Math.max(high, row.position), -1) + 1,
        status: PublishStatus.DRAFT,
      },
    });

    await this.audit.record({
      actorId,
      action: 'variant.created',
      entity: 'Variant',
      entityId: variant.id,
      after: { productSlug: slug, sku, priceUsd: input.priceUsd },
    });

    return this.terms(slug);
  }

  // --- identity -------------------------------------------------------------

  async identity(slug: string): Promise<ProductIdentity> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: {
        translations: true,
        categories: { select: { categoryId: true } },
        variants: { select: { _count: { select: { orderItems: true } } } },
      },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    const [brands, categories] = await Promise.all([
      this.prisma.client.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.client.category.findMany({
        select: { id: true, slug: true, translations: { where: { locale: Locale.AR }, select: { name: true } } },
        orderBy: { slug: 'asc' },
      }),
    ]);

    return {
      slug: product.slug,
      kind: product.kind,
      brandId: product.brandId,
      primaryCategoryId: product.primaryCategoryId,
      categoryIds: product.categories.map((row) => row.categoryId),
      hasGoldenWarranty: product.hasGoldenWarranty,
      nameAr: product.translations.find((t) => t.locale === Locale.AR)?.name ?? '',
      nameEn: product.translations.find((t) => t.locale === Locale.EN)?.name ?? '',
      brands,
      categories: categories.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.translations[0]?.name ?? row.slug,
      })),
      hasOrders: product.variants.some((variant) => variant._count.orderItems > 0),
    };
  }

  async setIdentity(
    slug: string,
    input: SetProductIdentity,
    actorId: string | undefined,
  ): Promise<ProductIdentity> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: { translations: true, categories: { select: { categoryId: true } } },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    if (input.slug && input.slug !== slug) {
      const taken = await this.prisma.client.product.count({ where: { slug: input.slug } });
      if (taken > 0) {
        throw new BadRequestException(
          say('هذا الرابط مستخدم لمنتج آخر.', 'Another product already has that URL.'),
        );
      }
    }

    // A category that does not exist would be accepted by the type and refused
    // by the foreign key, which surfaces as a 500 rather than a sentence.
    if (input.categoryIds && input.categoryIds.length > 0) {
      const found = await this.prisma.client.category.count({
        where: { id: { in: input.categoryIds } },
      });
      if (found !== new Set(input.categoryIds).size) {
        throw new BadRequestException(say('قسم غير موجود.', 'One of those categories does not exist.'));
      }
    }
    if (input.brandId) {
      const found = await this.prisma.client.brand.count({ where: { id: input.brandId } });
      if (found === 0) {
        throw new BadRequestException(say('علامة غير موجودة.', 'That brand does not exist.'));
      }
    }

    /*
     * The primary category has to be one the product is actually in.
     *
     * It is denormalised onto the product for breadcrumbs and the canonical
     * URL, so a primary category the product does not belong to produces a
     * breadcrumb to a page that does not list it.
     */
    const nextCategories = input.categoryIds ?? product.categories.map((row) => row.categoryId);
    const nextPrimary =
      input.primaryCategoryId === undefined ? product.primaryCategoryId : input.primaryCategoryId;
    if (nextPrimary && !nextCategories.includes(nextPrimary)) {
      throw new BadRequestException(
        say(
          'القسم الرئيسي يجب أن يكون أحد أقسام المنتج.',
          'The primary category has to be one the product is in.',
        ),
      );
    }

    const before = {
      slug: product.slug,
      kind: product.kind,
      brandId: product.brandId,
      primaryCategoryId: product.primaryCategoryId,
      categoryIds: product.categories.map((row) => row.categoryId),
      hasGoldenWarranty: product.hasGoldenWarranty,
      nameAr: product.translations.find((t) => t.locale === Locale.AR)?.name ?? '',
      nameEn: product.translations.find((t) => t.locale === Locale.EN)?.name ?? '',
    };

    await this.prisma.client.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: product.id },
        data: {
          ...(input.slug === undefined ? {} : { slug: input.slug }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.brandId === undefined ? {} : { brandId: input.brandId }),
          ...(input.primaryCategoryId === undefined
            ? {}
            : { primaryCategoryId: input.primaryCategoryId }),
          ...(input.hasGoldenWarranty === undefined
            ? {}
            : { hasGoldenWarranty: input.hasGoldenWarranty }),
        },
      });

      if (input.categoryIds) {
        await tx.productCategory.deleteMany({ where: { productId: product.id } });
        if (input.categoryIds.length > 0) {
          await tx.productCategory.createMany({
            data: input.categoryIds.map((categoryId) => ({ productId: product.id, categoryId })),
          });
        }
      }

      for (const [locale, name] of [
        [Locale.AR, input.nameAr],
        [Locale.EN, input.nameEn],
      ] as const) {
        if (name === undefined) continue;
        await tx.productTranslation.upsert({
          where: { productId_locale: { productId: product.id, locale } },
          update: { name },
          create: { productId: product.id, locale, name },
        });
      }

      /*
       * A renamed product is a redirect, never a dead end.
       *
       * Written in the same transaction as the rename, because the two are one
       * decision: the old URL is in Google, in a customer's email, and in
       * whatever the old store linked from. A slug change without this is the
       * one edit on this screen that silently destroys traffic, and the panel
       * cannot be relied on to remember it.
       */
      if (input.slug && input.slug !== slug) {
        const from = `/store/${slug}`;
        const to = `/store/${input.slug}`;
        await tx.redirect.upsert({
          where: { from },
          update: { to, code: 301, isActive: true },
          create: { from, to, code: 301, isActive: true, source: 'manual' },
        });
        // Anything that already pointed at the old URL now points past it, so
        // a rename twice over does not make a chain a crawler gives up on.
        await tx.redirect.updateMany({ where: { to: from }, data: { to } });
      }
    });

    await this.audit.record({
      actorId,
      action: 'product.identity_changed',
      entity: 'Product',
      entityId: product.id,
      before,
      after: { ...before, ...input },
    });

    return this.identity(input.slug ?? slug);
  }

  // --- commercial terms -----------------------------------------------------

  async terms(slug: string): Promise<ProductTerms> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: {
        variants: {
          orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
          include: {
            inventory: { select: { onHand: true } },
            _count: { select: { orderItems: true } },
          },
        },
      },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    return {
      productSlug: slug,
      variants: product.variants.map(
        (variant): VariantTerms => ({
          id: variant.id,
          sku: variant.sku,
          status: variant.status,
          isDefault: variant.isDefault,
          position: variant.position,
          // `toFixed(2)` rather than `toString()`: the panel shows these in an
          // input somebody edits, and "9.9" invites a reader to wonder whether
          // the cents were lost.
          priceUsd: variant.priceUsd.toFixed(2),
          compareAtUsd: variant.compareAtUsd?.toFixed(2) ?? null,
          costUsd: variant.costUsd?.toFixed(2) ?? null,
          licensePeriodValue: variant.licensePeriodValue,
          licensePeriodUnit: variant.licensePeriodUnit,
          deviceCount: variant.deviceCount,
          platform: variant.platform,
          activationMethod: variant.activationMethod,
          fulfillmentMode: variant.fulfillmentMode,
          deliverySlaSeconds: variant.deliverySlaSeconds,
          requiresActivationEmail: variant.requiresActivationEmail,
          warrantyDays: variant.warrantyDays,
          onHand: variant.inventory?.onHand ?? 0,
          orderCount: variant._count.orderItems,
        }),
      ),
    };
  }

  async setTerms(
    sku: string,
    input: SetVariantTerms,
    actorId: string | undefined,
  ): Promise<ProductTerms> {
    const variant = await this.prisma.client.variant.findUnique({
      where: { sku },
      include: { product: { select: { id: true, slug: true } } },
    });
    if (!variant) throw new NotFoundException(say('لا يوجد متغيّر بهذا الرمز.', 'No such variant.'));

    /*
     * The strike-through has to be a real one.
     *
     * The contract catches it when both numbers arrive together; this catches
     * the other half — one number sent against a stored other. Without it,
     * lowering `compareAtUsd` alone below the price produces a product page
     * advertising a discount that is an increase.
     */
    const nextPrice = input.priceUsd ?? variant.priceUsd.toFixed(2);
    const nextCompare =
      input.compareAtUsd === undefined
        ? (variant.compareAtUsd?.toFixed(2) ?? '')
        : input.compareAtUsd;
    if (nextCompare !== '' && Number(nextCompare) <= Number(nextPrice)) {
      throw new BadRequestException(
        say(
          'السعر قبل الخصم يجب أن يكون أعلى من السعر الحالي.',
          'The compare-at price has to be above the current price.',
        ),
      );
    }

    /*
     * A licence term is a number and a unit, or it is lifetime.
     *
     * "3" with unit LIFETIME is three of nothing, and "LIFETIME" with a count
     * renders as "lifetime for 3 years" on the product page. Normalised here
     * rather than refused, because the pairing is obvious in both directions
     * and there is nothing for a person to decide.
     */
    const nextUnit = input.licensePeriodUnit ?? variant.licensePeriodUnit;
    let nextValue =
      input.licensePeriodValue === undefined ? variant.licensePeriodValue : input.licensePeriodValue;
    if (nextUnit === 'LIFETIME') nextValue = null;
    else if (nextValue === null) nextValue = 1;

    const before = {
      priceUsd: variant.priceUsd.toFixed(2),
      compareAtUsd: variant.compareAtUsd?.toFixed(2) ?? null,
      costUsd: variant.costUsd?.toFixed(2) ?? null,
      licensePeriodValue: variant.licensePeriodValue,
      licensePeriodUnit: variant.licensePeriodUnit,
      deviceCount: variant.deviceCount,
      platform: variant.platform,
      activationMethod: variant.activationMethod,
      fulfillmentMode: variant.fulfillmentMode,
      deliverySlaSeconds: variant.deliverySlaSeconds,
      requiresActivationEmail: variant.requiresActivationEmail,
      warrantyDays: variant.warrantyDays,
      status: variant.status,
      isDefault: variant.isDefault,
    };

    const money = (value: string | undefined): Prisma.Decimal | null | undefined => {
      if (value === undefined) return undefined;
      return value === '' ? null : new Prisma.Decimal(value);
    };

    await this.prisma.client.$transaction(async (tx) => {
      // One default per product: the variant a product page opens on.
      if (input.isDefault === true) {
        await tx.variant.updateMany({
          where: { productId: variant.product.id, isDefault: true, id: { not: variant.id } },
          data: { isDefault: false },
        });
      }

      await tx.variant.update({
        where: { id: variant.id },
        data: {
          ...(input.priceUsd === undefined ? {} : { priceUsd: new Prisma.Decimal(input.priceUsd) }),
          ...(input.compareAtUsd === undefined ? {} : { compareAtUsd: money(input.compareAtUsd) }),
          ...(input.costUsd === undefined ? {} : { costUsd: money(input.costUsd) }),
          licensePeriodValue: nextValue,
          licensePeriodUnit: nextUnit,
          ...(input.deviceCount === undefined ? {} : { deviceCount: input.deviceCount }),
          ...(input.platform === undefined ? {} : { platform: input.platform }),
          ...(input.activationMethod === undefined
            ? {}
            : { activationMethod: input.activationMethod }),
          ...(input.fulfillmentMode === undefined
            ? {}
            : { fulfillmentMode: input.fulfillmentMode }),
          ...(input.deliverySlaSeconds === undefined
            ? {}
            : { deliverySlaSeconds: input.deliverySlaSeconds }),
          ...(input.requiresActivationEmail === undefined
            ? {}
            : { requiresActivationEmail: input.requiresActivationEmail }),
          ...(input.warrantyDays === undefined ? {} : { warrantyDays: input.warrantyDays }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        },
      });
    });

    await this.audit.record({
      actorId,
      action: 'variant.terms_changed',
      entity: 'Variant',
      entityId: variant.id,
      before,
      after: { sku, ...input, licensePeriodValue: nextValue, licensePeriodUnit: nextUnit },
    });

    return this.terms(variant.product.slug);
  }
}

/**
 * A SKU, as it is stored.
 *
 * The contract upper-cases too, and that guards exactly one door: a request
 * that came through the validation pipe. A SKU is the string somebody reads
 * off a supplier invoice and types into the fulfilment queue at two in the
 * morning, and `Office-365` and `OFFICE-365` existing as two variants is a
 * mistake that surfaces only once a key has gone to the wrong customer — so
 * the rule lives here as well, where the row is actually written.
 */
function normaliseSku(sku: string): string {
  return sku.trim().toUpperCase();
}
