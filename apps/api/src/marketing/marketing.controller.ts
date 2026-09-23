import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type MarketingFeature,
  type MarketingSettings,
  type PublicMarketing,
  marketingFeatureSchema,
  publicMarketingSchema,
} from '@da/contracts';

import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { MarketingSettingsService } from './marketing-settings.service.js';

/**
 * The marketing panel's settings. ADMIN and MARKETING: these are marketing
 * decisions, and every change is audited with its before and after.
 */
@ApiTags('admin')
@Controller('admin/marketing')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'MARKETING')
export class MarketingAdminController {
  constructor(private readonly settings: MarketingSettingsService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Every marketing feature and its configuration' })
  all(): Promise<MarketingSettings> {
    return this.settings.all();
  }

  @Put('settings/:feature')
  @ApiOperation({ summary: 'Replace one marketing feature’s configuration' })
  set(
    @Param('feature', new ZodPipe(marketingFeatureSchema)) feature: MarketingFeature,
    @Body() body: unknown,
    @Req() request: StaffRequest,
  ): Promise<unknown> {
    // Validated inside against that feature's own schema; a ZodPipe here
    // would need to know the feature before the body is read.
    return this.settings.set(feature, body, {
      staffId: request.staff?.sub ?? '',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}

/** What the storefront reads: display parts only, disabled features as null. */
@ApiTags('marketing')
@Controller('marketing')
export class MarketingPublicController {
  constructor(private readonly settings: MarketingSettingsService) {}

  @Get('public')
  @ZodResponse(publicMarketingSchema)
  @ApiOperation({ summary: 'Storefront-visible marketing configuration' })
  view(): Promise<PublicMarketing> {
    return this.settings.publicView();
  }
}
