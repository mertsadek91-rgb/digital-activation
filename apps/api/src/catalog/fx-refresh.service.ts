import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Prisma } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Keeps the exchange rates current.
 *
 * Nothing wrote `FxRate` before this, so every currency but the dollar had no
 * rate and `convert` fell back to USD: a shopper who chose dirhams saw dollars,
 * everywhere, with no error to say why.
 *
 * Once a day from a public feed (`FX_RATES_URL`, by default open.er-api.com,
 * which needs no key). Two guards, because a price is computed from whatever
 * lands here:
 *
 *  - a rate that is not a positive number is ignored;
 *  - a rate that moved more than 20% since the last one is held back and
 *    logged, not written. Gulf currencies are pegged and the rest do not move
 *    that far in a day; a jump that size is a broken feed, and writing it
 *    would reprice the store by a fifth.
 *
 * Checkout freezes the rate onto the order, so a refresh never changes what an
 * order already drafted will be charged.
 */
const DEFAULT_URL = 'https://open.er-api.com/v6/latest/USD';
const MAX_MOVE = 0.2;
const LOCK_KEY = 761_204_005;

export function acceptRate(next: number, previous: number | null): 'ok' | 'invalid' | 'jump' {
  if (!Number.isFinite(next) || next <= 0) return 'invalid';
  if (previous !== null && previous > 0 && Math.abs(next - previous) / previous > MAX_MOVE) {
    return 'jump';
  }
  return 'ok';
}

@Injectable()
export class FxRefreshService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FxRefreshService.name);

  constructor(private readonly prisma: PrismaService) {}

  private get enabled(): boolean {
    return process.env.FX_REFRESH !== 'off' && process.env.NODE_ENV !== 'test';
  }

  /** A store that has never had rates should not wait until 3am for its first. */
  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    void this.prisma.client.fxRate
      .count()
      .then((count) => (count === 0 ? this.refresh() : undefined))
      .catch((error: unknown) => {
        this.logger.warn(
          `Initial FX check failed: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      });
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'fx-refresh' })
  async refresh(): Promise<{ written: number; held: number }> {
    if (!this.enabled) return { written: 0, held: 0 };

    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!lock?.locked) return { written: 0, held: 0 };
    try {
      return await this.run();
    } catch (error) {
      // A feed that is down leaves yesterday's rates in place, which is the
      // right fallback; it must not take the API down with it.
      this.logger.error(`FX refresh failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return { written: 0, held: 0 };
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  private async run(): Promise<{ written: number; held: number }> {
    const source = process.env.FX_RATES_URL ?? DEFAULT_URL;
    const response = await fetch(source, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`feed answered ${String(response.status)}`);
    const body = (await response.json()) as { rates?: Record<string, unknown> };
    const rates = body.rates ?? {};

    const currencies = await this.prisma.client.currency.findMany({
      where: { isActive: true, NOT: { code: 'USD' } },
      include: { rates: { orderBy: { fetchedAt: 'desc' }, take: 1 } },
    });

    const fetchedAt = new Date();
    let written = 0;
    let held = 0;
    for (const currency of currencies) {
      const next = Number(rates[currency.code]);
      const previous = currency.rates[0] ? currency.rates[0].rate.toNumber() : null;
      const verdict = acceptRate(next, previous);
      if (verdict === 'invalid') continue;
      if (verdict === 'jump') {
        held += 1;
        this.logger.warn(
          `FX ${currency.code} moved from ${String(previous)} to ${String(next)}; held back, not written.`,
        );
        continue;
      }
      await this.prisma.client.fxRate.create({
        data: {
          currencyCode: currency.code,
          rate: new Prisma.Decimal(next),
          source: new URL(source).host,
          fetchedAt,
        },
      });
      written += 1;
    }
    this.logger.log(`FX refresh: ${String(written)} written, ${String(held)} held back.`);
    return { written, held };
  }
}
