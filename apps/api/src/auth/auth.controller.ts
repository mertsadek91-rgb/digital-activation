import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import {
  changePasswordSchema,
  type StaffLoginResult,
  type StaffMe,
  staffLoginSchema,
} from '@da/contracts';
import { z } from 'zod';

import { ZodPipe } from '../common/zod.pipe.js';

import { AuthService, type SessionResult } from './auth.service.js';
import { StaffGuard, StalePasswordOk, type StaffRequest } from './staff.guard.js';

const ACCESS_COOKIE = 'da_access';
const REFRESH_COOKIE = 'da_refresh';

const enrollSchema = staffLoginSchema.extend({
  totp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'six digits'),
});

@ApiTags('auth')
@Controller('auth/staff')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Cookies rather than a response body.
   *
   * SameSite=strict blocks the cookie on cross-site requests, which is CSRF
   * protection that needs no token to go stale. `secure` is off only on
   * localhost, where there is no https to attach it to.
   */
  private setCookies(reply: FastifyReply, session: SessionResult): void {
    const secure = process.env.NODE_ENV === 'production';
    const base = { httpOnly: true, sameSite: 'strict' as const, secure, path: '/' };

    void reply.setCookie(ACCESS_COOKIE, session.accessToken, { ...base, maxAge: 15 * 60 });
    void reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      ...base,
      maxAge: 30 * 24 * 3600,
      // The refresh token is only ever sent to the refresh route.
      path: '/v1/auth/staff',
    });
  }

  private clearCookies(reply: FastifyReply): void {
    void reply.clearCookie(ACCESS_COOKIE, { path: '/' });
    void reply.clearCookie(REFRESH_COOKIE, { path: '/v1/auth/staff' });
  }

  // Ten attempts a minute: enough for a person fumbling a code, far too few
  // for a password or TOTP guessing run.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Password, then TOTP. Sets httpOnly session cookies.' })
  async login(
    @Body(new ZodPipe(staffLoginSchema)) body: z.infer<typeof staffLoginSchema>,
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StaffLoginResult> {
    const { result, session } = await this.auth.login(body.email, body.password, body.totp, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    if (session) this.setCookies(reply, session);
    return result;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('enroll')
  @ApiOperation({ summary: 'Confirm TOTP enrolment with the first code' })
  async enroll(
    @Body(new ZodPipe(enrollSchema)) body: z.infer<typeof enrollSchema>,
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ outcome: 'ok'; staff: StaffMe }> {
    const session = await this.auth.confirmEnrollment(body.email, body.password, body.totp, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    this.setCookies(reply, session);
    return { outcome: 'ok', staff: session.staff };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate the session' })
  async refresh(
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ staff: StaffMe }> {
    const session = await this.auth.refresh(request.cookies?.da_refresh ?? '', {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    this.setCookies(reply, session);
    return { staff: session.staff };
  }

  @Post('logout')
  async logout(
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    await this.auth.logout(request.cookies?.da_refresh);
    this.clearCookies(reply);
    return { ok: true };
  }

  @UseGuards(StaffGuard)
  @StalePasswordOk()
  @Get('me')
  me(@Req() request: StaffRequest): Promise<StaffMe> {
    return this.auth.me(request.staff?.sub ?? '');
  }

  /**
   * Reachable while the account is still on its generated password — that is
   * the whole point of it. Throttled like the login routes, because it takes a
   * password as input and so is a guessing target in its own right.
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(StaffGuard)
  @StalePasswordOk()
  @Post('password')
  @ApiOperation({ summary: 'Set a new password; revokes every other session' })
  async changePassword(
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() request: StaffRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ staff: StaffMe }> {
    const session = await this.auth.changePassword(
      request.staff?.sub ?? '',
      body.currentPassword,
      body.newPassword,
      { ip: request.ip, userAgent: request.headers['user-agent'] },
    );
    // The old cookies point at a session that was just revoked.
    this.setCookies(reply, session);
    return { staff: session.staff };
  }
}
