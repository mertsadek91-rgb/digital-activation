import { Controller, Get } from '@nestjs/common';
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
  async ready(): Promise<{ status: string; database: 'up' | 'down' }> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
