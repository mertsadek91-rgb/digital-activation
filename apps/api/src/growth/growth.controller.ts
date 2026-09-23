import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  type AdminReferralList,
  type BusinessQuote,
  type BusinessQuoteList,
  type MyReferral,
  type ReferralVisit,
  type WelcomeStats,
  businessQuoteSchema,
  referralVisitSchema,
} from '@da/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AccountService } from '../account/account.service.js';
import { AuditService } from '../auth/audit.service.js';
import { Roles, StaffGuard, type StaffRequest } from '../auth/staff.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';

import { BusinessQuoteService } from './business.service.js';
import { ReferralService } from './referral.service.js';
import { REFERRAL_COOKIE } from './rules.js';
import { WelcomeService } from './welcome.service.js';

/** The same names the cart and account controllers use. */
const CART_COOKIE = 'da_cart';
const SESSION_COOKIE = 'da_customer';
/** As long as the friend code it may mint lives. */
const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 3600;

/**
 * The storefront's growth routes. Called from the browser, so each carries
 * its own per-visitor limit — the global guard enforces only decorated routes.
 */
@ApiTags('growth')
@Controller()
export class GrowthController {
  constructor(
    private readonly business: BusinessQuoteService,
    private readonly referrals: ReferralService,
    private readonly account: AccountService,
  ) {}

  // Sends two emails to the store and one to an unverified address, so it is
  // held to the contact form's limit.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('business-quotes')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a volume quote from the product page' })
  quote(
    @Body(new ZodPipe(businessQuoteSchema)) body: BusinessQuote,
    @Req() request: FastifyRequest,
  ): Promise<{ ok: true }> {
    return this.business.submit(body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  /**
   * A referral link was followed.
   *
   * The code goes into an httpOnly cookie on the API's own domain, like the
   * cart token, so the add-to-cart call that later mints the friend code can
   * read it without the page handing it over. Answered the same shape for a
   * bad code and a good one, apart from `ok`.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('referrals/visit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remember a referral code for this browser' })
  async visit(
    @Body(new ZodPipe(referralVisitSchema)) body: ReferralVisit,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: boolean; attached: boolean }> {
    const session = await this.account.sessionFor(request.cookies?.[SESSION_COOKIE]);
    const ok = await this.referrals.visit(body.code, session?.customerId ?? null);
    if (!ok) return { ok: false, attached: false };

    void reply.setCookie(REFERRAL_COOKIE, body.code, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: REFERRAL_COOKIE_MAX_AGE,
    });
    // A visitor who already has a cart gets the discount on it now.
    const attached = await this.referrals.attachToCart(
      request.cookies?.[CART_COOKIE],
      body.code,
      request.ip,
    );
    return { ok: true, attached };
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('referrals/me')
  @ApiOperation({ summary: 'The signed-in customer’s referral code and counts' })
  async mine(@Req() request: FastifyRequest): Promise<MyReferral> {
    const session = await this.account.sessionFor(request.cookies?.[SESSION_COOKIE]);
    if (!session) throw new UnauthorizedException('انتهت الجلسة. اطلب رابط دخول جديداً.');
    return this.referrals.mine(session.customerId);
  }
}

/** What the marketing panel reads about the growth features. */
@ApiTags('admin')
@Controller('admin/marketing')
@UseGuards(StaffGuard)
@Roles('ADMIN', 'MARKETING')
export class GrowthAdminController {
  constructor(
    private readonly business: BusinessQuoteService,
    private readonly welcome: WelcomeService,
    private readonly referrals: ReferralService,
    private readonly audit: AuditService,
  ) {}

  // Leads, so SUPPORT (who answers them in the inbox) sees them too.
  @Roles('ADMIN', 'MARKETING', 'SUPPORT')
  @Get('business/quotes')
  @ApiOperation({ summary: 'Recent business quote requests' })
  quotes(): Promise<BusinessQuoteList> {
    return this.business.recent();
  }

  @Get('welcome/stats')
  @ApiOperation({ summary: 'Welcome window captures, confirmations and codes' })
  welcomeStats(): Promise<WelcomeStats> {
    return this.welcome.stats();
  }

  @Get('referrals')
  @ApiOperation({ summary: 'Referral redemptions and totals' })
  referralList(): Promise<AdminReferralList> {
    return this.referrals.adminList();
  }

  @Post('referrals/:id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the fraud flags on a pending referral' })
  async approve(@Param('id') id: string, @Req() request: StaffRequest) {
    const result = await this.referrals.approve(id);
    await this.record(request, id, 'referral.approved');
    return result;
  }

  @Post('referrals/:id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void an open referral' })
  async reject(@Param('id') id: string, @Req() request: StaffRequest) {
    const result = await this.referrals.reject(id);
    await this.record(request, id, 'referral.rejected');
    return result;
  }

  private record(request: StaffRequest, id: string, action: string): Promise<void> {
    return this.audit.record({
      actorId: request.staff?.sub,
      entity: 'ReferralRedemption',
      entityId: id,
      action,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }
}
