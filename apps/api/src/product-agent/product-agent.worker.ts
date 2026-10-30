import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AgentBatchStatus, AgentItemStatus } from '@da/db';

import { withAdvisoryLock } from '../common/advisory-lock.js';
import { onceEvery } from '../infra/once-every.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { MAX_ATTEMPTS, STALE_MS, TICK_MS, appendLog } from './agent-rules.js';
import { ProductAgentRunner } from './product-agent.runner.js';

/** Distinct from every other advisory lock in the codebase. */
const LOCK_KEY = 761_204_012;

/**
 * Picks the next product for the agent (CR-0007).
 *
 * One product at a time across every replica of the API: the claim runs under
 * an advisory lock and refuses while any item is RUNNING, and a batch's
 * `nextRunAt` holds the cooldown after each product. The lock is held only
 * for the claim — a product takes minutes of model calls, far longer than a
 * transaction should stay open — and the item's heartbeat is what tells a
 * later tick that a worker died mid-product (a deploy, a restart).
 *
 * `PRODUCT_AGENT=off` (or `CRON_JOBS=off`) switches the worker off on an API, for local runs
 * against a database nobody should be writing product pages into.
 */
@Injectable()
export class ProductAgentWorker {
  private readonly logger = new Logger(ProductAgentWorker.name);
  private readonly missingTables = onceEvery(60 * 60 * 1000);
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: ProductAgentRunner,
  ) {}

  get enabled(): boolean {
    return process.env.PRODUCT_AGENT !== 'off' && process.env.CRON_JOBS !== 'off';
  }

  @Interval('product-agent', TICK_MS)
  async tick(): Promise<void> {
    // Intervals do not wait for the previous call: one product per process.
    if (!this.enabled || this.busy) return;
    this.busy = true;
    try {
      // Idle most of the time: one cheap count, and no lock, until there is work.
      const pending = await this.prisma.client.agentItem.count({
        where: {
          OR: [
            { status: AgentItemStatus.RUNNING },
            { status: AgentItemStatus.QUEUED, batch: { status: AgentBatchStatus.RUNNING } },
          ],
        },
      });
      if (pending === 0) return;
      const claimed = await withAdvisoryLock(this.prisma.client, LOCK_KEY, () => this.claim(), {
        timeoutMs: 30_000,
      });
      if (claimed.ran && claimed.value) {
        const itemId = claimed.value;
        await this.runner.work(itemId).catch(async (error: unknown) => {
          // Thrown before the runner could record an outcome: fail the item
          // now rather than hold every batch until it goes stale.
          await this.prisma.client.agentItem.updateMany({
            where: { id: itemId, status: AgentItemStatus.RUNNING },
            data: {
              status: AgentItemStatus.FAILED,
              step: null,
              error: (error instanceof Error ? error.message : 'unknown error').slice(0, 2000),
              finishedAt: new Date(),
            },
          });
          throw error;
        });
        await this.finishBatches();
      }
    } catch (error) {
      // Before the migration reaches a database the tables are missing; say
      // so once an hour rather than every tick.
      const missing = (error as { code?: unknown } | null)?.code === 'P2021';
      if (!missing || this.missingTables()) {
        this.logger.error(
          `Product agent tick failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    } finally {
      this.busy = false;
    }
  }

  /** The next item to work, now RUNNING, or null. */
  private async claim(): Promise<string | null> {
    const now = new Date();
    await this.recoverStale(now);

    const running = await this.prisma.client.agentItem.count({
      where: { status: AgentItemStatus.RUNNING },
    });
    if (running > 0) return null;

    const batch = await this.prisma.client.agentBatch.findFirst({
      where: {
        status: AgentBatchStatus.RUNNING,
        nextRunAt: { lte: now },
        items: { some: { status: AgentItemStatus.QUEUED } },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!batch) {
      await this.finishBatches();
      return null;
    }
    const item = await this.prisma.client.agentItem.findFirst({
      where: { batchId: batch.id, status: AgentItemStatus.QUEUED },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!item) return null;
    await this.prisma.client.agentItem.update({
      where: { id: item.id },
      data: {
        status: AgentItemStatus.RUNNING,
        attempts: { increment: 1 },
        startedAt: now,
        heartbeatAt: now,
        step: 'start',
        error: null,
      },
    });
    return item.id;
  }

  /** RUNNING items whose worker stopped touching them: queued again, or failed after enough tries. */
  private async recoverStale(now: Date): Promise<void> {
    const stale = await this.prisma.client.agentItem.findMany({
      where: {
        status: AgentItemStatus.RUNNING,
        heartbeatAt: { lt: new Date(now.getTime() - STALE_MS) },
      },
      select: { id: true, attempts: true, log: true },
    });
    for (const item of stale) {
      const retry = item.attempts < MAX_ATTEMPTS;
      const detail = 'The worker stopped before this product finished (most likely a restart).';
      await this.prisma.client.agentItem.update({
        where: { id: item.id },
        data: {
          status: retry ? AgentItemStatus.QUEUED : AgentItemStatus.FAILED,
          step: null,
          error: retry ? null : detail,
          finishedAt: retry ? null : now,
          log: appendLog(item.log, 'workerLost', retry ? 'warn' : 'error', detail),
        },
      });
    }
  }

  /** RUNNING batches with nothing left to do are DONE. */
  private async finishBatches(): Promise<void> {
    await this.prisma.client.agentBatch.updateMany({
      where: {
        status: AgentBatchStatus.RUNNING,
        items: {
          none: { status: { in: [AgentItemStatus.QUEUED, AgentItemStatus.RUNNING] } },
        },
      },
      data: { status: AgentBatchStatus.DONE, finishedAt: new Date() },
    });
  }
}
