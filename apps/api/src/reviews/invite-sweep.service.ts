import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { FulfillmentState } from '@da/db';

import { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

import { reviewStages } from './review-stages.js';
import { ReviewsService } from './reviews.service.js';

/**
 * What actually asks a customer for a review.
 *
 * `ReviewsService.invite` has existed since the review system was built and
 * nothing called it, which means this store had a review system that could
 * only be used by somebody who already knew the page was there. The legacy
 * store solved the same problem by buying 565 fabricated reviews. The honest
 * version of that is asking, twice, and accepting that most people will not
 * answer.
 *
 * A sweep rather than a job scheduled at delivery time. The difference matters
 * in exactly one case, and it is the case that happens: an order delivered
 * while this process was down or being deployed. A delayed queue entry pushed
 * at delivery would never have been created and nobody would ever find out; a
 * sweep picks it up on the next pass because the question it asks is about the
 * state of the database, not about what was scheduled. It also needs no Redis,
 * which keeps a marketing email off the critical path of the one queue that
 * carries licence deliveries.
 *
 * Two stages, matching the `ReviewInvite.stage` column: by default day 3,
 * when the thing has been used and is still recent, and day 10 for the people
 * who meant to and did not. The days come from the `reviewRequests` marketing
 * settings (see `reviewStages`), read on every pass so a change on the panel
 * applies from the next hour without a deploy. There is no third, because a
 * third is when people stop reading anything the sender writes.
 */

/**
 * How many go out in one pass.
 *
 * There is a backlog the first time this runs — every order delivered before
 * today is instantly due — and sending all of them at once is both a spike
 * against the mail provider's rate limit and a batch of identical emails
 * arriving in one minute, which is what a spam filter looks for. Thirty an
 * hour clears any realistic backlog within a day and looks like a store.
 */
const PER_PASS = 30;

/**
 * The hours an invitation may be sent, in the store's timezone.
 *
 * A transactional email arrives when the thing happened; a marketing one
 * arrives when the recipient is awake. Delivery times cluster around when
 * people buy, so without this the day-3 email would land at whatever hour the
 * original purchase did — including 3am, which is a purchase this store really
 * does take.
 */
const EARLIEST_HOUR = 9;
const LATEST_HOUR = 20;

/**
 * A Postgres advisory lock, so two API replicas do not both sweep.
 *
 * `ReviewInvite` has a unique constraint on (orderId, stage), but the send
 * happens before that row is written — deliberately, so a failed send does not
 * mark the customer as asked. That leaves a window where two concurrent sweeps
 * could both send, and the one thing worse than not asking for a review is
 * asking twice in the same minute. The number is arbitrary and only has to be
 * distinct from any other advisory lock this codebase takes.
 */
const LOCK_KEY = 761_204_001;

@Injectable()
export class InviteSweepService {
  private readonly logger = new Logger(InviteSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
    private readonly settings: MarketingSettingsService,
  ) {}

  private get timeZone(): string {
    return process.env.STORE_TIMEZONE ?? 'Asia/Riyadh';
  }

  /** The hour of day in the store's timezone, without pulling in a date library. */
  private storeHour(now: Date): number {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timeZone,
      hour: 'numeric',
      hour12: false,
    }).format(now);
    return Number.parseInt(formatted, 10);
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'review-invites' })
  async sweep(): Promise<{ sent: number; skipped: number }> {
    const hour = this.storeHour(new Date());
    if (hour < EARLIEST_HOUR || hour >= LATEST_HOUR) return { sent: 0, skipped: 0 };

    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!lock?.locked) return { sent: 0, skipped: 0 };

    try {
      return await this.run();
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  /**
   * Finds what is due and asks `invite` to send it.
   *
   * The selection is deliberately loose and the decision is deliberately not
   * made here: `invite` already refuses a guest order, an order whose lines are
   * all reviewed, and a stage that has already been sent. Re-implementing any
   * of those would be a second opinion about who gets an email, and the two
   * would drift.
   */
  private async run(): Promise<{ sent: number; skipped: number }> {
    let sent = 0;
    let skipped = 0;

    const stages = reviewStages(await this.settings.get('reviewRequests'));
    for (const { stage, afterDays } of stages) {
      const due = new Date(Date.now() - afterDays * 24 * 60 * 60 * 1000);

      const orders = await this.prisma.client.order.findMany({
        where: {
          // A guest order has nothing to sign into, so there is nowhere for the
          // invitation to lead.
          customerId: { not: null },
          items: {
            some: {
              fulfillmentState: FulfillmentState.DELIVERED,
              deliveredAt: { lte: due },
              // Nothing to ask about if they have already written it.
              review: null,
            },
          },
          reviewInvites: { none: { stage } },
        },
        // Oldest first: a backlog is worked from the end that has been waiting
        // longest, and the day-3 email that is now eleven days late is still
        // worth more than the one that is an hour late.
        orderBy: { placedAt: 'asc' },
        take: PER_PASS - sent,
        select: { id: true, number: true },
      });

      for (const order of orders) {
        try {
          const result = await this.reviews.invite({ orderId: order.id, stage });
          if (result.sent) sent += 1;
          else skipped += 1;
        } catch (error) {
          // One order that cannot be emailed must not stop the pass. The order
          // number is safe to log; the address and the customer's name are not,
          // so neither is here.
          const reason = error instanceof Error ? error.message : 'unknown error';
          this.logger.warn(
            `Review invitation for ${order.number} (stage ${String(stage)}) could not be sent: ${reason}`,
          );
          skipped += 1;
        }
      }

      if (sent >= PER_PASS) break;
    }

    if (sent > 0) {
      this.logger.log(`Sent ${String(sent)} review invitations, skipped ${String(skipped)}.`);
    }
    return { sent, skipped };
  }
}
