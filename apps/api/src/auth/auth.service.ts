import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { StaffLoginResult, StaffMe } from '@da/contracts';
import { type StaffRole, type StaffUser } from '@da/db';

import { say } from '../common/panel-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KekService } from '../vault/kek.js';

import { AuditService } from './audit.service.js';
import {
  hashPassword,
  hashToken,
  newRefreshToken,
  verifyAgainstDecoy,
  verifyPassword,
} from './crypto.js';
import { openTotpSecret, sealTotpSecret } from './totp-seal.js';
import { createEnrollment, verifyTotp } from './totp.js';

export interface AccessClaims {
  sub: string;
  role: StaffRole;
  /**
   * True while the account is still on the password the create-staff script
   * printed. Carried in the token so StaffGuard needs no database read, and
   * cleared by issuing a fresh session — which is what changing a password
   * should do anyway.
   */
  mustChange: boolean;
  /** When the session last cleared a TOTP challenge, as a unix timestamp.
   *  Step-up actions — revealing a licence key, bulk export — require a recent
   *  one, so a long-lived session cannot be used to walk the vault. */
  totpAt: number;
}

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  staff: StaffMe;
}

/**
 * Parses "15m" / "30d" / "900" into seconds.
 *
 * jsonwebtoken's `expiresIn` accepts a template-literal type from the `ms`
 * package, which a plain environment string does not satisfy. Converting to a
 * number here is both type-honest and one less exotic type to carry around.
 */
function ttlSeconds(value: string | undefined, fallbackSeconds: number): number {
  if (!value) return fallbackSeconds;

  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) return fallbackSeconds;

  const amount = Number.parseInt(match[1] ?? '0', 10);
  const unit = match[2] ?? 's';
  const multiplier = unit === 'd' ? 86_400 : unit === 'h' ? 3_600 : unit === 'm' ? 60 : 1;
  return amount * multiplier;
}

interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly kek: KekService,
  ) {}

  private toMe(staff: StaffUser): StaffMe {
    return {
      email: staff.email,
      name: staff.name,
      role: staff.role,
      totpEnrolled: staff.totpEnabledAt !== null,
      mustChangePassword: staff.mustChangePassword,
    };
  }

  /** Present because validateEnv refuses to boot without it. */
  private accessSecret(): string {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not set.');
    return secret;
  }

  /**
   * Password step.
   *
   * The same generic failure is returned for an unknown email, a wrong
   * password and a deactivated account. Distinguishing them would turn the
   * login form into an account-enumeration oracle.
   */
  async login(
    email: string,
    password: string,
    totp: string | undefined,
    context: RequestContext,
  ): Promise<{ result: StaffLoginResult; session?: SessionResult }> {
    const staff = await this.prisma.client.staffUser.findUnique({ where: { email } });

    // argon2 runs whether or not the account exists, so the response time
    // does not reveal which addresses belong to staff.
    const passwordOk =
      staff !== null
        ? (await verifyPassword(staff.passwordHash, password)) && staff.isActive
        : await verifyAgainstDecoy(password);

    if (!staff || !passwordOk) {
      await this.audit.record({
        entity: 'StaffUser',
        entityId: staff?.id ?? email,
        action: 'login.failed',
        ip: context.ip,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('Incorrect email or password.');
    }

    // No TOTP yet: enrol before anything else is possible.
    if (!staff.totpSecret || !staff.totpEnabledAt) {
      const enrollment = await createEnrollment(
        staff.email,
        process.env.TOTP_ISSUER ?? 'Digital Activation',
      );
      await this.prisma.client.staffUser.update({
        where: { id: staff.id },
        data: {
          totpSecret: await sealTotpSecret(enrollment.secret, this.kek),
          totpEnabledAt: null,
        },
      });
      return {
        result: {
          outcome: 'totp_enrollment_required',
          secret: enrollment.secret,
          otpauthUrl: enrollment.otpauthUrl,
          qrDataUrl: enrollment.qrDataUrl,
        },
      };
    }

    if (!totp) {
      return { result: { outcome: 'totp_required' } };
    }

    if (!(await this.acceptTotp(staff, staff.totpSecret, totp))) {
      await this.audit.record({
        actorId: staff.id,
        entity: 'StaffUser',
        entityId: staff.id,
        action: 'login.totp_failed',
        ip: context.ip,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('That code is not valid.');
    }

    const session = await this.issueSession(staff, context);
    await this.audit.record({
      actorId: staff.id,
      entity: 'StaffUser',
      entityId: staff.id,
      action: 'login.succeeded',
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return { result: { outcome: 'ok', staff: this.toMe(staff) }, session };
  }

  /** Confirms enrolment with the first code from the authenticator app. */
  async confirmEnrollment(
    email: string,
    password: string,
    totp: string,
    context: RequestContext,
  ): Promise<SessionResult> {
    const staff = await this.prisma.client.staffUser.findUnique({ where: { email } });
    if (!staff?.isActive || !(await verifyPassword(staff.passwordHash, password))) {
      throw new UnauthorizedException('Incorrect email or password.');
    }
    if (!staff.totpSecret) {
      throw new UnauthorizedException('Start again — no enrolment is in progress.');
    }

    if (!(await this.acceptTotp(staff, staff.totpSecret, totp))) {
      throw new UnauthorizedException('That code is not valid.');
    }

    const enrolled = await this.prisma.client.staffUser.update({
      where: { id: staff.id },
      data: { totpEnabledAt: new Date() },
    });

    await this.audit.record({
      actorId: staff.id,
      entity: 'StaffUser',
      entityId: staff.id,
      action: 'totp.enrolled',
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.issueSession(enrolled, context);
  }

  /**
   * Verifies a code and spends it.
   *
   * The step is claimed with a conditional update, so two requests racing with
   * the same code cannot both pass: the one whose update finds the step still
   * unused wins, and the other is refused like any wrong code.
   */
  private async acceptTotp(
    staff: { id: string; totpLastStep: number | null },
    sealed: Uint8Array<ArrayBuffer>,
    token: string,
  ): Promise<boolean> {
    const { secret, stale } = await openTotpSecret(sealed, this.kek);
    const step = verifyTotp(token, secret, staff.totpLastStep);
    if (step === null) return false;
    const claimed = await this.prisma.client.staffUser.updateMany({
      where: {
        id: staff.id,
        OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
      },
      data: { totpLastStep: step },
    });
    if (claimed.count !== 1) return false;

    if (stale) await this.reseal(staff.id, sealed, secret);
    return true;
  }

  /**
   * Rewrites a legacy or old-generation row under the current KEK.
   *
   * Done only after a code verified, so a row is never rewritten from a secret
   * that might be wrong. Conditional on the bytes still being the ones read: a
   * re-enrolment that landed in between keeps its new secret. A failure here
   * is logged and swallowed — the person has proved who they are, and KMS
   * being slow is no reason to refuse the sign-in; the next one retries.
   */
  private async reseal(
    staffId: string,
    previous: Uint8Array<ArrayBuffer>,
    secret: string,
  ): Promise<void> {
    try {
      await this.prisma.client.staffUser.updateMany({
        where: { id: staffId, totpSecret: { equals: previous } },
        data: { totpSecret: await sealTotpSecret(secret, this.kek) },
      });
    } catch (error) {
      this.logger.warn(
        `Could not re-seal the TOTP secret for staff ${staffId}: ${(error as Error).message}`,
      );
    }
  }

  private async issueSession(staff: StaffUser, context: RequestContext): Promise<SessionResult> {
    const { token, hash } = newRefreshToken();
    const ttlDays = 30;

    await this.prisma.client.staffSession.create({
      data: {
        staffId: staff.id,
        tokenHash: hash,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
        totpVerifiedAt: new Date(),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 3600 * 1000),
      },
    });

    await this.prisma.client.staffUser.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() },
    });

    const claims: AccessClaims = {
      sub: staff.id,
      role: staff.role,
      mustChange: staff.mustChangePassword,
      totpAt: Math.floor(Date.now() / 1000),
    };

    return {
      accessToken: await this.jwt.signAsync(
        { ...claims },
        {
          secret: this.accessSecret(),
          expiresIn: ttlSeconds(process.env.JWT_ACCESS_TTL, 15 * 60),
        },
      ),
      refreshToken: token,
      staff: this.toMe(staff),
    };
  }

  /**
   * Rotates the refresh token on every use.
   *
   * A replayed token therefore fails, and the failure is evidence: it means the
   * token was captured, so the whole session is revoked rather than just that
   * request refused.
   */
  async refresh(refreshToken: string, context: RequestContext): Promise<SessionResult> {
    const session = await this.prisma.client.staffSession.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { staff: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Your session has expired.');
    }
    if (!session.staff.isActive) {
      throw new UnauthorizedException('This account is no longer active.');
    }

    const { token, hash } = newRefreshToken();
    await this.prisma.client.staffSession.update({
      where: { id: session.id },
      data: { tokenHash: hash, lastSeenAt: new Date(), ip: context.ip ?? null },
    });

    const claims: AccessClaims = {
      sub: session.staff.id,
      role: session.staff.role,
      mustChange: session.staff.mustChangePassword,
      totpAt: Math.floor((session.totpVerifiedAt ?? session.createdAt).getTime() / 1000),
    };

    return {
      accessToken: await this.jwt.signAsync(
        { ...claims },
        {
          secret: this.accessSecret(),
          expiresIn: ttlSeconds(process.env.JWT_ACCESS_TTL, 15 * 60),
        },
      ),
      refreshToken: token,
      staff: this.toMe(session.staff),
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.client.staffSession.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      return await this.jwt.verifyAsync<AccessClaims>(token, {
        secret: this.accessSecret(),
      });
    } catch {
      throw new UnauthorizedException('Your session has expired.');
    }
  }

  /**
   * Sets a password of the account holder's own.
   *
   * Every other session is revoked, not just refreshed. If the printed password
   * did leak, this is the moment that closes the leak — leaving other sessions
   * alive would make the change cosmetic.
   */
  async changePassword(
    staffId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<SessionResult> {
    const staff = await this.prisma.client.staffUser.findUnique({ where: { id: staffId } });
    if (!staff?.isActive) throw new UnauthorizedException('This account is no longer active.');

    if (!(await verifyPassword(staff.passwordHash, currentPassword))) {
      await this.audit.record({
        actorId: staff.id,
        entity: 'StaffUser',
        entityId: staff.id,
        action: 'password.change.failed',
        ip: context.ip,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('The current password is incorrect.');
    }

    const updated = await this.prisma.client.staffUser.update({
      where: { id: staff.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    await this.prisma.client.staffSession.updateMany({
      where: { staffId: staff.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.audit.record({
      actorId: staff.id,
      entity: 'StaffUser',
      entityId: staff.id,
      action: 'password.changed',
      // The password itself is never an audit value, hashed or otherwise.
      before: { mustChangePassword: staff.mustChangePassword },
      after: { mustChangePassword: false },
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return this.issueSession(updated, context);
  }

  /**
   * Re-clears the TOTP challenge on a live session.
   *
   * The vault refuses to open a licence for a session whose last challenge is
   * more than fifteen minutes old, and without this the only way to satisfy
   * that was to sign out and back in — so the honest answer to "show me this
   * customer's key" was to destroy your session first. This asks for a code
   * and stamps the session, which is what the step-up was meant to be.
   *
   * The password is not re-asked. The session already proves who this is; the
   * question is whether they are at the keyboard now, and a code from their
   * authenticator answers exactly that.
   */
  async stepUp(
    staffId: string,
    totp: string,
    refreshToken: string | undefined,
    context: RequestContext,
  ): Promise<SessionResult> {
    const staff = await this.prisma.client.staffUser.findUnique({ where: { id: staffId } });
    if (!staff?.isActive) throw new UnauthorizedException('This account is no longer active.');
    if (!staff.totpSecret || !staff.totpEnabledAt) {
      throw new UnauthorizedException(
        say(
          'لم تُسجَّل المصادقة الثنائية على هذا الحساب.',
          'Two-factor authentication has not been enrolled on this account.',
        ),
      );
    }

    if (!(await this.acceptTotp(staff, staff.totpSecret, totp))) {
      await this.audit.record({
        actorId: staff.id,
        entity: 'StaffUser',
        entityId: staff.id,
        action: 'totp.stepup.failed',
        ip: context.ip,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException(
        say('رمز المصادقة غير صحيح.', 'That authentication code is not correct.'),
      );
    }

    // Stamped on the session as well as in the new token: `refresh` reads
    // `totpVerifiedAt` to rebuild the claim, so without this the freshness
    // would be lost the next time the access token rotated.
    if (refreshToken) {
      await this.prisma.client.staffSession.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { totpVerifiedAt: new Date(), lastSeenAt: new Date() },
      });
    }

    await this.audit.record({
      actorId: staff.id,
      entity: 'StaffUser',
      entityId: staff.id,
      action: 'totp.stepup',
      ip: context.ip,
      userAgent: context.userAgent,
    });

    const claims: AccessClaims = {
      sub: staff.id,
      role: staff.role,
      mustChange: staff.mustChangePassword,
      totpAt: Math.floor(Date.now() / 1000),
    };

    return {
      accessToken: await this.jwt.signAsync(
        { ...claims },
        { secret: this.accessSecret(), expiresIn: ttlSeconds(process.env.JWT_ACCESS_TTL, 15 * 60) },
      ),
      // The refresh token is untouched: this is the same session, re-attested.
      refreshToken: refreshToken ?? '',
      staff: this.toMe(staff),
    };
  }

  async me(staffId: string): Promise<StaffMe> {
    const staff = await this.prisma.client.staffUser.findUnique({ where: { id: staffId } });
    if (!staff?.isActive) throw new UnauthorizedException('This account is no longer active.');
    return this.toMe(staff);
  }
}
