import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type ReviewRequestStats,
  type SocialProof,
  type SocialProofPreview,
  socialProofQuerySchema,
  socialProofSchema,
  socialProofPreviewSchema,
  reviewRequestStatsSchema,
} from '@da/contracts';

import { Roles, StaffGuard } from '../auth/staff.guard.js';
import { ZodResponse } from '../common/openapi.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { MarketingSignalsService } from './marketing-signals.service.js';

/**
 * Purchase notices for a product page.
 *
 * Called from the visitor's browser, not from the storefront's server, so a
 * per-IP limit is meaningful here (unlike the catalog, where every request
 * arrives from the Next.js host). Thirty a minute is far more than one person
 * browsing product pages asks for, and far less than a scraper wants.
 */
@ApiTags('marketing')
@Controller('marketing')
export class SocialProofController {
  constructor(private readonly signals: MarketingSignalsService) {}

  @Get('social-proof')
  @ZodResponse(socialProofSchema)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  // The same five minutes the server caches for; a browser moving between
  // variants of one product does not need to ask again.
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Recent paid orders for a product, anonymised, above the minimum' })
  get(
    @Query(new ZodPipe(socialProofQuerySchema)) query: { productSlug: string },
  ): Promise<SocialProof> {
    return this.signals.socialProof(query.productSlug);
  }
}

/** The figures the trust-signal settings screens show beside their fields. */
@ApiTags('admin')
@Controller('admin/marketing')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'MARKETING')
export class MarketingSignalsAdminController {
  constructor(private readonly signals: MarketingSignalsService) {}

  @Get('social-proof/preview')
  @ZodResponse(socialProofPreviewSchema)
  @ApiOperation({ summary: 'Which products would show a purchase notice now' })
  preview(): Promise<SocialProofPreview> {
    return this.signals.socialProofPreview();
  }

  @Get('review-requests/stats')
  @ZodResponse(reviewRequestStatsSchema)
  @ApiOperation({ summary: 'Review invitations sent in the last 30 days' })
  reviewStats(): Promise<ReviewRequestStats> {
    return this.signals.reviewRequestStats(30);
  }
}
