import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { FulfillmentState, OrderStatus } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

import { FulfillmentService } from './fulfillment.service.js';

/**
 * Finds paid orders that nothing is working on, and works them.
 *
 * The payment webhook runs fulfilment straight after marking an order paid.
 * When that second step fails — SMTP down, the vault unreachable, a deploy
 * killing the process between the two — the order is PAID with lines still
 * PENDING, and before this existed nothing ever looked at it again: the
 * customer had paid and nobody was sending them anything.
 *
 * A sweep for the same reason the review invites are one: the question it asks
 * is about the state of the database, so it also catches what failed while
 * this process was down. `onOrderPaid` is idempotent by line state, so an order
 * the webhook is handling at the same moment is not delivered twice.
 */

/** Old enough that the webhook has had its chance. */
const GRACE_MS = 5 * 60 * 1000;
const PER_PASS = 20;

/** Distinct from every other advisory lock in the codebase. */
const LOCK_KEY = 761_204_002;

@Injectable()
export class StrandedSweepService {
  private readonly logger = new Logger(StrandedSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'stranded-orders' })
  async sweep(): Promise<{ worked: number; failed: number }> {
    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!lock?.locked) return { worked: 0, failed: 0 };

    try {
      return await this.run();
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  private async run(): Promise<{ worked: number; failed: number }> {
    const orders = await this.prisma.client.order.findMany({
      where: {
        status: OrderStatus.PAID,
        paidAt: { lte: new Date(Date.now() - GRACE_MS) },
        items: { some: { fulfillmentState: FulfillmentState.PENDING } },
      },
      orderBy: { paidAt: 'asc' },
      take: PER_PASS,
      select: { number: true },
    });

    let worked = 0;
    let failed = 0;
    for (const order of orders) {
      try {
        await this.fulfillment.onOrderPaid(order.number);
        worked += 1;
      } catch (error) {
        // One bad order must not stop the rest of the pass; it is still PAID
        // with PENDING lines, so the next pass tries it again.
        failed += 1;
        this.logger.error(
          `Could not fulfil stranded order ${order.number}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
    if (worked + failed > 0) {
      this.logger.warn(`Stranded-order sweep: ${String(worked)} worked, ${String(failed)} failed.`);
    }
    return { worked, failed };
  }
}
