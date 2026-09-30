import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { withAdvisoryLock } from '../common/advisory-lock.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** B.5: the notification log keeps thirty days. */
export const FP_LOG_RETENTION_DAYS = 30;
export const FP_LOG_PRUNE_LOCK_KEY = 761_204_007;

/**
 * Drops Final Processor log rows older than thirty days, once a day.
 *
 * The log is for diagnosing a problem this week, not an accounting record:
 * what a webhook did to an order is on the order itself (its status history,
 * payment and refund rows), which this never touches.
 */
@Injectable()
export class FpLogPruneService {
  private readonly logger = new Logger(FpLogPruneService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('17 3 * * *', { name: 'prune-fp-webhook-log' })
  async sweep(now: Date = new Date()): Promise<{ deleted: number }> {
    const result = await withAdvisoryLock(this.prisma.client, FP_LOG_PRUNE_LOCK_KEY, () =>
      this.run(now),
    );
    return result.ran ? result.value : { deleted: 0 };
  }

  private async run(now: Date): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - FP_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.client.paymentWebhookLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) this.logger.log(`Pruned ${String(count)} Final Processor log row(s).`);
    return { deleted: count };
  }
}
