import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AdminProductList,
  type AdminProductQuery,
  type AdminProductRow,
  type Readiness,
} from '@da/contracts';
import { Locale, type Prisma, PublishStatus, StockMovementReason } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { assessProduct } from './readiness.js';

/**
 * The admin API.
 *
 * Two kinds of message come out of here, and they follow different rules.
 * A readiness *detail* describes content in a particular locale and is written
 * in that locale, because "the English description is 40 words" belongs with
 * the English page. An operational refusal — not ready to publish, no such
 * SKU, stock below what carts hold — is panel chrome, and the panel is Arabic
 * for an Arabic-speaking team, so those are Arabic regardless of which
 * locale's content is being edited.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private localeFor(query: { locale: string }): Locale {
    return query.locale === 'en' ? Locale.EN : Locale.AR;
  }

  private readonly include = {
    translations: true,
    brand: true,
    variants: { include: { inventory: true } },
    media: { select: { id: true } },
    categories: { where: { isPrimary: true }, include: { category: true } },
  } satisfies Prisma.ProductInclude;

  async list(query: AdminProductQuery): Promise<AdminProductList> {
    const locale = this.localeFor(query);

    const search: Prisma.ProductWhereInput = query.q
      ? {
          OR: [
            { slug: { contains: query.q, mode: 'insensitive' } },
            { translations: { some: { name: { contains: query.q, mode: 'insensitive' } } } },
            { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
          ],
        }
      : {};

    // "blocked" and "out-of-stock" cannot be expressed as a database filter:
    // readiness is computed and stock is a sum across variants. Those two views
    // filter after loading, which is affordable on a catalog this size and
    // honest about what it is doing.
    const statusWhere: Prisma.ProductWhereInput =
      query.status === 'draft'
        ? { status: PublishStatus.DRAFT }
        : query.status === 'published'
          ? { status: PublishStatus.PUBLISHED }
          : {};

    const where: Prisma.ProductWhereInput = { AND: [search, statusWhere] };
    const postFilter = query.status === 'blocked' || query.status === 'out-of-stock';

    const products = await this.prisma.client.product.findMany({
      where,
      orderBy: [{ status: 'asc' }, { slug: 'asc' }],
      ...(postFilter ? {} : { skip: (query.page - 1) * query.perPage, take: query.perPage }),
      include: this.include,
    });

    let rows = products.map((product) => this.toRow(product, locale));

    if (query.status === 'blocked') rows = rows.filter((row) => row.blockers > 0);
    if (query.status === 'out-of-stock') rows = rows.filter((row) => row.stock === 0);

    const total = postFilter ? rows.length : await this.prisma.client.product.count({ where });

    if (postFilter) {
      rows = rows.slice((query.page - 1) * query.perPage, query.page * query.perPage);
    }

    return {
      rows,
      total,
      page: query.page,
      perPage: query.perPage,
      counts: await this.counts(locale, search),
    };
  }

  /**
   * The chips are filters as well as figures, so they count within the current
   * search rather than across the whole catalog — "39 blocked" next to three
   * search results would be a number nothing on screen agrees with.
   */
  private async counts(
    locale: Locale,
    search: Prisma.ProductWhereInput,
  ): Promise<AdminProductList['counts']> {
    const all = await this.prisma.client.product.findMany({
      where: search,
      include: this.include,
    });
    const rows = all.map((product) => this.toRow(product, locale));

    return {
      all: rows.length,
      draft: rows.filter((row) => row.status === 'DRAFT').length,
      published: rows.filter((row) => row.status === 'PUBLISHED').length,
      outOfStock: rows.filter((row) => row.stock === 0).length,
      blocked: rows.filter((row) => row.blockers > 0).length,
    };
  }

  private toRow(
    product: Prisma.ProductGetPayload<{ include: AdminService['include'] }>,
    locale: Locale,
  ): AdminProductRow {
    const readiness = assessProduct(product, locale);
    const ar = product.translations.find((entry) => entry.locale === Locale.AR);
    const en = product.translations.find((entry) => entry.locale === Locale.EN);

    const prices = product.variants.map((variant) => variant.priceUsd);
    const cheapest = prices.length
      ? prices.reduce((low, price) => (price.lessThan(low) ? price : low))
      : null;

    return {
      slug: product.slug,
      nameAr: ar?.name ?? product.slug,
      nameEn: en?.name ?? null,
      status: product.status,
      kind: product.kind,
      brand: product.brand?.name ?? null,
      primaryCategory: product.categories[0]?.category.slug ?? null,
      variantCount: product.variants.length,
      stock: product.variants.reduce(
        (total, variant) => total + (variant.inventory?.onHand ?? 0),
        0,
      ),
      priceFromUsd: cheapest?.toFixed(2) ?? null,
      hasGoldenWarranty: product.hasGoldenWarranty,
      salesCount: product.salesCount,
      imageCount: product.media.length,
      blockers: readiness.checks.filter((check) => check.severity === 'blocker' && !check.passed)
        .length,
      warnings: readiness.checks.filter((check) => check.severity === 'warning' && !check.passed)
        .length,
    };
  }

  async readiness(slug: string, locale: string): Promise<Readiness> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: this.include,
    });
    if (!product) throw new NotFoundException(`لا يوجد منتج بالرابط "${slug}"`);
    return assessProduct(product, this.localeFor({ locale }));
  }

  /**
   * Publishing refuses while a blocker stands, and says which.
   *
   * Variants are published with the product: a published product whose variants
   * are all drafts renders as "nothing to buy", which is the state the legacy
   * store's highest-traffic page was in.
   */
  async setStatus(
    slug: string,
    status: PublishStatus,
    locale: string,
    actorId: string,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ status: PublishStatus; readiness: Readiness }> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      include: this.include,
    });
    if (!product) throw new NotFoundException(`لا يوجد منتج بالرابط "${slug}"`);

    const readiness = assessProduct(product, this.localeFor({ locale }));

    if (status === PublishStatus.PUBLISHED && !readiness.publishable) {
      const blockers = readiness.checks
        .filter((check) => check.severity === 'blocker' && !check.passed)
        .map((check) => check.detail);
      throw new BadRequestException({
        message: 'هذا المنتج غير جاهز للنشر.',
        blockers,
      });
    }

    const updated = await this.prisma.client.product.update({
      where: { id: product.id },
      data: {
        status,
        publishedAt:
          status === PublishStatus.PUBLISHED ? (product.publishedAt ?? new Date()) : null,
        seoReady: readiness.publishable,
      },
    });

    await this.prisma.client.variant.updateMany({
      where: { productId: product.id },
      data: { status },
    });

    await this.audit.record({
      actorId,
      entity: 'Product',
      entityId: product.id,
      action: `product.status.${status.toLowerCase()}`,
      before: { status: product.status },
      after: { status },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return { status: updated.status, readiness };
  }

  /**
   * Sets stock, and records the change as a movement.
   *
   * The counter alone cannot answer "where did that key go", which is the
   * question that matters when a licence is missing. Every adjustment therefore
   * writes an immutable StockMovement row with a stated reason.
   */
  async setInventory(
    sku: string,
    onHand: number,
    reason: StockMovementReason,
    note: string | undefined,
    actorId: string,
    context: { ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<{ sku: string; onHand: number; reserved: number }> {
    const variant = await this.prisma.client.variant.findUnique({
      where: { sku },
      include: { inventory: true },
    });
    if (!variant) throw new NotFoundException(`لا يوجد متغيّر بالرمز "${sku}"`);

    const previous = variant.inventory?.onHand ?? 0;
    const reserved = variant.inventory?.reserved ?? 0;

    if (onHand < reserved) {
      throw new BadRequestException(
        `${String(reserved)} من هذا المتغيّر محجوزة في سلات قيد الشراء، فلا يمكن أن ينزل المخزون دون هذا الرقم.`,
      );
    }

    const level = await this.prisma.client.inventoryLevel.upsert({
      where: { variantId: variant.id },
      update: { onHand },
      create: { variantId: variant.id, onHand },
    });

    if (onHand !== previous) {
      await this.prisma.client.stockMovement.create({
        data: {
          variantId: variant.id,
          delta: onHand - previous,
          reason,
          actorId,
          note: note ?? null,
        },
      });
    }

    await this.audit.record({
      actorId,
      entity: 'Variant',
      entityId: variant.id,
      action: 'inventory.set',
      before: { onHand: previous },
      after: { onHand, reason, note: note ?? null },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return { sku: variant.sku, onHand: level.onHand, reserved: level.reserved };
  }
}
