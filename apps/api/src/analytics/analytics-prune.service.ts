import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { withAdvisoryLock } from '../common/advisory-lock.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { utcDay } from './visitor-salt.service.js';

/** Tracking plan §5: raw events are kept 13 months, enough for year on year. */
export const ANALYTICS_RETENTION_MONTHS = 13;
export const ANALYTICS_PRUNE_LOCK_KEY = 761_204_008;

/** The oldest moment a row may carry and still be kept. */
export function analyticsCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - ANALYTICS_RETENTION_MONTHS);
  return cutoff;
}

/**
 * Deletes analytics events older than 13 months, and every visitor salt older
 * than the current UTC day, once a day.
 *
 * Under an advisory lock like every sweep, so two replicas do not both run
 * it. A day's worth of rows at a time in steady state, so one statement each.
 * Deleting a salt is what makes that day's visitor ids irreversible
 * (TASK-0097); today's is kept because today's events still need it. So a
 * day's salt lives until 03:29 UTC the next day (about 27.5 hours at most),
 * and in the daily database backups for as long as those are kept: the real
 * irreversibility window is the backup retention, not the day.
 */
@Injectable()
export class AnalyticsPruneService {
  private readonly logger = new Logger(AnalyticsPruneService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('29 3 * * *', { name: 'prune-analytics-events' })
  async sweep(now: Date = new Date()): Promise<{ deleted: number; saltsDeleted: number }> {
    const result = await withAdvisoryLock(this.prisma.client, ANALYTICS_PRUNE_LOCK_KEY, () =>
      this.run(now),
    );
    return result.ran ? result.value : { deleted: 0, saltsDeleted: 0 };
  }

  private async run(now: Date): Promise<{ deleted: number; saltsDeleted: number }> {
    // Salts first: they are the privacy-critical half, and a failure deleting
    // events must not leave yesterday's salt behind.
    const salts = await this.prisma.client.analyticsSalt.deleteMany({
      where: { day: { lt: utcDay(now) } },
    });
    if (salts.count > 0) this.logger.log(`Deleted ${String(salts.count)} past visitor salt(s).`);
    const { count } = await this.prisma.client.analyticsEvent.deleteMany({
      where: { createdAt: { lt: analyticsCutoff(now) } },
    });
    if (count > 0) this.logger.log(`Pruned ${String(count)} analytics event(s).`);
    return { deleted: count, saltsDeleted: salts.count };
  }
}
