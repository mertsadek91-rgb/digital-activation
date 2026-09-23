import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module.js';

import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';

/** Back-in-stock alerts and the double-opt-in newsletter. */
@Module({
  imports: [MailModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
})
export class SubscriptionsModule {}
