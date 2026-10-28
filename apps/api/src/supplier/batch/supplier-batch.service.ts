import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import {
  AI_BATCH_CURRENT_KEY,
  AI_BATCH_MAX_LINES,
  type AiBatch,
  type AiBatchLine,
  type AiBatchLineStatus,
  type AiBatchView,
  type StartAiBatch,
  aiBatchKey,
  aiBatchSchema,
  createProductSchema,
  generateCopySchema,
  setProductContentSchema,
  setProductCopySchema,
} from '@da/contracts';
import type { Prisma } from '@da/db';
import { z } from 'zod';

import { AdminService } from '../../admin/admin.service.js';
import { CatalogEditService } from '../../admin/catalog-edit.service.js';
import { ProductContentService } from '../../admin/product-content.service.js';
import { withAdvisoryLock } from '../../common/advisory-lock.js';
import { say } from '../../common/panel-locale.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SupplierAiService } from '../ai/supplier-ai.service.js';
import { SupplierService } from '../supplier.service.js';

/** Held while one line is worked on, so two replicas never run the same batch. */
export const BATCH_RUN_LOCK = 761_206_001;
/** Held for each read-modify-write of the batch row, so no update is lost. */
const BATCH_WRITE_LOCK = 761_206_002;
/** One line's longest run: a draft and two languages of copy, with their retries. */
const LINE_TIMEOUT_MS = 25 * 60 * 1000;
/** How often a poll may try to pick up a batch no process is working on. */
const KICK_EVERY_MS = 15_000;
/** Finished batches are kept a week, then removed as new ones start. */
const BATCH_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const FINISHED: ReadonlySet<AiBatchLineStatus> = new Set([
  'DONE',
  'SKIPPED',
  'FAILED',
  'CANCELLED',
]);
const IN_FLIGHT: ReadonlySet<AiBatchLineStatus> = new Set(['DRAFTING', 'CREATING', 'WRITING']);

const pointerSchema = z.object({ id: z.string() });

type Actor = { staffId: string };
type LinePatch = Partial<Omit<AiBatchLine, 'itemId' | 'itemName'>>;

/**
 * Products from sheet lines in one press (TASK-0150): the model drafts the
 * product, it is created as a DRAFT and linked to its line, and the Arabic and
 * English copy is written and saved — one line after another.
 *
 * One line at a time, because every line is three calls on the owner's
 * OpenCode account and the provider rate-limits. The batch lives in the
 * `Setting` table like the copy jobs, so a reload of the panel finds it, and
 * whichever replica holds the run lock works on it. A process that dies
 * mid-line leaves the line in flight; the next one resumes it from what was
 * recorded — the draft, then the product — and never creates it twice.
 *
 * Every write goes through the services the panel's own buttons use, so the
 * create rules, sanitising and audit log apply, audited as the person who
 * pressed the button. Nothing is published.
 */
