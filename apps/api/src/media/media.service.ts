import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import type { AltText, PatchImage, ProductImage, ProductImages, UploadImage } from '@da/contracts';
import { Locale } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { UnreadableImageError, decodeDataUrl, processImage } from './image.js';
import { StorageNotConfiguredError, publicUrl, put, storage } from './storage.js';

/**
 * Product images.
 *
 * Until this existed the only way a picture reached the catalog was a script
 * that read the WordPress backup, which is why twenty of seventy-two products
 * have none: there was no second way, and there was never going to be a second
 * WordPress backup.
 *
 * Two rules shape the whole file.
 *
 * Bytes are content-addressed and immutable. The object key is the SHA-256 of
 * the processed image, so uploading the same picture twice finds the Asset row
 * that is already there and adds a second ProductMedia pointing at it. Nothing
 * ever overwrites an object, which is what lets the bucket be served with
 * `immutable` and a year-long cache.
 *
 * Deleting an image detaches it, and does not delete the file. The Asset may
 * be on another product, the bytes cannot be edited in place, and an orphaned
 * object costs a fraction of a cent where a broken image costs a sale.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Why uploading cannot work right now, or null. Checked before it is offered. */
  private uploadBlocked(): string | null {
    try {
      storage();
      return null;
    } catch (error) {
      return error instanceof StorageNotConfiguredError ? error.message : 'تخزين الصور لا يستجيب.';
    }
  }

  async list(slug: string): Promise<ProductImages> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: {
        id: true,
        variants: { select: { id: true, sku: true }, orderBy: { position: 'asc' } },
      },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    return {
      productSlug: slug,
      images: await this.imagesOf(product.id),
      variants: product.variants,
      uploadBlocked: this.uploadBlocked(),
    };
  }

  /**
   * The rows for one product, in the order the storefront will show them.
   *
   * `usedByProducts` is counted per asset rather than derived on the client,
   * because it changes what "delete" means: on a shared picture the button
   * removes it from this product only, and the panel has to be able to say so
   * before somebody presses it.
   */
  private async imagesOf(productId: string): Promise<ProductImage[]> {
    const store = (() => {
      try {
        return storage();
      } catch {
        return null;
      }
    })();

    const rows = await this.prisma.client.productMedia.findMany({
      where: { productId },
      orderBy: [{ isHero: 'desc' }, { position: 'asc' }],
      include: {
        variant: { select: { sku: true } },
        asset: {
          include: {
            alts: true,
            _count: { select: { productMedia: true } },
          },
        },
      },
    });

    return rows.map((row) => {
      const alt: AltText = {
        ar: row.asset.alts.find((entry) => entry.locale === Locale.AR)?.alt ?? '',
        en: row.asset.alts.find((entry) => entry.locale === Locale.EN)?.alt ?? '',
      };
      return {
        id: row.id,
        assetId: row.assetId,
        // Without storage configured the key is all there is; a relative value
        // is still better than a broken absolute one, and the panel already
        // says uploading is off.
        url: store ? publicUrl(store, row.asset.key) : `/${row.asset.key}`,
        width: row.asset.width,
        height: row.asset.height,
        bytes: row.asset.bytes,
        alt,
        isHero: row.isHero,
        position: row.position,
        variantId: row.variantId,
        variantSku: row.variant?.sku ?? null,
        usedByProducts: row.asset._count.productMedia,
        createdAt: row.asset.createdAt.toISOString(),
      };
    });
  }

  async upload(slug: string, input: UploadImage, actorId: string | undefined): Promise<ProductImages> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: { id: true, media: { select: { id: true, position: true } } },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    if (input.variantId) {
      const owns = await this.prisma.client.variant.count({
        where: { id: input.variantId, productId: product.id },
      });
      if (owns === 0) {
        throw new BadRequestException(
          say('هذا المتغيّر لا ينتمي لهذا المنتج.', 'That variant is not on this product.'),
        );
      }
    }

    let processed;
    try {
      processed = await processImage(decodeDataUrl(input.dataUrl));
    } catch (error) {
      if (error instanceof UnreadableImageError) throw new BadRequestException(error.message);
      throw error;
    }

    const store = storage();

    // The object first, the rows second. A row pointing at bytes that are not
    // there is a broken image on a live page; bytes with no row are invisible
    // and cost nothing.
    const existing = await this.prisma.client.asset.findUnique({
      where: { key: processed.key },
      select: { id: true },
    });
    if (!existing) {
      await put(store, processed.key, processed.bytes, processed.mime);
    }

    const asset =
      (await this.prisma.client.asset.findUnique({ where: { key: processed.key } })) ??
      (await this.prisma.client.asset.create({
        data: {
          key: processed.key,
          mime: processed.mime,
          bytes: processed.bytes.byteLength,
          width: processed.width,
          height: processed.height,
          checksum: processed.checksum,
        },
      }));

    if (input.alt) await this.writeAlt(asset.id, input.alt);

    // First picture of a product with none is the hero whether or not anybody
    // asked: a product page needs one, and the alternative is a catalog of
    // images where none is chosen.
    const hero = input.isHero || product.media.length === 0;
    if (hero) {
      await this.prisma.client.productMedia.updateMany({
        where: { productId: product.id, isHero: true },
        data: { isHero: false },
      });
    }

    const nextPosition =
      product.media.reduce((highest, row) => Math.max(highest, row.position), -1) + 1;

    /*
     * The same picture may already be on this product, and re-uploading it
     * must not produce a second copy of the same row.
     *
     * Found by query rather than by `upsert` on the compound unique, because
     * that key includes `variantId` and a product-level image is the row whose
     * `variantId` is NULL — and Postgres treats NULLs as distinct, so the
     * index does not constrain those at all. The schema says so where it is
     * declared; the partial index that does constrain them lives in the
     * migration, where Prisma cannot see it either. So the check is explicit.
     */
    const already = await this.prisma.client.productMedia.findFirst({
      where: {
        productId: product.id,
        assetId: asset.id,
        variantId: input.variantId ?? null,
      },
      select: { id: true },
    });

    const media = already
      ? await this.prisma.client.productMedia.update({
          where: { id: already.id },
          data: { isHero: hero },
        })
      : await this.prisma.client.productMedia.create({
          data: {
            productId: product.id,
            assetId: asset.id,
            variantId: input.variantId ?? null,
            isHero: hero,
            position: nextPosition,
          },
        });

    await this.audit.record({
      actorId,
      action: 'product.image_added',
      entity: 'ProductMedia',
      entityId: media.id,
      // The filename, never the bytes: an audit row is a record that somebody
      // did something, not a second copy of what they did it to.
      after: {
        productSlug: slug,
        assetKey: processed.key,
        filename: input.filename ?? null,
        sourceBytes: processed.sourceBytes,
        storedBytes: processed.bytes.byteLength,
        reused: existing !== null,
      },
    });

    this.logger.log(
      `${slug}: image ${processed.key} (${String(Math.round(processed.sourceBytes / 1024))}kB in, ${String(Math.round(processed.bytes.byteLength / 1024))}kB stored)`,
    );

    return this.list(slug);
  }

  async patch(mediaId: string, input: PatchImage, actorId: string | undefined): Promise<ProductImages> {
    const media = await this.prisma.client.productMedia.findUnique({
      where: { id: mediaId },
      select: { id: true, productId: true, product: { select: { slug: true } } },
    });
    if (!media) throw new NotFoundException(say('لا توجد هذه الصورة.', 'No such image.'));

    if (input.variantId !== undefined && input.variantId !== null) {
      const owns = await this.prisma.client.variant.count({
        where: { id: input.variantId, productId: media.productId },
      });
      if (owns === 0) {
        throw new BadRequestException(
          say('هذا المتغيّر لا ينتمي لهذا المنتج.', 'That variant is not on this product.'),
        );
      }
    }

    // One hero per product, enforced here rather than by a constraint: the
    // schema allows several and the panel must never produce them.
    if (input.isHero === true) {
      await this.prisma.client.productMedia.updateMany({
        where: { productId: media.productId, isHero: true, id: { not: mediaId } },
        data: { isHero: false },
      });
    }

    if (input.alt) {
      const row = await this.prisma.client.productMedia.findUniqueOrThrow({
        where: { id: mediaId },
        select: { assetId: true },
      });
      await this.writeAlt(row.assetId, input.alt);
    }

    await this.prisma.client.productMedia.update({
      where: { id: mediaId },
      data: {
        ...(input.isHero === undefined ? {} : { isHero: input.isHero }),
        ...(input.position === undefined ? {} : { position: input.position }),
        ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
      },
    });

    await this.audit.record({
      actorId,
      action: 'product.image_changed',
      entity: 'ProductMedia',
      entityId: mediaId,
      after: {
        productSlug: media.product.slug,
        ...(input.isHero === undefined ? {} : { isHero: input.isHero }),
        ...(input.position === undefined ? {} : { position: input.position }),
        ...(input.variantId === undefined ? {} : { variantId: input.variantId }),
        ...(input.alt ? { altWritten: true } : {}),
      },
    });

    return this.list(media.product.slug);
  }

  /** A whole new order, applied in one transaction so no two rows collide. */
  async reorder(slug: string, ids: string[], actorId: string | undefined): Promise<ProductImages> {
    const product = await this.prisma.client.product.findUnique({
      where: { slug },
      select: { id: true, media: { select: { id: true } } },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));

    const owned = new Set(product.media.map((row) => row.id));
    const unknown = ids.filter((id) => !owned.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        say('الترتيب يذكر صوراً ليست على هذا المنتج.', 'The order names images not on this product.'),
      );
    }

    await this.prisma.client.$transaction(
      ids.map((id, index) =>
        this.prisma.client.productMedia.update({ where: { id }, data: { position: index } }),
      ),
    );

    await this.audit.record({
      actorId,
      action: 'product.images_reordered',
      entity: 'Product',
      entityId: product.id,
      after: { productSlug: slug, count: ids.length },
    });

    return this.list(slug);
  }

  /**
   * Detaches a picture from a product.
   *
   * The Asset and the object stay. If the removed row was the hero and another
   * picture remains, the next one becomes the hero — leaving a product with
   * images and no hero would pass every check and show nothing.
   */
  async remove(mediaId: string, actorId: string | undefined): Promise<ProductImages> {
    const media = await this.prisma.client.productMedia.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        isHero: true,
        position: true,
        variantId: true,
        assetId: true,
        productId: true,
        asset: { select: { key: true } },
        product: { select: { slug: true } },
      },
    });
    if (!media) throw new NotFoundException(say('لا توجد هذه الصورة.', 'No such image.'));

    await this.prisma.client.productMedia.delete({ where: { id: mediaId } });

    if (media.isHero) {
      const next = await this.prisma.client.productMedia.findFirst({
        where: { productId: media.productId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      if (next) {
        await this.prisma.client.productMedia.update({
          where: { id: next.id },
          data: { isHero: true },
        });
      }
    }

    /*
     * `before`, not `after`: a delete has no after.
     *
     * This recorded only the slug and the asset id, and the first time a row
     * was removed by mistake that was not enough to put it back — the position
     * and the hero flag had to be inferred from what was left, which is
     * guesswork about content somebody paid for. An audit row for a deletion
     * whose whole purpose is reconstruction has to carry the row.
     */
    await this.audit.record({
      actorId,
      action: 'product.image_removed',
      entity: 'ProductMedia',
      entityId: mediaId,
      before: {
        productSlug: media.product.slug,
        productId: media.productId,
        assetId: media.assetId,
        assetKey: media.asset.key,
        variantId: media.variantId,
        isHero: media.isHero,
        position: media.position,
      },
    });

    return this.list(media.product.slug);
  }

  /** Alt text per locale, on the asset, because it describes the picture. */
  private async writeAlt(assetId: string, alt: AltText): Promise<void> {
    for (const [locale, text] of [
      [Locale.AR, alt.ar],
      [Locale.EN, alt.en],
    ] as const) {
      if (text.trim() === '') {
        await this.prisma.client.assetAlt.deleteMany({ where: { assetId, locale } });
        continue;
      }
      await this.prisma.client.assetAlt.upsert({
        where: { assetId_locale: { assetId, locale } },
        update: { alt: text.trim() },
        create: { assetId, locale, alt: text.trim() },
      });
    }
  }
}
