import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ApplySupplierPrices,
  type ApplySupplierPricesResult,
  type SetSupplierLink,
  type SetSupplierSource,
  type SupplierItemFilter,
  type SupplierItems,
  type SupplierItemsQuery,
  type SupplierLog,
  type SupplierMapping,
  type SupplierMappingQuery,
  type SupplierMappingRow,
  type SupplierPriceRow,
  type SupplierPrices,
  type SupplierSourceView,
  parseSheetUrl,
  supplierSkipKey,
  supplierSkipListSchema,
} from '@da/contracts';
import { Locale, Prisma, type SupplierRounding, refreshProductPrice } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { panelLocale, say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { nameSimilarity } from './names.js';
import { isLargeChange, priceChange, proposePrice } from './pricing.js';
import { SupplierSyncService } from './supplier-sync.service.js';

/** How recent a change has to be for the line to count as "changed". */
const CHANGED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Actor = { staffId: string; ip?: string | undefined; userAgent?: string | undefined };

/**
 * The admin side of the supplier sheet: its settings, what was read, the
 * variant links, and the price proposals.
 *
 * One source for now (the screens show one sheet); the tables already allow
 * more.
 */
@Injectable()
export class SupplierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sync: SupplierSyncService,
  ) {}

  // --- source ---------------------------------------------------------------

  private async primary() {
    return this.prisma.client.supplierSource.findFirst({ orderBy: { createdAt: 'asc' } });
  }

  private async requirePrimary() {
    const source = await this.primary();
    if (!source) {
      throw new NotFoundException(
        say(
          'لم يُربط شيت المورّد بعد. الصق الرابط في الإعدادات أولاً.',
          'No supplier sheet is connected yet.',
        ),
      );
    }
    return source;
  }

  async source(): Promise<SupplierSourceView | null> {
    const source = await this.primary();
    if (!source) return null;
    return {
      id: source.id,
      name: source.name,
      spreadsheetId: source.spreadsheetId,
      sheetGid: source.sheetGid,
      url: `https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${String(source.sheetGid)}`,
      markupPercent: source.markupPercent.toFixed(2),
      rounding: source.rounding,
      autoSync: source.autoSync,
      lastSyncAt: source.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: source.lastSyncStatus,
      lastSyncError: source.lastSyncError,
      sheetUpdatedLabel: source.sheetUpdatedLabel,
      readerConfigured: Boolean(process.env.GOOGLE_SHEETS_API_KEY),
    };
  }

  async setSource(input: SetSupplierSource, actor: Actor): Promise<SupplierSourceView> {
    const parsed = parseSheetUrl(input.url);
    if (!parsed)
      throw new BadRequestException(say('رابط الشيت غير صالح.', 'Not a Google Sheet link.'));
    const existing = await this.primary();

    // Pointing the source at a different sheet would leave every link
    // attached to lines of the old one. Refused rather than silently
    // orphaning the mapping a person spent an afternoon on.
    if (
      existing &&
      (existing.spreadsheetId !== parsed.spreadsheetId || existing.sheetGid !== parsed.sheetGid)
    ) {
      const links = await this.prisma.client.variantSupplierLink.count({
        where: { item: { sourceId: existing.id } },
      });
      if (links > 0) {
        throw new BadRequestException(
          say(
            `هذا شيت مختلف، وهناك ${String(links)} ربطاً على الشيت الحالي. احذف الروابط أولاً إن كنت تريد تغيير الشيت.`,
            `That is a different sheet and ${String(links)} variants are linked to the current one. Remove the links first.`,
          ),
        );
      }
    }

    const data = {
      name: input.name,
      spreadsheetId: parsed.spreadsheetId,
      sheetGid: parsed.sheetGid,
      markupPercent: new Prisma.Decimal(input.markupPercent),
      rounding: input.rounding,
      autoSync: input.autoSync,
    };
    const saved = existing
      ? await this.prisma.client.supplierSource.update({ where: { id: existing.id }, data })
      : await this.prisma.client.supplierSource.create({ data });

    await this.audit.record({
      actorId: actor.staffId,
      entity: 'SupplierSource',
      entityId: saved.id,
      action: existing ? 'supplier.source_changed' : 'supplier.source_created',
      before: existing
        ? {
            spreadsheetId: existing.spreadsheetId,
            sheetGid: existing.sheetGid,
            markupPercent: existing.markupPercent.toFixed(2),
            rounding: existing.rounding,
            autoSync: existing.autoSync,
          }
        : undefined,
      after: { ...data, markupPercent: data.markupPercent.toFixed(2) },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    const view = await this.source();
    if (!view) throw new Error('supplier source vanished after save');
    return view;
  }

  async syncNow(actor: Actor, force = false) {
    const source = await this.requirePrimary();
    if (force) {
      await this.audit.record({
        actorId: actor.staffId,
        entity: 'SupplierSource',
        entityId: source.id,
        action: 'supplier.sync_forced',
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
    return this.sync.sync(source.id, actor.staffId, { force });
  }

  // --- items ----------------------------------------------------------------

  async items(query: SupplierItemsQuery): Promise<SupplierItems> {
    const source = await this.primary();
    const empty = { all: 0, linked: 0, unlinked: 0, out: 0, missing: 0, nocost: 0, changed: 0 };
    if (!source) return { items: [], counts: empty };

    const since = new Date(Date.now() - CHANGED_WINDOW_MS);
    const rows = await this.prisma.client.supplierItem.findMany({
      where: { sourceId: source.id },
      orderBy: [{ missingSince: { sort: 'asc', nulls: 'first' } }, { rowNumber: 'asc' }],
      include: {
        links: {
          select: {
            variantId: true,
            variant: { select: { sku: true, product: { select: { slug: true } } } },
          },
        },
        changes: {
          where: { createdAt: { gte: since }, kind: { not: 'ADDED' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    const matches: Record<SupplierItemFilter, (row: (typeof rows)[number]) => boolean> = {
      all: () => true,
      linked: (row) => row.links.length > 0,
      unlinked: (row) => row.links.length === 0 && !row.missingSince,
      out: (row) => row.outOfStock && !row.missingSince,
      missing: (row) => row.missingSince !== null,
      nocost: (row) => row.costUsd === null && !row.missingSince,
      changed: (row) => row.changes.length > 0,
    };
    const counts = { ...empty };
    for (const key of Object.keys(matches) as SupplierItemFilter[]) {
      counts[key] = rows.filter(matches[key]).length;
    }

    const needle = query.q?.toLowerCase();
    const items = rows
      .filter(matches[query.filter])
      .filter(
        (row) =>
          !needle ||
          row.nameKey.includes(needle) ||
          (row.category ?? '').toLowerCase().includes(needle),
      )
      .map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        costUsd: row.costUsd?.toFixed(2) ?? null,
        priceText: row.priceText,
        warranty: row.warranty,
        remarks: row.remarks,
        outOfStock: row.outOfStock,
        partialStrike: row.partialStrike,
        wholesaleOnly: row.wholesaleOnly,
        rowNumber: row.rowNumber,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        missingSince: row.missingSince?.toISOString() ?? null,
        changedAt: row.changes[0]?.createdAt.toISOString() ?? null,
        links: row.links.map((link) => ({
          variantId: link.variantId,
          sku: link.variant.sku,
          productSlug: link.variant.product.slug,
        })),
      }));
    return { items, counts };
  }

  // --- log ------------------------------------------------------------------

  async log(query: { itemId?: string | undefined; limit: number }): Promise<SupplierLog> {
    const source = await this.primary();
    if (!source) return { snapshots: [], changes: [], actions: [] };

    const [snapshots, changes, actions] = await Promise.all([
      this.prisma.client.supplierSnapshot.findMany({
        where: { sourceId: source.id },
        orderBy: { fetchedAt: 'desc' },
        take: 50,
      }),
      this.prisma.client.supplierItemChange.findMany({
        where: {
          item: { sourceId: source.id },
          ...(query.itemId ? { itemId: query.itemId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        include: { item: { select: { name: true } } },
      }),
      this.prisma.client.auditLog.findMany({
        where: {
          action: {
            in: [
              'supplier.source_created',
              'supplier.source_changed',
              'supplier.link_set',
              'supplier.link_removed',
              'supplier.sync_forced',
              'supplier.variant_skipped',
              'supplier.variant_unskipped',
              'variant.supplier_price_applied',
              'variant.supplier_stock',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        include: { actor: { select: { email: true, name: true } } },
      }),
    ]);

    return {
      snapshots: snapshots.map((row) => ({
        id: row.id,
        fetchedAt: row.fetchedAt.toISOString(),
        status: row.status,
        error: row.error,
        sheetUpdatedLabel: row.sheetUpdatedLabel,
        rowCount: row.rowCount,
        added: row.added,
        changed: row.changed,
        removed: row.removed,
        stockSwitched: row.stockSwitched,
        manual: row.triggeredById !== null,
      })),
      changes: changes.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        itemId: row.itemId,
        itemName: row.item.name,
        kind: row.kind,
        before: row.before,
        after: row.after,
      })),
      actions: actions.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        action: row.action,
        actor: row.actor?.name ?? null,
        entityId: row.entityId,
        before: row.before,
        after: row.after,
      })),
    };
  }

  // --- mapping --------------------------------------------------------------

  async mapping(query: SupplierMappingQuery): Promise<SupplierMapping> {
    const source = await this.primary();
    const skippedIds = source ? await this.skipped(source.id) : new Set<string>();
    const [variants, items] = await Promise.all([
      this.prisma.client.variant.findMany({
        orderBy: [{ product: { slug: 'asc' } }, { position: 'asc' }],
        include: {
          product: {
            select: { slug: true, translations: { select: { locale: true, name: true } } },
          },
          supplierLink: { include: { item: true } },
        },
      }),
      source
        ? this.prisma.client.supplierItem.findMany({
            where: { sourceId: source.id, missingSince: null },
          })
        : Promise.resolve([]),
    ]);

    const ref = (item: (typeof items)[number]) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      costUsd: item.costUsd?.toFixed(2) ?? null,
      outOfStock: item.outOfStock,
      missingSince: item.missingSince?.toISOString() ?? null,
    });

    const rows: SupplierMappingRow[] = variants.map((variant) => {
      const ar = variant.product.translations.find((t) => t.locale === Locale.AR)?.name;
      const en = variant.product.translations.find((t) => t.locale === Locale.EN)?.name;
      const link = variant.supplierLink;
      const broken = link !== null && link.item.missingSince !== null;
      // Matched against the English name: the sheet is in English.
      const probe = `${en ?? ar ?? variant.product.slug} ${String(variant.deviceCount)} PC ${termsEn(variant)}`;
      const suggestions =
        (link === null || broken) && !skippedIds.has(variant.id)
          ? items
              .map((item) => ({ item, score: nameSimilarity(probe, item.name) }))
              .sort((a, b) => b.score - a.score)
              .slice(0, 3)
              .filter((entry) => entry.score > 0.2)
              .map((entry) => ({ ...ref(entry.item), score: Math.round(entry.score * 100) / 100 }))
          : [];
      return {
        variantId: variant.id,
        sku: variant.sku,
        productSlug: variant.product.slug,
        // In the panel's language, falling back to the other one.
        productName: (panelLocale() === 'en' ? (en ?? ar) : (ar ?? en)) ?? variant.product.slug,
        terms: terms(variant),
        priceUsd: variant.priceUsd.toFixed(2),
        supplierOutOfStock: variant.supplierOutOfStock,
        skipped: skippedIds.has(variant.id),
        link: link
          ? {
              item: {
                id: link.item.id,
                name: link.item.name,
                category: link.item.category,
                costUsd: link.item.costUsd?.toFixed(2) ?? null,
                outOfStock: link.item.outOfStock,
                missingSince: link.item.missingSince?.toISOString() ?? null,
              },
              markupPercent: link.markupPercent?.toFixed(2) ?? null,
              followStock: link.followStock,
            }
          : null,
        suggestions,
      };
    });

    const isBroken = (row: SupplierMappingRow) => row.link?.item.missingSince != null;
    // A skipped variant is not this supplier's: it leaves every list but its own.
    const active = rows.filter((row) => !row.skipped);
    const counts = {
      all: active.length,
      linked: active.filter((row) => row.link && !isBroken(row)).length,
      unlinked: active.filter((row) => !row.link).length,
      broken: active.filter(isBroken).length,
      skipped: rows.length - active.length,
    };
    const needle = query.q?.toLowerCase();
    const filtered = (query.filter === 'skipped' ? rows.filter((row) => row.skipped) : active)
      .filter((row) =>
        query.filter === 'linked'
          ? row.link !== null && !isBroken(row)
          : query.filter === 'unlinked'
            ? row.link === null
            : query.filter === 'broken'
              ? isBroken(row)
              : true,
      )
      .filter(
        (row) =>
          !needle ||
          row.productName.toLowerCase().includes(needle) ||
          row.productSlug.includes(needle) ||
          row.sku.toLowerCase().includes(needle) ||
          (row.link?.item.name.toLowerCase().includes(needle) ?? false),
      );
    return { rows: filtered, counts };
  }

  // --- skipping ---------------------------------------------------------------

  /** The variants marked as not sold by this source. */
  private async skipped(sourceId: string): Promise<Set<string>> {
    const row = await this.prisma.client.setting.findUnique({
      where: { key: supplierSkipKey(sourceId) },
    });
    const parsed = supplierSkipListSchema.safeParse(row?.value ?? []);
    return new Set(parsed.success ? parsed.data : []);
  }

  /**
   * Marks a variant as not sold by this supplier, or puts it back. A linked
   * variant is refused: it plainly is this supplier's, and skipping it would
   * hide a link that still drives its price and availability.
   */
  async setSkipped(variantId: string, skip: boolean, actor: Actor): Promise<SupplierMappingRow> {
    const source = await this.requirePrimary();
    const variant = await this.prisma.client.variant.findUnique({
      where: { id: variantId },
      select: { id: true, sku: true, supplierLink: { select: { id: true } } },
    });
    if (!variant)
      throw new NotFoundException(say('لا يوجد متغيّر بهذا المعرّف.', 'No such variant.'));
    if (skip && variant.supplierLink) {
      throw new BadRequestException(
        say(
          'هذا المتغيّر مربوط بسطر في الشيت. فك الربط أولاً إن كان لا يُشترى من هذا المورّد.',
          'This variant is linked to a sheet line. Unlink it first if it is not bought from this supplier.',
        ),
      );
    }
    // Read, change and write the list under a row lock, so two skips at the
    // same moment cannot each write a list without the other's (REV-0169).
    const key = supplierSkipKey(source.id);
    const changed = await this.prisma.client.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key }, update: {}, create: { key, value: [] } });
      await tx.$queryRaw`SELECT "key" FROM "public"."Setting" WHERE "key" = ${key} FOR UPDATE`;
      const row = await tx.setting.findUnique({ where: { key } });
      const parsed = supplierSkipListSchema.safeParse(row?.value ?? []);
      // A list that no longer reads is not rewritten from empty: that would
      // put every skipped variant back without anyone asking.
      if (!parsed.success) {
        throw new BadRequestException(
          say(
            'تعذّرت قراءة قائمة المتخطّاة المحفوظة، فلم يُغيَّر شيء.',
            'The saved skipped list could not be read, so nothing was changed.',
          ),
        );
      }
      const ids = new Set(parsed.data);
      const before = ids.has(variantId);
      if (skip) ids.add(variantId);
      else ids.delete(variantId);
      if (before === skip) return false;
      await tx.setting.update({ where: { key }, data: { value: [...ids] } });
      return true;
    });
    if (changed) {
      await this.audit.record({
        actorId: actor.staffId,
        entity: 'Variant',
        entityId: variantId,
        action: skip ? 'supplier.variant_skipped' : 'supplier.variant_unskipped',
        after: { sku: variant.sku, sourceId: source.id },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
    return this.mappingRow(variantId);
  }

  async setLink(
    variantId: string,
    input: SetSupplierLink,
    actor: Actor,
  ): Promise<SupplierMappingRow> {
    const [variant, item] = await Promise.all([
      this.prisma.client.variant.findUnique({
        where: { id: variantId },
        include: { supplierLink: true },
      }),
      this.prisma.client.supplierItem.findUnique({ where: { id: input.itemId } }),
    ]);
    if (!variant)
      throw new NotFoundException(say('لا يوجد متغيّر بهذا المعرّف.', 'No such variant.'));
    if (!item)
      throw new NotFoundException(say('لا يوجد سطر بهذا المعرّف في الشيت.', 'No such sheet line.'));

    const markup =
      input.markupPercent === undefined ||
      input.markupPercent === '' ||
      input.markupPercent === null
        ? null
        : new Prisma.Decimal(input.markupPercent);
    const data = { itemId: item.id, markupPercent: markup, followStock: input.followStock };
    await this.prisma.client.variantSupplierLink.upsert({
      where: { variantId },
      update: data,
      create: { variantId, linkedById: actor.staffId, ...data },
    });
    await this.audit.record({
      actorId: actor.staffId,
      entity: 'Variant',
      entityId: variantId,
      action: 'supplier.link_set',
      before: variant.supplierLink
        ? {
            sku: variant.sku,
            itemId: variant.supplierLink.itemId,
            markupPercent: variant.supplierLink.markupPercent?.toFixed(2) ?? null,
            followStock: variant.supplierLink.followStock,
          }
        : undefined,
      after: {
        sku: variant.sku,
        itemId: item.id,
        itemName: item.name,
        markupPercent: markup?.toFixed(2) ?? null,
        followStock: input.followStock,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    await this.sync.reconcileStock({ variantIds: [variantId] }, actor.staffId);
    // Linked means this supplier's after all: it leaves the skipped list.
    const source = await this.primary();
    if (source && (await this.skipped(source.id)).has(variantId)) {
      await this.setSkipped(variantId, false, actor);
    }
    return this.mappingRow(variantId);
  }

  /** Links a freshly created variant to the line it was created from. */
  async linkBySku(itemId: string, sku: string, actor: Actor): Promise<SupplierMappingRow> {
    const variant = await this.prisma.client.variant.findUnique({
      where: { sku: sku.trim().toUpperCase() },
      select: { id: true },
    });
    if (!variant) throw new NotFoundException(say('لا يوجد متغيّر بهذا الرمز.', 'No such SKU.'));
    return this.setLink(variant.id, { itemId, followStock: true }, actor);
  }

  async removeLink(variantId: string, actor: Actor): Promise<SupplierMappingRow> {
    const link = await this.prisma.client.variantSupplierLink.findUnique({
      where: { variantId },
      include: { variant: { select: { sku: true } }, item: { select: { name: true } } },
    });
    if (link) {
      await this.prisma.client.variantSupplierLink.delete({ where: { variantId } });
      await this.audit.record({
        actorId: actor.staffId,
        entity: 'Variant',
        entityId: variantId,
        action: 'supplier.link_removed',
        before: { sku: link.variant.sku, itemId: link.itemId, itemName: link.item.name },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
    }
    // Clears a "notify me" that only the link was holding up.
    await this.sync.reconcileStock({ variantIds: [variantId] }, actor.staffId);
    return this.mappingRow(variantId);
  }

  private async mappingRow(variantId: string): Promise<SupplierMappingRow> {
    const [active, skipped] = await Promise.all([
      this.mapping({ filter: 'all' }),
      this.mapping({ filter: 'skipped' }),
    ]);
    const row = [...active.rows, ...skipped.rows].find((entry) => entry.variantId === variantId);
    if (!row) throw new NotFoundException('variant');
    return row;
  }

  // --- prices ---------------------------------------------------------------

  async prices(): Promise<SupplierPrices> {
    const source = await this.primary();
    if (!source) return { rows: [], pending: 0 };
    const links = await this.prisma.client.variantSupplierLink.findMany({
      where: { item: { sourceId: source.id } },
      include: {
        item: true,
        variant: {
          include: {
            product: {
              select: { slug: true, translations: { select: { locale: true, name: true } } },
            },
          },
        },
      },
    });

    const rows = links
      .map((link) => priceRow(link, source))
      .sort(
        (a, b) =>
          stateOrder(a.state) - stateOrder(b.state) ||
          Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0),
      );
    return { rows, pending: rows.filter((row) => row.state === 'PENDING').length };
  }

  /**
   * Applies proposals. Every price is recomputed here from the stored cost
   * and markup — the request names variants, never amounts.
   */
  async applyPrices(input: ApplySupplierPrices, actor: Actor): Promise<ApplySupplierPricesResult> {
    const source = await this.requirePrimary();
    const links = await this.prisma.client.variantSupplierLink.findMany({
      where: {
        item: { sourceId: source.id },
        ...(input.all ? {} : { variantId: { in: input.variantIds ?? [] } }),
      },
      include: {
        item: true,
        variant: {
          include: {
            product: {
              select: {
                id: true,
                slug: true,
                translations: { select: { locale: true, name: true } },
              },
            },
          },
        },
      },
    });

    const result: ApplySupplierPricesResult = { applied: [], skipped: [] };
    const found = new Set(links.map((link) => link.variantId));
    for (const id of input.variantIds ?? []) {
      if (!found.has(id)) result.skipped.push({ variantId: id, sku: '', reason: 'NOT_LINKED' });
    }

    for (const link of links) {
      const row = priceRow(link, source);
      const skip = (reason: ApplySupplierPricesResult['skipped'][number]['reason']) =>
        result.skipped.push({ variantId: link.variantId, sku: link.variant.sku, reason });
      if (row.state === 'MISSING') {
        skip('MISSING');
        continue;
      }
      if (row.state === 'NO_COST' || row.proposedPriceUsd === null || link.item.costUsd === null) {
        skip('NO_COST');
        continue;
      }
      if (row.state === 'CURRENT') {
        skip('CURRENT');
        continue;
      }
      if (row.large && !input.confirmLarge) {
        skip('LARGE');
        continue;
      }
      const next = new Prisma.Decimal(row.proposedPriceUsd);
      if (next.lessThanOrEqualTo(link.item.costUsd)) {
        skip('BELOW_COST');
        continue;
      }

      const before = {
        sku: link.variant.sku,
        priceUsd: link.variant.priceUsd.toFixed(2),
        costUsd: link.variant.costUsd?.toFixed(2) ?? null,
        compareAtUsd: link.variant.compareAtUsd?.toFixed(2) ?? null,
      };
      // A compare-at price at or under the new price would advertise an
      // increase as a discount; it goes, as `setTerms` would insist.
      const dropCompare =
        link.variant.compareAtUsd !== null && link.variant.compareAtUsd.lessThanOrEqualTo(next);

      await this.prisma.client.$transaction(async (tx) => {
        await tx.variant.update({
          where: { id: link.variantId },
          data: {
            priceUsd: next,
            costUsd: link.item.costUsd,
            ...(dropCompare ? { compareAtUsd: null } : {}),
          },
        });
        await tx.variantSupplierLink.update({
          where: { id: link.id },
          data: {
            lastAppliedCostUsd: link.item.costUsd,
            lastAppliedPriceUsd: next,
            lastAppliedAt: new Date(),
          },
        });
        await refreshProductPrice(tx, link.variant.product.id);
      });
      await this.audit.record({
        actorId: actor.staffId,
        entity: 'Variant',
        entityId: link.variantId,
        action: 'variant.supplier_price_applied',
        before,
        after: {
          sku: link.variant.sku,
          priceUsd: next.toFixed(2),
          costUsd: link.item.costUsd.toFixed(2),
          compareAtUsd: dropCompare ? null : before.compareAtUsd,
          markupPercent: row.markupPercent,
          supplierLine: link.item.name,
        },
        ip: actor.ip,
        userAgent: actor.userAgent,
      });
      result.applied.push({
        variantId: link.variantId,
        sku: link.variant.sku,
        from: before.priceUsd,
        to: next.toFixed(2),
      });
    }
    return result;
  }
}

// --- helpers ------------------------------------------------------------------

type TermsVariant = {
  licensePeriodValue: number | null;
  licensePeriodUnit: string;
  deviceCount: number;
};

function terms(variant: TermsVariant): string {
  const period =
    variant.licensePeriodUnit === 'LIFETIME'
      ? say('مدى الحياة', 'lifetime')
      : `${String(variant.licensePeriodValue ?? 1)} ${unitLabel(variant.licensePeriodUnit)}`;
  return `${period} · ${devices(variant.deviceCount)}`;
}

/** "1 جهاز", "2 جهازان", "5 أجهزة", "20 جهازاً" — the Arabic count agrees with its noun. */
function devices(n: number): string {
  if (panelLocale() === 'en') return `${String(n)} ${n === 1 ? 'device' : 'devices'}`;
  if (n === 1) return 'جهاز واحد';
  if (n === 2) return 'جهازان';
  if (n >= 3 && n <= 10) return `${String(n)} أجهزة`;
  return `${String(n)} جهازاً`;
}

function unitLabel(unit: string): string {
  switch (unit) {
    case 'DAY':
      return say('يوم', 'day(s)');
    case 'MONTH':
      return say('شهر', 'month(s)');
    default:
      return say('سنة', 'year(s)');
  }
}

function termsEn(variant: TermsVariant): string {
  if (variant.licensePeriodUnit === 'LIFETIME') return 'Lifetime';
  const unit =
    variant.licensePeriodUnit === 'MONTH'
      ? 'Month'
      : variant.licensePeriodUnit === 'DAY'
        ? 'Day'
        : 'Year';
  return `${String(variant.licensePeriodValue ?? 1)} ${unit}`;
}

function stateOrder(state: SupplierPriceRow['state']): number {
  return { PENDING: 0, MISSING: 1, NO_COST: 2, CURRENT: 3 }[state];
}

type PriceLink = Prisma.VariantSupplierLinkGetPayload<{
  include: {
    item: true;
    variant: {
      include: {
        product: { select: { slug: true; translations: { select: { locale: true; name: true } } } };
      };
    };
  };
}>;

function priceRow(
  link: PriceLink,
  source: { markupPercent: Prisma.Decimal; rounding: SupplierRounding },
): SupplierPriceRow {
  const markup = link.markupPercent ?? source.markupPercent;
  const current = link.variant.priceUsd;
  const cost = link.item.costUsd;
  const proposed = cost === null ? null : proposePrice(cost, markup, source.rounding);
  const change = proposed === null ? null : priceChange(current, proposed);
  const state: SupplierPriceRow['state'] =
    link.item.missingSince !== null
      ? 'MISSING'
      : proposed === null
        ? 'NO_COST'
        : proposed.equals(current)
          ? 'CURRENT'
          : 'PENDING';
  const translations = link.variant.product.translations;
  return {
    variantId: link.variantId,
    sku: link.variant.sku,
    productSlug: link.variant.product.slug,
    productName:
      translations.find((t) => t.locale === (panelLocale() === 'en' ? Locale.EN : Locale.AR))
        ?.name ??
      translations[0]?.name ??
      link.variant.product.slug,
    terms: terms(link.variant),
    itemName: link.item.name,
    costUsd: cost?.toFixed(2) ?? null,
    lastAppliedCostUsd: link.lastAppliedCostUsd?.toFixed(2) ?? null,
    markupPercent: markup.toFixed(2),
    markupFromLink: link.markupPercent !== null,
    currentPriceUsd: current.toFixed(2),
    proposedPriceUsd: proposed?.toFixed(2) ?? null,
    change,
    large: proposed !== null && isLargeChange(change, current),
    state,
  };
}