@Injectable()
export class SupplierBatchService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SupplierBatchService.name);
  /** This process's run, while it has one. */
  private running: Promise<void> | null = null;
  private lastKick = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: SupplierAiService,
    private readonly supplier: SupplierService,
    private readonly catalog: CatalogEditService,
    private readonly content: ProductContentService,
    private readonly admin: AdminService,
  ) {}

  /** A deploy stops a batch mid-way; the new process carries on with it. */
  onApplicationBootstrap(): void {
    // The integration suite drives the runner itself.
    if (process.env.NODE_ENV === 'test') return;
    void this.readCurrent()
      .then((batch) => {
        if (batch?.status === 'RUNNING') this.kick();
      })
      .catch((error: unknown) =>
        this.logger.warn(`Resuming the AI batch failed: ${message(error)}`),
      );
  }

  async current(): Promise<AiBatchView> {
    const batch = await this.readCurrent();
    // A batch no process is working on (its process died) is picked up by the
    // next poll; if another replica holds the run lock, this returns at once.
    if (batch?.status === 'RUNNING' && Date.now() - this.lastKick > KICK_EVERY_MS) this.kick();
    return { batch };
  }

  /**
   * Queues lines. While a batch runs, new lines join it; a line already in it
   * that failed or was cancelled is queued again, and a line already queued
   * or finished is left as it is.
   */
  async start(input: StartAiBatch, actor: Actor): Promise<AiBatchView> {
    await this.ai.assertReady();
    const ids = [...new Set(input.itemIds)];
    const items = await this.prisma.client.supplierItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    if (items.length !== ids.length)
      throw new NotFoundException(
        say('أحد الأسطر غير موجود.', 'One of those lines does not exist.'),
      );
    const names = new Map(items.map((item) => [item.id, item.name]));

    const batch = await this.mutate((current) => {
      const now = new Date().toISOString();
      const next: AiBatch =
        current?.status === 'RUNNING'
          ? { ...current, lines: [...current.lines] }
          : {
              id: randomUUID(),
              status: 'RUNNING',
              startedById: actor.staffId,
              startedAt: now,
              finishedAt: null,
              lines: [],
            };
      for (const id of ids) {
        const index = next.lines.findIndex((line) => line.itemId === id);
        const existing = next.lines[index];
        if (!existing) next.lines.push(queuedLine(id, names.get(id) ?? id, actor.staffId));
        else if (existing.status === 'FAILED' || existing.status === 'CANCELLED')
          next.lines[index] = requeued(existing, actor.staffId);
      }
      const pending = next.lines.filter((line) => !FINISHED.has(line.status)).length;
      if (pending > AI_BATCH_MAX_LINES)
        throw new BadRequestException(
          say(
            `لا يمكن أن تنتظر أكثر من ${String(AI_BATCH_MAX_LINES)} أسطر في الدفعة.`,
            `A batch holds at most ${String(AI_BATCH_MAX_LINES)} waiting lines.`,
          ),
        );
      return next;
    });
    if (!batch) throw new Error('unreachable: start always writes a batch');
    void this.prune(batch.id);
    this.kick();
    return { batch };
  }

  /**
   * Stops the batch. Waiting lines are cancelled; the line being worked on
   * stops after the call it is in, and a product it already created stays as
   * a draft, linked, with its slug on the line.
   */
  async cancel(): Promise<AiBatchView> {
    const batch = await this.mutate((current) => {
      if (current?.status !== 'RUNNING') return current;
      const now = new Date().toISOString();
      return {
        ...current,
        status: 'CANCELLED',
        finishedAt: now,
        lines: current.lines.map((line) =>
          FINISHED.has(line.status) ? line : { ...line, status: 'CANCELLED', finishedAt: now },
        ),
      };
    });
    return { batch };
  }

  /** Queues the failed and cancelled lines of the current batch again. */
  async retry(actor: Actor): Promise<AiBatchView> {
    const batch = await this.mutate((current) => {
      if (!current) return current;
      const again = current.lines.some(
        (line) => line.status === 'FAILED' || line.status === 'CANCELLED',
      );
      if (!again) return current;
      // A line in flight carries on; the runner takes the re-queued ones after it.
      return {
        ...current,
        status: 'RUNNING',
        finishedAt: null,
        lines: current.lines.map((line) =>
          line.status === 'FAILED' || line.status === 'CANCELLED'
            ? requeued(line, actor.staffId)
            : line,
        ),
      };
    });
    if (batch?.status === 'RUNNING') this.kick();
    return { batch };
  }

  /** Clears a finished batch from the panel. A running one must be stopped first. */
  async dismiss(): Promise<AiBatchView> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(${BATCH_WRITE_LOCK})`;
      const current = await readCurrentWith(tx);
      if (current?.status === 'RUNNING')
        throw new BadRequestException(
          say('أوقف الدفعة الجارية أولاً.', 'Stop the running batch first.'),
        );
      await tx.setting.deleteMany({ where: { key: AI_BATCH_CURRENT_KEY } });
    });
    return { batch: null };
  }

  // --- the runner ------------------------------------------------------------

  /** Starts working through the current batch in this process, unless it already is. */
  kick(): void {
    this.lastKick = Date.now();
    if (this.running) return;
    this.running = this.run()
      .catch((error: unknown) => this.logger.error(`AI batch run failed: ${message(error)}`))
      .finally(() => {
        this.running = null;
      });
  }

  /** Resolves when this process's run (if any) has finished. For tests. */
  async idle(): Promise<void> {
    await this.running;
  }

  private async run(): Promise<void> {
    for (;;) {
      const result = await withAdvisoryLock(this.prisma.client, BATCH_RUN_LOCK, () => this.step(), {
        timeoutMs: LINE_TIMEOUT_MS,
      });
      // Another process is on it, or there is nothing left.
      if (!result.ran || !result.value) return;
    }
  }

  /** Works on one line. False when the batch has nothing left to do. */
  private async step(): Promise<boolean> {
    const batch = await this.readCurrent();
    if (batch?.status !== 'RUNNING') return false;
    // A line left in flight by a process that died is resumed first.
    const line =
      batch.lines.find((entry) => IN_FLIGHT.has(entry.status)) ??
      batch.lines.find((entry) => entry.status === 'QUEUED');
    if (!line) {
      // Decided under the write lock: a line queued since the read above
      // keeps the batch running, and the loop comes back for it.
      let more = false;
      await this.mutateBatch(batch.id, (current) => {
        if (current.status !== 'RUNNING') return current;
        more = current.lines.some((entry) => !FINISHED.has(entry.status));
        return more
          ? current
          : { ...current, status: 'DONE', finishedAt: new Date().toISOString() };
      });
      return more;
    }
    await this.processLine(batch, line);
    return true;
  }

  private async processLine(batch: AiBatch, line: AiBatchLine): Promise<void> {
    const actor = { staffId: line.requestedById ?? batch.startedById };
    const notes = [...line.notes];
    /** Records progress; true when the batch was cancelled meanwhile. */
    const update = async (patch: LinePatch): Promise<boolean> => {
      const after = await this.updateLine(batch.id, line.itemId, patch);
      return after === null || after.status === 'CANCELLED';
    };
    const stop = (status: 'SKIPPED' | 'FAILED', error: string, extra: LinePatch = {}) =>
      update({ status, error, notes, finishedAt: new Date().toISOString(), ...extra });

    let step: AiBatchLineStatus = line.status === 'QUEUED' ? 'DRAFTING' : line.status;
    try {
      let { draft, productSlug, sku } = line;
      if (!productSlug) {
        const item = await this.prisma.client.supplierItem.findUnique({
          where: { id: line.itemId },
          include: {
            links: {
              take: 1,
              include: { variant: { select: { sku: true, product: { select: { slug: true } } } } },
            },
          },
        });
        if (!item) {
          await stop('FAILED', say('السطر لم يعد موجوداً.', 'The line no longer exists.'));
          return;
        }
        // A product this line drafted before a restart, created but not yet recorded.
        const found = draft
          ? await this.prisma.client.variant.findUnique({
              where: { sku: draft.sku },
              select: {
                sku: true,
                product: { select: { slug: true } },
                supplierLink: { select: { itemId: true } },
              },
            })
          : null;
        // Only if it is not some other line's: the SKU was free when drafted,
        // and a person may have taken it since.
        const adopted =
          found && (!found.supplierLink || found.supplierLink.itemId === item.id) ? found : null;
        if (found && !adopted) {
          await stop(
            'FAILED',
            say(
              `الرمز ${found.sku} أصبح لمنتج آخر. أعد المحاولة لاقتراح جديد.`,
              `The SKU ${found.sku} now belongs to another product. Retry for a fresh draft.`,
            ),
          );
          return;
        }

        if (adopted) {
          productSlug = adopted.product.slug;
          sku = adopted.sku;
        } else {
          const linked = item.links[0];
          if (linked) {
            await stop(
              'SKIPPED',
              say(
                'السطر مرتبط بمنتج من قبل؛ لم يُنشأ منتج جديد.',
                'The line is already linked to a product; nothing was created.',
              ),
              { productSlug: linked.variant.product.slug, sku: linked.variant.sku },
            );
            return;
          }
          if (item.missingSince) {
            await stop(
              'SKIPPED',
              say('السطر لم يعد في الشيت.', 'The line is no longer in the sheet.'),
            );
            return;
          }
          if (!draft) {
            step = 'DRAFTING';
            if (await update({ status: 'DRAFTING', startedAt: new Date().toISOString() })) return;
            draft = await this.ai.draftProduct(item.id);
            notes.push(...draft.notes);
          }
          step = 'CREATING';
          if (await update({ status: 'CREATING', draft, notes })) return;
          const created = await this.catalog.createProduct(
            createProductSchema.parse({
              slug: draft.slug,
              kind: draft.kind,
              nameAr: draft.nameAr,
              nameEn: draft.nameEn,
              ...(draft.brandId ? { brandId: draft.brandId } : {}),
              categoryIds: draft.categoryIds,
              variant: {
                sku: draft.sku,
                priceUsd: draft.priceUsd,
                licensePeriodUnit: draft.licensePeriodUnit,
                licensePeriodValue: draft.licensePeriodValue,
                deviceCount: draft.deviceCount,
                platform: draft.platform,
                activationMethod: draft.activationMethod,
                fulfillmentMode: 'ON_DEMAND',
              },
            }),
            actor.staffId,
          );
          productSlug = created.slug;
          sku = created.sku;
        }
        // Recorded before anything else can fail: a retry then reuses this
        // product instead of drafting and creating a second one. A stop is
        // honoured after the link below, so a product made is never left unlinked.
        await update({ productSlug, sku });
      }
      if (!sku) throw new Error('unreachable: a line with a product has its SKU');

      // An upsert, so also right for a retried line whose link failed before.
      await this.supplier.linkBySku(line.itemId, sku, actor);

      step = 'WRITING';
      if (await update({ status: 'WRITING', productSlug, sku, notes })) return;
      const copy = await this.ai.generateCopy(
        generateCopySchema.parse({ productSlug, locales: ['ar', 'en'] }),
      );
      notes.push(...copy.notes);
      for (const locale of ['ar', 'en'] as const) {
        const written = copy[locale];
        // Both languages or the line is not done; a retry writes them again.
        if (!written)
          throw new Error(say(`لم يُكتب نص ${locale}.`, `No ${locale} copy came back.`));
        await this.content.setContent(
          productSlug,
          setProductContentSchema.parse({ locale, blocks: written.blocks }),
          actor.staffId,
        );
        await this.admin.setProductCopy(
          productSlug,
          setProductCopySchema.parse({
            locale,
            seoTitle: written.seoTitle,
            seoDescription: written.seoDescription,
            shortDesc: written.shortDesc,
          }),
          actor.staffId,
          {},
        );
      }
      await update({ status: 'DONE', error: null, notes, finishedAt: new Date().toISOString() });
    } catch (error) {
      this.logger.warn(`AI batch line ${line.itemId} failed at ${step}: ${message(error)}`);
      await stop('FAILED', `${stepLabel(step)}: ${message(error)}`.slice(0, 1000)).catch(
        (saveError: unknown) =>
          this.logger.error(`Recording a failed AI batch line failed: ${message(saveError)}`),
      );
    }
  }

  // --- storage ---------------------------------------------------------------

  private async readCurrent(): Promise<AiBatch | null> {
    return readCurrentWith(this.prisma.client);
  }

  /**
   * Read, change and write the current batch under one lock, so the runner's
   * progress and a person's start or cancel never overwrite each other.
   */
  private async mutate(
    change: (current: AiBatch | null) => AiBatch | null,
  ): Promise<AiBatch | null> {
    return this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(${BATCH_WRITE_LOCK})`;
      const current = await readCurrentWith(tx);
      const next = change(current);
      if (next && next !== current) {
        const value = next as unknown as Prisma.InputJsonValue;
        const pointer = { id: next.id } as Prisma.InputJsonValue;
        await tx.setting.upsert({
          where: { key: aiBatchKey(next.id) },
          update: { value },
          create: { key: aiBatchKey(next.id), value },
        });
        await tx.setting.upsert({
          where: { key: AI_BATCH_CURRENT_KEY },
          update: { value: pointer },
          create: { key: AI_BATCH_CURRENT_KEY, value: pointer },
        });
      }
      return next;
    });
  }

  /** Read, change and write one batch by its id under the write lock. The pointer stays. */
  private async mutateBatch(id: string, change: (batch: AiBatch) => AiBatch): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(${BATCH_WRITE_LOCK})`;
      const row = await tx.setting.findUnique({ where: { key: aiBatchKey(id) } });
      const parsed = aiBatchSchema.safeParse(row?.value);
      if (!parsed.success) return;
      const next = change(parsed.data);
      if (next === parsed.data) return;
      await tx.setting.update({
        where: { key: aiBatchKey(id) },
        data: { value: next },
      });
    });
  }

  /**
   * One line's progress. A line cancelled meanwhile keeps its status; only
   * what it made (the draft, the product) is still recorded on it.
   */
  private async updateLine(
    batchId: string,
    itemId: string,
    patch: LinePatch,
  ): Promise<AiBatchLine | null> {
    let after: AiBatchLine | null = null;
    // By id, not "the current batch": a batch started after a stop must not
    // take away what the stopped batch's last line made.
    await this.mutateBatch(batchId, (current) => {
      const lines = current.lines.map((line) => {
        if (line.itemId !== itemId) return line;
        const next: AiBatchLine =
          line.status === 'CANCELLED'
            ? {
                ...line,
                ...pick(patch, ['draft', 'productSlug', 'sku', 'notes']),
              }
            : { ...line, ...patch };
        after = next;
        return next;
      });
      return { ...current, lines };
    });
    return after;
  }

  /** Finished batches older than a week, other than the current one. */
  private async prune(keep: string): Promise<void> {
    try {
      await this.prisma.client.setting.deleteMany({
        where: {
          key: { startsWith: aiBatchKey(''), not: aiBatchKey(keep) },
          updatedAt: { lt: new Date(Date.now() - BATCH_KEEP_MS) },
        },
      });
    } catch (error) {
      this.logger.warn(`Pruning AI batches failed: ${message(error)}`);
    }
  }
}

type SettingReader = Pick<Prisma.TransactionClient, 'setting'>;

async function readCurrentWith(db: SettingReader): Promise<AiBatch | null> {
  const pointer = await db.setting.findUnique({ where: { key: AI_BATCH_CURRENT_KEY } });
  const parsed = pointerSchema.safeParse(pointer?.value);
  if (!parsed.success) return null;
  const row = await db.setting.findUnique({ where: { key: aiBatchKey(parsed.data.id) } });
  const batch = aiBatchSchema.safeParse(row?.value);
  return batch.success ? batch.data : null;
}

function queuedLine(itemId: string, itemName: string, requestedById: string): AiBatchLine {
  return {
    itemId,
    itemName,
    status: 'QUEUED',
    requestedById,
    draft: null,
    productSlug: null,
    sku: null,
    error: null,
    notes: [],
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * A failed or cancelled line, queued again. One that made its product only
 * writes the copy; one that did not is drafted afresh, since what stopped it
 * (a slug taken meanwhile, an odd answer) would stop the same draft again.
 */
function requeued(line: AiBatchLine, requestedById: string): AiBatchLine {
  return {
    ...line,
    status: 'QUEUED',
    requestedById,
    draft: line.productSlug ? line.draft : null,
    error: null,
    finishedAt: null,
  };
}

function pick<T extends object, K extends keyof T>(value: T, keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const key of keys) if (value[key] !== undefined) out[key] = value[key];
  return out;
}

function stepLabel(step: AiBatchLineStatus): string {
  switch (step) {
    case 'DRAFTING':
      return say('اقتراح المنتج', 'Drafting');
    case 'CREATING':
      return say('إنشاء المنتج', 'Creating');
    case 'WRITING':
      return say('كتابة المحتوى', 'Writing the copy');
    default:
      return step;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
