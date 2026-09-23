import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { MarketingAdminController, MarketingPublicController } from './marketing.controller.js';
import { MarketingSettingsService } from './marketing-settings.service.js';

/**
 * The marketing features' shared configuration. Feature modules import this
 * for `MarketingSettingsService` and read their own document from it.
 */
@Module({
  imports: [AuthModule],
  controllers: [MarketingAdminController, MarketingPublicController],
  providers: [MarketingSettingsService],
  exports: [MarketingSettingsService],
})
export class MarketingModule {}
