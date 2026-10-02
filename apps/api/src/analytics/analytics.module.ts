import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';

import { AnalyticsAdminController, AnalyticsController } from './analytics.controller.js';
import { AnalyticsPruneService } from './analytics-prune.service.js';
import { AnalyticsService } from './analytics.service.js';
import { VisitorSaltService } from './visitor-salt.service.js';

/**
 * First-party analytics (TASK-0096): product, category and cart views and
 * WhatsApp clicks, reported by the storefront's server. No browser script, no
 * cookie, no third party. The commerce funnel is read from its own tables.
 */
@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController, AnalyticsAdminController],
  providers: [AnalyticsService, AnalyticsPruneService, VisitorSaltService],
})
export class AnalyticsModule {}
