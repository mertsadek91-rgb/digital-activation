import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RedisService } from '../infra/redis.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

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
}
