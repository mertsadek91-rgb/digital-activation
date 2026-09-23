import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MarketingModule } from '../marketing/marketing.module.js';

import {
  MarketingSignalsAdminController,
  SocialProofController,
} from './marketing-signals.controller.js';
import { MarketingSignalsService } from './marketing-signals.service.js';

/**
 * Trust signals built from the store's own records: purchase notices from
 * paid orders, and the review-invitation figures. The settings themselves live
 * in `MarketingModule`; this module only reads them.
 */
@Module({
  imports: [AuthModule, MarketingModule],
  controllers: [SocialProofController, MarketingSignalsAdminController],
  providers: [MarketingSignalsService],
})
export class MarketingSignalsModule {}
