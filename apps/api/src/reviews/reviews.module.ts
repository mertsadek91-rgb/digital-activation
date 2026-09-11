import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MailModule } from '../mail/mail.module.js';

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
 * `invite` is exposed and called by nothing. It belongs on a schedule — three
 * days after an order reaches FULFILLED, and again at ten — and the worker in
 * `workers/jobs/` has no processors yet. Wiring it to fulfilment instead would
 * put the email inside the transaction that delivers a licence key, which is
 * the one path in this system that must not grow a dependency on SMTP.
 */
@Module({
  imports: [AuthModule, MailModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
