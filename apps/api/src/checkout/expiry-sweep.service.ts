import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OrderStatus, PaymentState } from '@da/db';

import { PrismaService } from '../prisma/prisma.service.js';

import { CheckoutService } from './checkout.service.js';

/**
 * Closes order drafts nobody is going to pay.
 *
 * The order is drafted when the email is captured, before payment, so every
 * shopper who stops at the card form leaves a PENDING_PAYMENT order behind.
 * Nothing ever closed them: the "awaiting payment" count in the panel grew
 * without limit, and an old draft's card intent stayed payable at a price that
 * may no longer exist.
 *
 * Fourteen days, not one, because a bank transfer is paid from a banking app
 * days after the order and its confirmation needs the order still pending.
 * An order with any succeeded payment is never touched — that is a payment
 * waiting to be applied, not an abandoned draft.
 */
const EXPIRE_AFTER_DAYS = 14;
const PER_PASS = 100;
const LOCK_KEY = 761_204_003;

@Injectable()
export class ExpirySweepService {
  private readonly logger = new Logger(ExpirySweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'expire-drafts' })
  async sweep(): Promise<{ cancelled: number }> {
    const [lock] = await this.prisma.client.$queryRaw<
      { locked: boolean }[]
    >`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
    if (!lock?.locked) return { cancelled: 0 };

    try {
      return await this.run();
    } finally {
      await this.prisma.client.$queryRaw`select pg_advisory_unlock(${LOCK_KEY})`;
    }
  }

  private async run(): Promise<{ cancelled: number }> {
    const cutoff = new Date(Date.now() - EXPIRE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const drafts = await this.prisma.client.order.findMany({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        placedAt: { lte: cutoff },
        payments: { none: { state: PaymentState.SUCCEEDED } },
      },
      orderBy: { placedAt: 'asc' },
      take: PER_PASS,
      select: { id: true },
    });

    let cancelled = 0;
    for (const draft of drafts) {
      await this.checkout.cancelOpenIntents(draft.id);
      // Conditional: a payment that lands during the pass wins.
      const { count } = await this.prisma.client.order.updateMany({
        where: { id: draft.id, status: OrderStatus.PENDING_PAYMENT },
        data: { status: OrderStatus.CANCELLED },
      });
      cancelled += count;
    }
    if (cancelled > 0) this.logger.log(`Cancelled ${String(cancelled)} expired order draft(s).`);
    return { cancelled };
  }
}
