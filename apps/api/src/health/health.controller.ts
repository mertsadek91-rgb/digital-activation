import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { internalKeyMatches } from '../common/internal-caller.js';
import { RedisService } from '../infra/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import {
  type CronJobView,
  type DeliveryHealth,
  type SweepHealth,
  cronStatus,
  readBacklogs,
  readDelivery,
  sweepHealth,
} from './ops-checks.js';

/**
 * Routes outside the `/v1` prefix. main.ts and the OpenAPI script both read
 * this, so a probe added here cannot end up prefixed in one and not the other.
 * Keeping them under `/health` also keeps them out of the request log and out
 * of the error reporter, which both skip that path.
 */
export const UNPREFIXED_ROUTES = ['health', 'health/ready', 'health/sweeps', 'health/delivery'];

/** The header an uptime monitor sends `MONITOR_API_KEY` in. */
export const MONITOR_KEY_HEADER = 'x-da-monitor';

/**
 * Per connecting address. A monitor polls once a minute or so from a handful
 * of addresses; 30 leaves room for retries and still makes guessing the key
 * over these two routes pointless. The guard runs before `admit`, so a wrong
 * key counts against the limit too.
 */
const PROBE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/** Set once, when the module loads: a cron that has not fired yet is judged from here. */
const BOOTED_AT = new Date();

interface Readiness {
  status: 'ok' | 'degraded';
  database: 'up';
  redis: 'up' | 'down';
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; at: string } {
    return { status: 'ok', at: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe — the database must round-trip; Redis is reported, not required',
  })
  async ready(): Promise<Readiness> {
    const [database, redis] = await Promise.all([
      this.prisma.client.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.redis.ping(),
    ]);

    if (!database) {
      // A 503, not a 200 saying "degraded". The proxy decides whether to send
      // traffic here from the status code alone, so a readiness probe that
      // answers 200 with the database down keeps routing checkouts to a
      // replica that cannot take them.
      throw new ServiceUnavailableException({
        status: 'degraded',
        database: 'down',
        redis: redis ? 'up' : 'down',
      });
    }

    // Redis down is a 200: rate limits fall back to per-process counters and
    // everything else keeps serving, so taking the replica out of rotation
    // would turn a degraded store into no store. The body says so for whoever
    // is watching.
    return { status: redis ? 'ok' : 'degraded', database: 'up', redis: redis ? 'up' : 'down' };
  }

  /**
   * The monitoring probes carry order volume and queue state, so they answer
   * only a caller holding `MONITOR_API_KEY` in `x-da-monitor` — an uptime
   * monitor, not a visitor. With no key configured they do not exist.
   *
   * Not `INTERNAL_API_KEY`: that key also lets its holder set the address a
   * per-visitor rate limit counts (`internal-caller.ts`), and a monitoring
   * vendor has no business holding it. This key grants these two reads only.
   */
  private admit(presented: string | undefined): void {
    const key = process.env.MONITOR_API_KEY;
    if (!key) throw new NotFoundException();
    if (!internalKeyMatches(presented, key)) throw new UnauthorizedException();
  }

  @Get('sweeps')
  @ApiOperation({
    summary:
      'Monitoring probe — 503 when a scheduled job has stopped firing or left work behind (x-da-monitor)',
  })
  @Throttle(PROBE_LIMIT)
  async sweeps(@Headers(MONITOR_KEY_HEADER) presented?: string): Promise<SweepHealth> {
    this.admit(presented);
    const now = new Date();
    const jobs = [...this.scheduler.getCronJobs().entries()].map(([name, job]) => {
      const [next, after] = job.nextDates(2);
      const view: CronJobView = {
        name,
        active: job.isActive,
        lastRunAt: job.lastDate(),
        periodMs: next && after ? after.toMillis() - next.toMillis() : 0,
      };
      return cronStatus(view, BOOTED_AT, now);
    });
    const backlogs = await readBacklogs(this.prisma.client, now);
    const health = sweepHealth(jobs, backlogs.strandedLines, backlogs.overdueDrafts);
    if (health.status === 'alert') throw new ServiceUnavailableException(health);
    return health;
  }

  @Get('delivery')
  @ApiOperation({
    summary:
      'Monitoring probe — 503 when a paid line was, or still is, past its delivery promise (x-da-monitor)',
  })
  @Throttle(PROBE_LIMIT)
  async delivery(@Headers(MONITOR_KEY_HEADER) presented?: string): Promise<DeliveryHealth> {
    this.admit(presented);
    const health = await readDelivery(this.prisma.client, new Date());
    if (health.status === 'alert') throw new ServiceUnavailableException(health);
    return health;
  }
}
