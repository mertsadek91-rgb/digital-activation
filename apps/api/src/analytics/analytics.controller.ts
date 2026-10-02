import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AnalyticsSummary,
  type RecordAnalyticsEvent,
  analyticsSummarySchema,
  recordAnalyticsEventSchema,
} from '@da/contracts';
import { isIP } from 'node:net';

import { Roles, StaffGuard } from '../auth/staff.guard.js';
import { VisitorThrottle } from '../common/explicit-throttler.guard.js';
import {
  CLIENT_IP_HEADER,
  INTERNAL_KEY_HEADER,
  internalKeyMatches,
} from '../common/internal-caller.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { AnalyticsService } from './analytics.service.js';

/** The visitor's own user agent, forwarded by the storefront's server. */
export const CLIENT_UA_HEADER = 'x-da-client-ua';

/**
 * Where the storefront's server reports a browsing event.
 *
 * Server to server only: the call must carry `INTERNAL_API_KEY`, which is
 * also what makes the forwarded visitor address believable. Without the key
 * configured there is no caller to believe and every call is refused. The
 * visitor's address and user agent arrive as headers, are hashed into the
 * day's visitor id, and are not stored.
 */
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  // A page view is one call; a visitor making more than a couple a second is a script.
  @VisitorThrottle(120)
  @Post('events')
  @HttpCode(202)
  @ApiOperation({ summary: 'Record a storefront browsing event (storefront server only)' })
  async record(
    @Body() raw: unknown,
    @Headers(INTERNAL_KEY_HEADER) key?: string,
    @Headers(CLIENT_IP_HEADER) clientIp?: string,
    @Headers(CLIENT_UA_HEADER) clientUa?: string,
  ): Promise<{ recorded: boolean }> {
    // The key first, the body second: a caller without the key learns nothing,
    // not even what a valid event looks like.
    if (!internalKeyMatches(key, process.env.INTERNAL_API_KEY)) throw new UnauthorizedException();
    const body: RecordAnalyticsEvent = new ZodPipe(recordAnalyticsEventSchema).transform(raw);
    const ip = typeof clientIp === 'string' && isIP(clientIp) !== 0 ? clientIp : undefined;
    const userAgent = typeof clientUa === 'string' ? clientUa.slice(0, 512) : undefined;
    return { recorded: await this.analytics.record(body, { ip, userAgent }) };
  }
}

/** Counts per type and day for the panel. OWNER and ADMIN. */
@ApiTags('admin')
@Controller('admin/analytics')
@UseGuards(StaffGuard)
@Roles('ADMIN')
export class AnalyticsAdminController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @ZodResponse(analyticsSummarySchema)
  @ApiOperation({ summary: 'Browsing events and daily visitors per type and day (30 days)' })
  summary(): Promise<AnalyticsSummary> {
    return this.analytics.summary();
  }
}
