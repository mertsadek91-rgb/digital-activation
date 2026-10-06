import crypto from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { SupplierSyncResult } from '@da/contracts';
import { ActorType, Prisma, SupplierChangeKind } from '@da/db';

import { AuditService } from '../auth/audit.service.js';
import { withAdvisoryLock } from '../common/advisory-lock.js';
import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { diffLine, supplierUnavailable, suspiciousOutage, suspiciousShrink } from './diff.js';
import { SheetShapeError, parseSheet, type SupplierLine } from './sheet-parse.js';
import { SheetFetchError, fetchSheetGrid } from './sheet-reader.js';

/**
 * Reads the supplier's sheet and brings our copy of it up to date.
 *
 * Hourly for every source with auto-sync on, and on demand from the admin.
 * One run at a time across replicas (advisory lock). Each run:
 *
 *  1. fetches and parses the sheet — refusing a sheet whose header changed,
 *     or one that suddenly lost half its rows;
 *  2. upserts every line by its name, logging what changed on each one, and
 *     marks lines no longer present as missing (never deletes them: a link
 *     to a line that comes back next week should still be there);
 *  3. switches `supplierOutOfStock` on every linked variant that follows the
 *     sheet, so a struck-through line becomes "notify me" and an unstruck one
 *     becomes buyable again — the back-in-stock sweep then emails whoever
 *     was waiting.
 *
 * It never changes a price. Cost changes become proposals that a person
 * applies (`SupplierPricesService`).
 */
const LOCK_KEY = 761_204_011;

const EMPTY: Omit<SupplierSyncResult, 'status' | 'error'> = {
  rowCount: 0,
  added: 0,
  changed: 0,
  removed: 0,
  stockSwitched: 0,
  warnings: [],
};

