import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  type AccountOrderList,
  CUSTOMER_SESSION_HOURS,
  type CustomerMe,
  type LicenceList,
  type OwnReview,
  type ReviewableList,
  editReviewSchema,
  exchangeLoginTokenSchema,
  requestLoginLinkSchema,
  submitReviewSchema,
} from '@da/contracts';
import { z } from 'zod';

import { ZodPipe } from '../common/zod.pipe.js';
import { ReviewsService } from '../reviews/reviews.service.js';

import { AccountService, type CustomerActor } from './account.service.js';

const SESSION_COOKIE = 'da_customer';

/**
 * The customer's own area.
 *
 * Every route here is behind the session cookie except the two that create
 * one, and those two are the throttled ones: asking for a link and trading it
 * for a session are the only places an anonymous caller can push.
 *
 * There is no route that lists somebody else's anything. The customer id comes
 * from the cookie and never from a parameter, which is why none of these
 * methods takes one.
 */
@ApiTags('account')
@Controller('account')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly reviews: ReviewsService,
  ) {}

  private actor(request: FastifyRequest, customerId: string): CustomerActor {
    return {
      customerId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  /** Resolves the cookie or refuses. Nothing below it runs without one. */
  private async require(request: FastifyRequest): Promise<{ customerId: string; me: CustomerMe }> {
    const session = await this.account.sessionFor(request.cookies?.[SESSION_COOKIE]);
    if (!session) {
      throw new UnauthorizedException('انتهت الجلسة. اطلب رابط دخول جديداً.');
    }
    return session;
  }

  /**
   * Five a minute. Generous for a person who mistyped their address, and far
   * too few to walk a list of emails looking for which ones are customers —
   * which the identical answer already makes pointless.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('link')
  @ApiOperation({ summary: 'Email a single-use sign-in link' })
  async requestLink(
    @Body(new ZodPipe(requestLoginLinkSchema)) body: z.infer<typeof requestLoginLinkSchema>,
    @Req() request: FastifyRequest,
  ): Promise<{ sent: true }> {
    await this.account.requestLink({
      email: body.email,
      locale: body.locale,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    // The same answer whether or not that address has ever bought anything.
    return { sent: true };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('session')
  @ApiOperation({ summary: 'Trade a link for a session cookie' })
  async exchange(
    @Body(new ZodPipe(exchangeLoginTokenSchema)) body: z.infer<typeof exchangeLoginTokenSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ customer: CustomerMe }> {
    const result = await this.account.exchange({
      token: body.token,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    // httpOnly, so no script on the storefront can read it; SameSite=strict,
    // so it does not travel on a cross-site request and needs no CSRF token.
    void reply.setCookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: CUSTOMER_SESSION_HOURS * 3600,
    });

    return { customer: result.customer };
  }

  @Post('sign-out')
  @ApiOperation({ summary: 'Revoke this session' })
  async signOut(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.account.signOut(request.cookies?.[SESSION_COOKIE]);
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'Who this session belongs to' })
  async me(@Req() request: FastifyRequest): Promise<CustomerMe> {
    return (await this.require(request)).me;
  }

  @Get('licences')
  @ApiOperation({ summary: "The customer's own licences. Never a secret." })
  async licences(@Req() request: FastifyRequest): Promise<LicenceList> {
    const session = await this.require(request);
    return this.account.licences(session.customerId);
  }

  /**
   * The one customer-facing route that returns a licence in the clear.
   *
   * Throttled, owned-line only, and it writes a REVEAL row to the vault's
   * access log before the plaintext exists — the same row a member of staff
   * reading the key would write, with the customer as the actor.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('licences/:orderItemId/reveal')
  @ApiOperation({ summary: 'Show one line’s licences to the person who bought them' })
  async reveal(@Param('orderItemId') orderItemId: string, @Req() request: FastifyRequest) {
    const session = await this.require(request);
    const secrets = await this.account.reveal({
      orderItemId,
      actor: this.actor(request, session.customerId),
    });
    return { secrets };
  }

  /**
   * Sends the licence email again — to the address on the order, and no other.
   *
   * Usually the better answer than reading it on screen: it puts the key back
   * where the customer expects it and shows it to nobody on the way.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('licences/:orderItemId/resend')
  @ApiOperation({ summary: 'Re-send the licence email for one line' })
  async resend(
    @Param('orderItemId') orderItemId: string,
    @Req() request: FastifyRequest,
  ): Promise<{ to: string }> {
    const session = await this.require(request);
    const result = await this.account.resend({
      orderItemId,
      actor: this.actor(request, session.customerId),
    });
    if (!result.to) {
      throw new NotFoundException('لا يوجد عنوان لإعادة الإرسال إليه.');
    }
    return result;
  }

  /**
   * The customer's own orders.
   *
   * Unthrottled, like the other reads: the cookie already decides whose orders
   * these are, and there is nothing to enumerate — the set is whatever this
   * one customer bought, so asking twice returns the same thing.
   */
  @Get('orders')
  @ApiOperation({ summary: "The customer's own orders. Never a licence." })
  async orders(@Req() request: FastifyRequest): Promise<AccountOrderList> {
    const session = await this.require(request);
    return this.account.orders(session.customerId);
  }

  /**
   * What this customer may review.
   *
   * Delivered lines, and the review against each one where there is one. The
   * customer id comes from the cookie like everything else here, so there is
   * no shape of this request that lists somebody else's purchases — which is
   * the only thing standing between a review system and the 565 fabricated
   * rows on the store this replaces.
   */
  @Get('reviews')
  @ApiOperation({ summary: 'Delivered lines this customer may review' })
  async reviewable(@Req() request: FastifyRequest): Promise<ReviewableList> {
    const session = await this.require(request);
    return this.reviews.reviewable(session.customerId);
  }

  /**
   * Writes one review against one delivered line.
   *
   * Throttled well below what a person writing about what they bought would
   * ever hit: the shape this stops is a script walking order-item ids, and
   * every one of those already answers 404 because the line is not theirs.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reviews/:orderItemId')
  @ApiOperation({ summary: 'Review a delivered line. Starts unpublished.' })
  async submitReview(
    @Param('orderItemId') orderItemId: string,
    @Body(new ZodPipe(submitReviewSchema)) body: z.infer<typeof submitReviewSchema>,
    @Req() request: FastifyRequest,
  ): Promise<OwnReview> {
    const session = await this.require(request);
    return this.reviews.submit({
      customerId: session.customerId,
      orderItemId,
      review: body,
    });
  }

  /** Fixing what you wrote, while it is still waiting to be read. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Patch('reviews/:orderItemId')
  @ApiOperation({ summary: 'Edit your own review while it is still pending' })
  async editReview(
    @Param('orderItemId') orderItemId: string,
    @Body(new ZodPipe(editReviewSchema)) body: z.infer<typeof editReviewSchema>,
    @Req() request: FastifyRequest,
  ): Promise<OwnReview> {
    const session = await this.require(request);
    return this.reviews.edit({
      customerId: session.customerId,
      orderItemId,
      patch: body,
    });
  }
}
