import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { withAdvisoryLock } from '../common/advisory-lock.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * TASK-0084 / BUG-0004. Prunes dead staff sessions and stale retired token hashes.
 *
 * StaffSession rows accumulate indefinitely without pruning.
 * Sessions that expired or were revoked more than PRUNE_AFTER_DAYS ago are deleted.
 * Because StaffRetiredToken has onDelete: Cascade to StaffSession, dead session deletion
 * automatically clears its associated retired tokens.
 *
 * In addition, retired token hashes older than PRUNE_AFTER_DAYS from active sessions
 * are cleared so the StaffRetiredToken table remains bounded.
 */
export const PRUNE_AFTER_DAYS = 30;
export const SESSION_PRUNE_LOCK_KEY = 761_204_006;

export interface PruneResult {
  prunedSessions: number;
  prunedTokens: number;
}

@Injectable()
export class SessionPruneService {
  private readonly logger = new Logger(SessionPruneService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'session-prune' })
  async sweep(): Promise<PruneResult> {
    const result = await withAdvisoryLock(this.prisma.client, SESSION_PRUNE_LOCK_KEY, () =>
      this.run(),
    );
    return result.ran ? result.value : { prunedSessions: 0, prunedTokens: 0 };
  }

  async run(now = new Date()): Promise<PruneResult> {
    const cutoff = new Date(now.getTime() - PRUNE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    // 1. Delete dead sessions (expired or revoked older than cutoff)
    const deadSessions = await this.prisma.client.staffSession.deleteMany({
      where: {
        OR: [{ expiresAt: { lte: cutoff } }, { revokedAt: { not: null, lte: cutoff } }],
      },
    });

    // 2. Delete retired tokens older than cutoff from surviving sessions
    const staleTokens = await this.prisma.client.staffRetiredToken.deleteMany({
      where: {
        retiredAt: { lte: cutoff },
      },
    });

    if (deadSessions.count > 0 || staleTokens.count > 0) {
      this.logger.log(
        `Pruned ${deadSessions.count} dead staff session(s) and ${staleTokens.count} stale retired token(s).`,
      );
    }

    return {
      prunedSessions: deadSessions.count,
      prunedTokens: staleTokens.count,
    };
  }
}
