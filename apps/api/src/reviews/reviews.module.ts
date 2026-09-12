import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MailModule } from '../mail/mail.module.js';

import { InviteSweepService } from './invite-sweep.service.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsService } from './reviews.service.js';

/**
 * Reviews: one service, three audiences.
 *
 * The service is shared rather than split because the moderation decision and
 * the published list are two halves of one invariant — approving a row is what
 * puts it in the list and what rewrites the product's cached average. Two
 * services would be two places that could disagree about which rows count.
 *
 * The customer's own routes are in the account module and the moderation
 * routes are in the admin module; both import this. Only the public read is
 * mounted here.
 *
 * `invite` is called by `InviteSweepService`, on an hourly sweep rather than
 * from fulfilment. Wiring it to fulfilment would put a marketing email inside
 * the transaction that delivers a licence key, which is the one path in this
 * system that must not grow a dependency on SMTP.
 */
@Module({
  imports: [AuthModule, MailModule],
  controllers: [ReviewsController],
  providers: [ReviewsService, InviteSweepService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
