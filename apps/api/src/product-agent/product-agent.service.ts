import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AgentBatchDetail,
  type AgentBatchSummary,
  type AgentCandidates,
  type AgentCounts,
  type AgentItemView,
  type AgentOverview,
  type StartAgentBatch,
  agentItemResultSchema,
  agentOptionsSchema,
  agentSnapshotSchema,
  countBodyWords,
} from '@da/contracts';
import {
  AgentBatchKind,
  AgentBatchStatus,
  AgentItemStatus,
  Locale,
  Prisma,
  PublishStatus,
} from '@da/db';

import { AdminService } from '../admin/admin.service.js';
import { CatalogEditService } from '../admin/catalog-edit.service.js';
import { bodyText } from '../admin/readiness.js';
import { AuditService } from '../auth/audit.service.js';
import { panelLocale, say } from '../common/panel-locale.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SupplierAiService } from '../supplier/ai/supplier-ai.service.js';

import { appendLog, readLog } from './agent-rules.js';
import { ProductAgentWorker } from './product-agent.worker.js';

type Actor = { staffId: string; ip?: string | undefined; userAgent?: string | undefined };

const BATCHES_SHOWN = 20;

type ItemRow = Prisma.AgentItemGetPayload<object>;
type BatchRow = Prisma.AgentBatchGetPayload<object>;

/**
 * The product agent's panel side (CR-0007): what can be picked, starting a
 * batch, following it, and pausing, cancelling, retrying or undoing. The
 * work itself is the worker's; nothing here calls a model.
 */
