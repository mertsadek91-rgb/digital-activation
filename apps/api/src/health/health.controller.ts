import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { PrismaService } from '../prisma/prisma.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: string; at: string } {
    return { status: 'ok', at: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe — verifies the database round-trips',
  })
  async ready(): Promise<{ status: string; database: 'up' }> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
    } catch {
      // A 503, not a 200 saying "degraded". The proxy decides whether to send
      // traffic here from the status code alone, so a readiness probe that
      // answers 200 with the database down keeps routing checkouts to a
      // replica that cannot take them.
      throw new ServiceUnavailableException({ status: 'degraded', database: 'down' });
    }
    return { status: 'ok', database: 'up' };
  }
}
