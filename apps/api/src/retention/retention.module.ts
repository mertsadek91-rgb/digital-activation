import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CartModule } from '../cart/cart.module.js';
import { MailModule } from '../mail/mail.module.js';
import { MarketingModule } from '../marketing/marketing.module.js';

import { CartRecoveryService } from './cart-recovery.service.js';
import { RenewalSweepService } from './renewal-sweep.service.js';
import { RetentionPublicController, RetentionStatsController } from './retention.controller.js';
import { RetentionStatsService } from './retention-stats.service.js';

/**
 * Retention: renewal reminders and the abandoned-cart ladder.
 *
 * Both are sweeps over the database with their own advisory locks, both read
 * their settings from the marketing panel, and neither sits on the payment or
 * fulfilment path — the only line elsewhere that knows about them is the one
 * in `markPaid` that marks an emailed cart RECOVERED instead of CLOSED.
 */
@Module({
  imports: [AuthModule, CartModule, MailModule, MarketingModule],
  controllers: [RetentionStatsController, RetentionPublicController],
  providers: [RenewalSweepService, CartRecoveryService, RetentionStatsService],
})
export class RetentionModule {}
