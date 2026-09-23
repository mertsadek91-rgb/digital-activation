import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MarketingModule } from '../marketing/marketing.module.js';

import { WhatsappAdminController, WhatsappWebhookController } from './whatsapp.controller.js';
import { WhatsappService } from './whatsapp.service.js';

/**
 * WhatsApp through Meta's Cloud API: sending templates, the webhook, and the
 * admin screen's status and test. The retention sweeps import it to deliver a
 * step on WhatsApp instead of email for customers who agreed to that.
 */
@Module({
  imports: [AuthModule, MarketingModule],
  controllers: [WhatsappWebhookController, WhatsappAdminController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
