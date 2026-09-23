import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type CartQuery,
  type CartRecoveryStats,
  type CartRestore,
  type CartRestoreResult,
  type RenewalStats,
  cartQuerySchema,
  cartRestoreSchema,
} from '@da/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { Roles, StaffGuard } from '../auth/staff.guard.js';
import { CART_COOKIE, setCartCookie } from '../cart/cart.controller.js';
import { CartService } from '../cart/cart.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readNewsletterToken } from '../subscriptions/subscriptions.service.js';

import { CartRecoveryService } from './cart-recovery.service.js';
import { RetentionStatsService } from './retention-stats.service.js';

/** What the renewal and cart-recovery screens read. ADMIN and MARKETING, like the settings. */
@ApiTags('admin')
@Controller('admin/marketing/stats')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'MARKETING')
export class RetentionStatsController {
  constructor(private readonly stats: RetentionStatsService) {}

  @Get('renewals')
  @ApiOperation({ summary: 'Renewal reminders sent, renewals, and holdout comparison (30 days)' })
  renewals(): Promise<RenewalStats> {
    return this.stats.renewals();
  }

  @Get('cartRecovery')
  @ApiOperation({
    summary: 'Recovery emails per step, recovered orders, holdout comparison (30 days)',
  })
  cartRecovery(): Promise<CartRecoveryStats> {
    return this.stats.cartRecovery();
  }
}

/**
 * The two links a retention email carries that are not a storefront page.
 */
@ApiTags('cart')
@Controller()
export class RetentionPublicController {
  constructor(
    private readonly recovery: CartRecoveryService,
    private readonly cart: CartService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Re-attaches an abandoned cart to whichever browser opened its email.
   *
   * Called by the storefront's cart page with the token from the link, rather
   * than being the link itself, so the cookie is set by a same-site request
   * from the shop and the shopper lands on a page that can explain an expired
   * link instead of on a bare API response.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('cart/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open an abandoned cart from its recovery email' })
  async restore(
    @Body(new ZodPipe(cartRestoreSchema)) body: CartRestore,
    @Query(new ZodPipe(cartQuerySchema)) query: CartQuery,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CartRestoreResult> {
    const token = await this.recovery.restore(body.token);
    if (token) {
      setCartCookie(reply, token);
      return { restored: true, cart: await this.cart.render(token, query, []) };
    }
    const current = await this.cart.resolve(request.cookies?.[CART_COOKIE], query);
    setCartCookie(reply, current.token);
    return { restored: false, cart: await this.cart.render(current.token, query, []) };
  }

  /**
   * RFC 8058 one-click unsubscribe, the target of the `List-Unsubscribe`
   * header on promotional mail.
   *
   * The mailbox provider POSTs `List-Unsubscribe=One-Click` here without the
   * reader opening anything, so it answers the same whether or not the token
   * is good: there is nobody to show an error to, and a distinguishable
   * answer would tell a caller which addresses exist.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('marketing/unsubscribe')
  @HttpCode(200)
  @ApiOperation({ summary: 'One-click unsubscribe from promotional email' })
  async oneClick(
    @Query(new ZodPipe(z.object({ token: z.string().min(10).max(400) }))) query: { token: string },
  ): Promise<{ ok: true }> {
    const email = readNewsletterToken(query.token, 'newsletter-unsubscribe');
    if (email) {
      await this.prisma.client.customer.updateMany({
        where: { email },
        data: { marketingOptInAt: null, marketingOptOutAt: new Date() },
      });
    }
    return { ok: true };
  }
}
