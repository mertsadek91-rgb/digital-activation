import { Module } from '@nestjs/common';

import { GrowthModule } from '../growth/growth.module.js';
import { MailModule } from '../mail/mail.module.js';

import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** Back-in-stock alerts and the double-opt-in newsletter. */
@Module({
  // GrowthModule for the welcome window's code, minted on confirmation.
  imports: [MailModule, GrowthModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
})
export class SubscriptionsModule {}
