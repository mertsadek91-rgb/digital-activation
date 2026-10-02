import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

/** Bytes of randomness in a day's salt. */
export const SALT_BYTES = 32;

/** Midnight UTC of `now`'s day: the key of its salt row (a Postgres DATE). */
export function utcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * The random salt each UTC day's visitor ids are made with (TASK-0097).
 *
 * Kept in `AnalyticsSalt`, one row per day, so every API replica hashes a
 * visitor the same way, and deleted after the day by the prune sweep, after
 * which nobody, holder of any secret included, can recompute that day's ids.
 *
 * Race-safe across replicas: each one inserts a fresh salt with
 * `skipDuplicates` (INSERT ... ON CONFLICT DO NOTHING) and then reads the row
 * back, so whichever insert landed first is the one everybody uses. Within one
 * process the lookup is shared while in flight and cached until the day changes.
 */
@Injectable()
export class VisitorSaltService {
  private readonly logger = new Logger(VisitorSaltService.name);
  private cached?: { day: number; salt: Uint8Array };
  private pending?: { day: number; salt: Promise<Uint8Array | null> };

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The salt for `now`'s UTC day, created on first use. Null when the
   * database cannot be reached: the event is then recorded without a visitor.
   */
  async saltFor(now: Date = new Date()): Promise<Uint8Array | null> {
    const day = utcDay(now);
    const key = day.getTime();
    if (this.cached?.day === key) return this.cached.salt;
    if (this.pending?.day === key) return this.pending.salt;

    const salt = this.load(day).finally(() => {
      if (this.pending?.day === key) this.pending = undefined;
    });
    this.pending = { day: key, salt };
    return salt;
  }

  private async load(day: Date): Promise<Uint8Array | null> {
    try {
      const client = this.prisma.client;
      await client.analyticsSalt.createMany({
        data: [{ day, salt: new Uint8Array(randomBytes(SALT_BYTES)) }],
        skipDuplicates: true,
      });
      const row = await client.analyticsSalt.findUnique({
        where: { day },
        select: { salt: true },
      });
      if (!row) return null;
      // Never cache a failure: the next event tries again.
      this.cached = { day: day.getTime(), salt: row.salt };
      return row.salt;
    } catch (error) {
      this.logger.warn(
        `Analytics salt unavailable; recording without a visitor id (${error instanceof Error ? error.name : 'error'}).`,
      );
      return null;
    }
  }
}