@Injectable()
export class ProductAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: SupplierAiService,
    private readonly worker: ProductAgentWorker,
    private readonly admin: AdminService,
    private readonly catalog: CatalogEditService,
    private readonly media: MediaService,
  ) {}

  async overview(): Promise<AgentOverview> {
    const status = await this.ai.status();
    const batches = await this.prisma.client.agentBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: BATCHES_SHOWN,
    });
    return {
      aiReady: status.configured && status.model !== null,
      model: status.model,
      workerOn: this.worker.enabled,
      batches: await this.summaries(batches),
    };
  }

  // --- what can be picked ---------------------------------------------------------

  async candidates(): Promise<AgentCandidates> {
    const [products, lines] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { status: { not: PublishStatus.ARCHIVED } },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
        take: 1000,
        include: {
          translations: { select: { locale: true, name: true, body: true } },
          brand: { select: { name: true } },
          categories: {
            include: {
              category: { include: { translations: { select: { locale: true, name: true } } } },
            },
          },
          _count: { select: { media: true } },
        },
      }),
      this.prisma.client.supplierItem.findMany({
        where: { missingSince: null, links: { none: {} } },
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        take: 1000,
      }),
    ]);

    const lastRuns = async (field: 'productId' | 'supplierItemId', ids: string[]) => {
      const rows = await this.prisma.client.agentItem.findMany({
        where: { [field]: { in: ids } },
        orderBy: { createdAt: 'desc' },
        distinct: [field],
        select: { productId: true, supplierItemId: true, status: true, updatedAt: true },
      });
      return new Map(
        rows.map((row) => [
          row[field] ?? '',
          { status: row.status, at: row.updatedAt.toISOString() },
        ]),
      );
    };
    const [productRuns, lineRuns] = await Promise.all([
      lastRuns(
        'productId',
        products.map((p) => p.id),
      ),
      lastRuns(
        'supplierItemId',
        lines.map((l) => l.id),
      ),
    ]);

    return {
      products: products.map((product) => {
        const ar = product.translations.find((t) => t.locale === Locale.AR);
        const en = product.translations.find((t) => t.locale === Locale.EN);
        return {
          id: product.id,
          slug: product.slug,
          nameAr: ar?.name ?? en?.name ?? product.slug,
          nameEn: en?.name ?? null,
          status: product.status,
          brand: product.brand?.name ?? null,
          categories: product.categories.map(
            (link) =>
              link.category.translations.find((t) => t.locale === Locale.AR)?.name ??
              link.category.slug,
          ),
          hasImage: product._count.media > 0,
          words: countBodyWords(bodyText(ar?.body ?? null)),
          lastRun: productRuns.get(product.id) ?? null,
        };
      }),
      supplierLines: lines.map((line) => ({
        id: line.id,
        name: line.name,
        category: line.category,
        costUsd: line.costUsd?.toFixed(2) ?? null,
        outOfStock: line.outOfStock,
        wholesaleOnly: line.wholesaleOnly,
        lastRun: lineRuns.get(line.id) ?? null,
      })),
    };
  }

  // --- starting -------------------------------------------------------------------

  async start(input: StartAgentBatch, actor: Actor): Promise<AgentBatchDetail> {
    const status = await this.ai.status();
    if (!status.configured || !status.model) {
      throw new BadRequestException(
        say(
          'الذكاء الاصطناعي غير جاهز: اضبط مفتاح OpenCode واختر نموذجاً في تبويب الذكاء الاصطناعي في صفحة المورّد.',
          'AI is not ready: set the OpenCode key and choose a model on the supplier page AI tab.',
        ),
      );
    }

    // Labels taken now, in the order the person picked; unknown ids refused.
    let labels: { id: string; label: string; productId?: string; supplierItemId?: string }[];
    if (input.kind === 'REWRITE') {
      const rows = await this.prisma.client.product.findMany({
        where: { id: { in: input.ids } },
        select: { id: true, slug: true, translations: { select: { locale: true, name: true } } },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      labels = input.ids.flatMap((id) => {
        const row = byId.get(id);
        if (!row) return [];
        const name =
          row.translations.find((t) => t.locale === Locale.AR)?.name ??
          row.translations[0]?.name ??
          row.slug;
        return [{ id, label: name, productId: id }];
      });
    } else {
      const rows = await this.prisma.client.supplierItem.findMany({
        where: { id: { in: input.ids } },
        select: { id: true, name: true },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      labels = input.ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [{ id, label: row.name, supplierItemId: id }] : [];
      });
    }
    if (labels.length !== input.ids.length) {
      throw new BadRequestException(
        say(
          'بعض العناصر المختارة لم تعد موجودة. حدّث القائمة.',
          'Some picked items no longer exist. Reload the list.',
        ),
      );
    }

    const batch = await this.prisma.client.agentBatch.create({
      data: {
        kind: input.kind === 'REWRITE' ? AgentBatchKind.REWRITE : AgentBatchKind.CREATE,
        options: input.options,
        cooldownSeconds: input.cooldownSeconds,
        locale: panelLocale(),
        createdById: actor.staffId,
        items: {
          create: labels.map((entry, position) => ({
            position,
            label: entry.label.slice(0, 300),
            productId: entry.productId ?? null,
            supplierItemId: entry.supplierItemId ?? null,
          })),
        },
      },
    });
    await this.audit.record({
      actorId: actor.staffId,
      entity: 'AgentBatch',
      entityId: batch.id,
      action: 'agent.batch_started',
      after: {
        kind: input.kind,
        items: labels.length,
        options: input.options,
        cooldownSeconds: input.cooldownSeconds,
        model: status.model,
      },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.batch(batch.id);
  }

  // --- following ------------------------------------------------------------------

  async batch(id: string): Promise<AgentBatchDetail> {
    const batch = await this.prisma.client.agentBatch.findUnique({
      where: { id },
      include: { items: { orderBy: { position: 'asc' } } },
    });
    if (!batch) throw new NotFoundException(say('لا توجد دفعة بهذا المعرّف.', 'No such batch.'));
    const [summary] = await this.summaries([batch]);
    if (!summary) throw new NotFoundException(say('لا توجد دفعة بهذا المعرّف.', 'No such batch.'));
    const latest = await this.latestDone(batch.items.map((item) => item.productId));
    return { ...summary, items: batch.items.map((item) => this.view(item, latest)) };
  }

  async setStatus(
    id: string,
    action: 'pause' | 'resume' | 'cancel',
    actor: Actor,
  ): Promise<AgentBatchDetail> {
    const batch = await this.prisma.client.agentBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException(say('لا توجد دفعة بهذا المعرّف.', 'No such batch.'));
    const open =
      batch.status === AgentBatchStatus.RUNNING || batch.status === AgentBatchStatus.PAUSED;
    if (!open) {
      throw new BadRequestException(say('هذه الدفعة انتهت.', 'This batch has finished.'));
    }
    if (action === 'cancel') {
      // The product being written now finishes; the rest never start.
      await this.prisma.client.$transaction([
        this.prisma.client.agentItem.updateMany({
          where: { batchId: id, status: AgentItemStatus.QUEUED },
          data: { status: AgentItemStatus.CANCELLED, finishedAt: new Date() },
        }),
        this.prisma.client.agentBatch.update({
          where: { id },
          data: { status: AgentBatchStatus.CANCELLED, finishedAt: new Date() },
        }),
      ]);
    } else {
      await this.prisma.client.agentBatch.update({
        where: { id },
        data: {
          status: action === 'pause' ? AgentBatchStatus.PAUSED : AgentBatchStatus.RUNNING,
          // Resuming starts at once rather than after a cooldown already waited.
          ...(action === 'resume' ? { nextRunAt: new Date() } : {}),
        },
      });
    }
    await this.audit.record({
      actorId: actor.staffId,
      entity: 'AgentBatch',
      entityId: id,
      action: `agent.batch_${action}`,
      before: { status: batch.status },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.batch(id);
  }

  /** A failed, skipped or cancelled item back in its batch's queue. */
  async retry(itemId: string, actor: Actor): Promise<AgentBatchDetail> {
    const item = await this.prisma.client.agentItem.findUnique({
      where: { id: itemId },
      include: { batch: true },
    });
    if (!item) throw new NotFoundException(say('لا يوجد عنصر بهذا المعرّف.', 'No such item.'));
    const retryable: AgentItemStatus[] = [
      AgentItemStatus.FAILED,
      AgentItemStatus.SKIPPED,
      AgentItemStatus.CANCELLED,
    ];
    if (!retryable.includes(item.status)) {
      throw new BadRequestException(
        say(
          'يمكن إعادة المحاولة فقط لعنصر فشل أو تُخطّي أو أُلغي.',
          'Only a failed, skipped or cancelled item can be retried.',
        ),
      );
    }
    await this.prisma.client.$transaction([
      this.prisma.client.agentItem.update({
        where: { id: itemId },
        data: {
          status: AgentItemStatus.QUEUED,
          attempts: 0,
          error: null,
          finishedAt: null,
          log: appendLog(item.log, 'retried', 'info'),
        },
      }),
      this.prisma.client.agentBatch.update({
        where: { id: item.batchId },
        data:
          item.batch.status === AgentBatchStatus.PAUSED
            ? {}
            : { status: AgentBatchStatus.RUNNING, finishedAt: null, nextRunAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: actor.staffId,
      entity: 'AgentItem',
      entityId: itemId,
      action: 'agent.item_retried',
      before: { status: item.status },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.batch(item.batchId);
  }

  // --- undo ---------------------------------------------------------------------

  /**
   * Puts a product back as it was before this item: for a rewrite the copy,
   * sections, added translations and pictures from the snapshot, and the
   * publish state; for a product the agent created, back to draft (it is not
   * deleted — its supplier link and any orders stay intact).
   */
  async revert(itemId: string, actor: Actor): Promise<AgentBatchDetail> {
    const item = await this.prisma.client.agentItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException(say('لا يوجد عنصر بهذا المعرّف.', 'No such item.'));
    const latest = await this.latestDone([item.productId]);
    if (!this.canRevert(item, latest)) {
      throw new BadRequestException(
        say(
          'لا يمكن التراجع عن هذا العنصر: إما أنه لم يكتمل، أو أن عنصراً أحدث عدّل المنتج نفسه بعده.',
          'This item cannot be undone: it did not finish, or a later item changed the same product.',
        ),
      );
    }
    const product = await this.prisma.client.product.findUnique({
      where: { id: item.productId ?? '' },
      select: { id: true, slug: true, status: true },
    });
    if (!product) throw new NotFoundException(say('لا يوجد منتج بهذا الرابط.', 'No such product.'));
    const result = agentItemResultSchema.safeParse(item.result);
    const notes: string[] = [];

    if (result.success && result.data.created) {
      if (product.status !== PublishStatus.DRAFT) {
        await this.admin.setStatus(product.slug, PublishStatus.DRAFT, 'ar', actor.staffId, {});
      }
      notes.push('draft');
    } else {
      const snapshot = agentSnapshotSchema.parse(item.snapshot);
      await this.prisma.client.$transaction(async (tx) => {
        for (const translation of snapshot.translations) {
          await tx.productTranslation.updateMany({
            where: {
              productId: product.id,
              locale: translation.locale === 'en' ? Locale.EN : Locale.AR,
            },
            data: {
              seoTitle: translation.seoTitle,
              seoDescription: translation.seoDescription,
              shortDesc: translation.shortDesc,
              body:
                translation.body === null || translation.body === undefined
                  ? Prisma.DbNull
                  : (translation.body as Prisma.InputJsonValue),
            },
          });
        }
        for (const locale of snapshot.addedLocales) {
          await tx.productTranslation.deleteMany({
            where: { productId: product.id, locale: locale === 'en' ? Locale.EN : Locale.AR },
          });
        }
      });
      await this.catalog.setIdentity(
        product.slug,
        { categoryIds: snapshot.categoryIds, primaryCategoryId: snapshot.primaryCategoryId },
        actor.staffId,
      );
      for (const mediaId of snapshot.addedMediaIds) {
        try {
          await this.media.remove(mediaId, actor.staffId);
        } catch {
          notes.push(`image ${mediaId} already gone`);
        }
      }
      if (product.status !== snapshot.status) {
        try {
          await this.admin.setStatus(product.slug, snapshot.status, 'ar', actor.staffId, {});
        } catch (error) {
          notes.push(error instanceof Error ? error.message : 'status not restored');
        }
      }
    }

    await this.prisma.client.agentItem.update({
      where: { id: itemId },
      data: {
        status: AgentItemStatus.REVERTED,
        log: appendLog(item.log, 'reverted', 'info', notes.join(' · ')),
      },
    });
    await this.audit.record({
      actorId: actor.staffId,
      entity: 'Product',
      entityId: product.id,
      action: 'agent.item_reverted',
      after: { itemId, slug: product.slug, notes },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return this.batch(item.batchId);
  }

  // --- shapes ---------------------------------------------------------------------

  private async summaries(batches: BatchRow[]): Promise<AgentBatchSummary[]> {
    if (batches.length === 0) return [];
    const grouped = await this.prisma.client.agentItem.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { in: batches.map((b) => b.id) } },
      _count: { _all: true },
    });
    const staff = await this.prisma.client.staffUser.findMany({
      where: { id: { in: [...new Set(batches.map((b) => b.createdById))] } },
      select: { id: true, name: true },
    });
    const names = new Map(staff.map((s) => [s.id, s.name]));
    return batches.map((batch) => {
      const counts: AgentCounts = {
        total: 0,
        queued: 0,
        running: 0,
        done: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
        reverted: 0,
      };
      for (const row of grouped) {
        if (row.batchId !== batch.id) continue;
        const key = row.status.toLowerCase() as Exclude<keyof AgentCounts, 'total'>;
        counts[key] += row._count._all;
        counts.total += row._count._all;
      }
      return {
        id: batch.id,
        kind: batch.kind,
        status: batch.status,
        options: agentOptionsSchema.parse(batch.options),
        cooldownSeconds: batch.cooldownSeconds,
        nextRunAt: batch.status === AgentBatchStatus.RUNNING ? batch.nextRunAt.toISOString() : null,
        createdAt: batch.createdAt.toISOString(),
        finishedAt: batch.finishedAt?.toISOString() ?? null,
        createdBy: names.get(batch.createdById) ?? null,
        counts,
      };
    });
  }

  /** For each product, the id of the last DONE item that changed it. */
  private async latestDone(productIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(productIds.filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.agentItem.findMany({
      where: { productId: { in: ids }, status: AgentItemStatus.DONE },
      orderBy: { finishedAt: 'desc' },
      distinct: ['productId'],
      select: { id: true, productId: true },
    });
    return new Map(rows.map((row) => [row.productId ?? '', row.id]));
  }

  private canRevert(item: ItemRow, latest: Map<string, string>): boolean {
    if (item.status !== AgentItemStatus.DONE || !item.productId) return false;
    if (latest.get(item.productId) !== item.id) return false;
    const result = agentItemResultSchema.safeParse(item.result);
    if (result.success && result.data.created) return true;
    return agentSnapshotSchema.safeParse(item.snapshot).success;
  }

  private view(item: ItemRow, latest: Map<string, string>): AgentItemView {
    const result = agentItemResultSchema.safeParse(item.result);
    return {
      id: item.id,
      position: item.position,
      status: item.status,
      label: item.label,
      productSlug: item.productSlug,
      step: item.step,
      attempts: item.attempts,
      log: readLog(item.log),
      result: result.success ? result.data : null,
      error: item.error,
      startedAt: item.startedAt?.toISOString() ?? null,
      finishedAt: item.finishedAt?.toISOString() ?? null,
      canRevert: this.canRevert(item, latest),
    };
  }
}