@Injectable()
export class SupplierSyncService {
  private readonly logger = new Logger(SupplierSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private get scheduled(): boolean {
    return process.env.SUPPLIER_SYNC !== 'off' && process.env.NODE_ENV !== 'test';
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'supplier-sync' })
  async sweep(): Promise<void> {
    if (!this.scheduled || !process.env.GOOGLE_SHEETS_API_KEY) return;
    const sources = await this.prisma.client.supplierSource.findMany({
      where: { autoSync: true },
      select: { id: true },
    });
    for (const source of sources) {
      try {
        await this.sync(source.id, null);
      } catch (error) {
        this.logger.error(
          `Supplier sync ${source.id} failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
  }

  /** One sync of one source. `staffId` is who pressed the button; null for the schedule. */
  async sync(
    sourceId: string,
    staffId: string | null,
    options: { force?: boolean } = {},
  ): Promise<SupplierSyncResult> {
    const result = await withAdvisoryLock(this.prisma.client, LOCK_KEY, () =>
      this.run(sourceId, staffId, options.force === true && staffId !== null),
    );
    return result.ran
      ? result.value
      : {
          status: 'BUSY',
          error: say('هناك قراءة جارية الآن.', 'A sync is already running.'),
          ...EMPTY,
        };
  }

  /**
   * `force` (an admin pressing "apply anyway", audited by the caller) skips the
   * two refusals below. It never skips the header check: a sheet whose columns
   * cannot be found has nothing to force.
   */
  private async run(
    sourceId: string,
    staffId: string | null,
    force: boolean,
  ): Promise<SupplierSyncResult> {
    const source = await this.prisma.client.supplierSource.findUniqueOrThrow({
      where: { id: sourceId },
    });

    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!apiKey) {
      return this.finish(sourceId, staffId, {
        status: 'FAILED',
        error: say(
          'مفتاح GOOGLE_SHEETS_API_KEY غير مضبوط على الخادم.',
          'GOOGLE_SHEETS_API_KEY is not set on the API.',
        ),
        ...EMPTY,
      });
    }

    let lines: SupplierLine[];
    let updatedLabel: string | null;
    let warnings: string[];
    try {
      const grid = await fetchSheetGrid(source.spreadsheetId, apiKey);
      ({ lines, updatedLabel, warnings } = parseSheet(grid, source.sheetGid));
    } catch (error) {
      if (error instanceof SheetShapeError || error instanceof SheetFetchError) {
        return this.finish(sourceId, staffId, {
          status: error instanceof SheetShapeError ? 'REFUSED' : 'FAILED',
          error: error.message,
          ...EMPTY,
        });
      }
      throw error;
    }

    const previousActive = await this.prisma.client.supplierItem.count({
      where: { sourceId, missingSince: null },
    });
    if (!force && suspiciousShrink(previousActive, lines.length)) {
      return this.finish(sourceId, staffId, {
        status: 'REFUSED',
        error: say(
          `الشيت فيه الآن ${String(lines.length)} سطراً بعد أن كان ${String(previousActive)}. تبدو قراءة خاطئة، فلم يتغير شيء. راجع الشيت؛ وإن كان صحيحاً يمكن للمدير تطبيقها.`,
          `The sheet now has ${String(lines.length)} rows, down from ${String(previousActive)}. That looks like a broken read, so nothing was changed. Check the sheet; if it is right, an admin can apply it anyway.`,
        ),
        ...EMPTY,
        rowCount: lines.length,
        warnings,
      });
    }

    // The same guard for availability: a strikethrough dragged over the whole
    // name column would otherwise turn most of the store into "notify me" in
    // one read.
    const following = await this.prisma.client.variantSupplierLink.findMany({
      where: { followStock: true, item: { sourceId } },
      select: {
        item: { select: { nameKey: true } },
        variant: { select: { supplierOutOfStock: true } },
      },
    });
    const byKey = new Map(lines.map((line) => [line.nameKey, line]));
    const newlyOut = following.filter((link) => {
      if (link.variant.supplierOutOfStock) return false;
      const line = byKey.get(link.item.nameKey);
      return !line || line.outOfStock;
    }).length;
    if (!force && suspiciousOutage(following.length, newlyOut)) {
      return this.finish(sourceId, staffId, {
        status: 'REFUSED',
        error: say(
          `هذه القراءة ستجعل ${String(newlyOut)} من ${String(following.length)} منتجاً مربوطاً نافداً دفعة واحدة، فلم يتغير شيء. راجع الشيت؛ وإن كان صحيحاً يمكن للمدير تطبيقها.`,
          `This read would mark ${String(newlyOut)} of ${String(following.length)} linked products out of stock at once. Nothing was changed. Check the sheet; if it is right, an admin can apply it anyway.`,
        ),
        ...EMPTY,
        rowCount: lines.length,
        warnings,
      });
    }

    const contentHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(lines.map(({ rowNumber: _row, ...line }) => line)))
      .digest('hex');
    const last = await this.prisma.client.supplierSnapshot.findFirst({
      where: { sourceId, status: { in: ['OK', 'UNCHANGED'] } },
      orderBy: { fetchedAt: 'desc' },
      select: { contentHash: true },
    });

    const snapshot = await this.prisma.client.supplierSnapshot.create({
      data: {
        sourceId,
        status: 'RUNNING',
        triggeredById: staffId,
        sheetUpdatedLabel: updatedLabel,
      },
    });

    let counts = { added: 0, changed: 0, removed: 0 };
    let stockSwitched: number;
    try {
      if (last?.contentHash !== contentHash) {
        counts = await this.apply(sourceId, snapshot.id, lines);
      } else {
        // Same content; the rows may still have moved. Cheap to keep current.
        await this.touch(sourceId, lines);
      }
      stockSwitched = await this.reconcileStock({ sourceId }, staffId);
    } catch (error) {
      // The snapshot must not stay RUNNING, and the panel must say it failed.
      const message = error instanceof Error ? error.message : 'unknown error';
      await this.prisma.client.supplierSnapshot.update({
        where: { id: snapshot.id },
        data: { status: 'FAILED', error: message.slice(0, 500), rowCount: lines.length },
      });
      await this.prisma.client.supplierSource.update({
        where: { id: sourceId },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'FAILED',
          lastSyncError: message.slice(0, 500),
        },
      });
      throw error;
    }

    const status =
      counts.added + counts.changed + counts.removed + stockSwitched === 0 ? 'UNCHANGED' : 'OK';
    await this.prisma.client.supplierSnapshot.update({
      where: { id: snapshot.id },
      data: {
        status,
        rowCount: lines.length,
        contentHash,
        ...counts,
        stockSwitched,
      },
    });
    await this.prisma.client.supplierSource.update({
      where: { id: sourceId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'OK',
        lastSyncError: null,
        sheetUpdatedLabel: updatedLabel,
      },
    });
    this.logger.log(
      `Supplier sync ${source.name}: ${String(lines.length)} rows, +${String(counts.added)} ~${String(counts.changed)} -${String(counts.removed)}, ${String(stockSwitched)} availability switch(es).`,
    );
    return { status, error: null, rowCount: lines.length, ...counts, stockSwitched, warnings };
  }

  /** Last-seen and row numbers for a read whose content did not change. */
  private async touch(sourceId: string, lines: SupplierLine[]): Promise<void> {
    const now = new Date();
    await this.prisma.client.supplierItem.updateMany({
      where: { sourceId, nameKey: { in: lines.map((line) => line.nameKey) } },
      data: { lastSeenAt: now },
    });
    const stored = await this.prisma.client.supplierItem.findMany({
      where: { sourceId },
      select: { id: true, nameKey: true, rowNumber: true },
    });
    const rowOf = new Map(lines.map((line) => [line.nameKey, line.rowNumber]));
    for (const item of stored) {
      const row = rowOf.get(item.nameKey);
      if (row !== undefined && row !== item.rowNumber) {
        await this.prisma.client.supplierItem.update({
          where: { id: item.id },
          data: { rowNumber: row },
        });
      }
    }
  }

  /** Writes the item rows and their change log for one read. */
  private async apply(
    sourceId: string,
    snapshotId: string,
    lines: SupplierLine[],
  ): Promise<{ added: number; changed: number; removed: number }> {
    const now = new Date();
    const existing = await this.prisma.client.supplierItem.findMany({ where: { sourceId } });
    const byKey = new Map(existing.map((item) => [item.nameKey, item]));
    const seen = new Set<string>();
    const changes: Prisma.SupplierItemChangeCreateManyInput[] = [];
    let added = 0;
    let changed = 0;
    let removed = 0;

    await this.prisma.client.$transaction(
      async (tx) => {
        for (const line of lines) {
          seen.add(line.nameKey);
          const stored = byKey.get(line.nameKey);
          const data = {
            name: line.name,
            category: line.category,
            costUsd: line.costUsd === null ? null : new Prisma.Decimal(line.costUsd),
            priceText: line.priceText,
            warranty: line.warranty,
            remarks: line.remarks,
            outOfStock: line.outOfStock,
            partialStrike: line.partialStrike,
            wholesaleOnly: line.wholesaleOnly,
            rowNumber: line.rowNumber,
            lastSeenAt: now,
            missingSince: null,
          };

          if (!stored) {
            const created = await tx.supplierItem.create({
              data: { sourceId, nameKey: line.nameKey, firstSeenAt: now, ...data },
            });
            changes.push({
              itemId: created.id,
              snapshotId,
              kind: SupplierChangeKind.ADDED,
              after: { costUsd: line.costUsd, outOfStock: line.outOfStock },
            });
            added += 1;
            continue;
          }

          const lineChanges = diffLine(
            {
              costUsd: stored.costUsd?.toFixed(2) ?? null,
              outOfStock: stored.outOfStock,
              category: stored.category,
              warranty: stored.warranty,
              remarks: stored.remarks,
            },
            line,
          );
          if (stored.missingSince) {
            changes.push({ itemId: stored.id, snapshotId, kind: SupplierChangeKind.RETURNED });
          }
          for (const change of lineChanges) {
            changes.push({
              itemId: stored.id,
              snapshotId,
              kind: change.kind,
              before: change.before ?? Prisma.JsonNull,
              after: change.after ?? Prisma.JsonNull,
            });
          }
          if (lineChanges.length > 0 || stored.missingSince) changed += 1;
          await tx.supplierItem.update({ where: { id: stored.id }, data });
        }

        for (const item of existing) {
          if (seen.has(item.nameKey) || item.missingSince) continue;
          await tx.supplierItem.update({ where: { id: item.id }, data: { missingSince: now } });
          changes.push({ itemId: item.id, snapshotId, kind: SupplierChangeKind.REMOVED });
          removed += 1;
        }

        if (changes.length > 0) await tx.supplierItemChange.createMany({ data: changes });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    return { added, changed, removed };
  }

  /**
   * Makes `supplierOutOfStock` agree with the sheet for linked variants that
   * follow it, and turns the flag off for variants that stopped following
   * (or were unlinked). Returns how many variants switched. Audited per
   * variant, because it decides whether a product can be bought.
   */
  async reconcileStock(
    scope: { sourceId?: string; variantIds?: string[] },
    staffId: string | null,
  ): Promise<number> {
    const links = await this.prisma.client.variantSupplierLink.findMany({
      where: {
        ...(scope.variantIds ? { variantId: { in: scope.variantIds } } : {}),
        ...(scope.sourceId ? { item: { sourceId: scope.sourceId } } : {}),
      },
      include: {
        item: { select: { outOfStock: true, missingSince: true, name: true } },
        variant: { select: { id: true, sku: true, supplierOutOfStock: true } },
      },
    });

    const switches: { id: string; sku: string; to: boolean; item: string }[] = [];
    for (const link of links) {
      const want = link.followStock && supplierUnavailable(link.item);
      if (link.variant.supplierOutOfStock !== want) {
        switches.push({
          id: link.variant.id,
          sku: link.variant.sku,
          to: want,
          item: link.item.name,
        });
      }
    }

    // A variant flagged out of stock that no longer has a link must not stay
    // unbuyable forever with nothing left that could clear it.
    if (scope.variantIds) {
      const linked = new Set(links.map((link) => link.variantId));
      const orphans = await this.prisma.client.variant.findMany({
        where: {
          id: { in: scope.variantIds.filter((id) => !linked.has(id)) },
          supplierOutOfStock: true,
        },
        select: { id: true, sku: true },
      });
      for (const orphan of orphans) {
        switches.push({ id: orphan.id, sku: orphan.sku, to: false, item: '' });
      }
    }

    for (const entry of switches) {
      await this.prisma.client.variant.update({
        where: { id: entry.id },
        data: { supplierOutOfStock: entry.to },
      });
      await this.audit.record({
        actorId: staffId ?? undefined,
        actorType: staffId ? ActorType.STAFF : ActorType.SYSTEM,
        entity: 'Variant',
        entityId: entry.id,
        action: 'variant.supplier_stock',
        before: { sku: entry.sku, supplierOutOfStock: !entry.to },
        after: { sku: entry.sku, supplierOutOfStock: entry.to, supplierLine: entry.item },
      });
    }
    return switches.length;
  }

  private async finish(
    sourceId: string,
    staffId: string | null,
    result: SupplierSyncResult,
  ): Promise<SupplierSyncResult> {
    await this.prisma.client.supplierSnapshot.create({
      data: {
        sourceId,
        status: result.status,
        error: result.error,
        rowCount: result.rowCount,
        triggeredById: staffId,
      },
    });
    await this.prisma.client.supplierSource.update({
      where: { id: sourceId },
      data: { lastSyncAt: new Date(), lastSyncStatus: result.status, lastSyncError: result.error },
    });
    this.logger.warn(`Supplier sync ${sourceId}: ${result.status} — ${result.error ?? ''}`);
    return result;
  }
}
