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
  /**
   * The StaffSession this token was minted for. StaffGuard looks it up on
   * every request, so signing out or deactivating the account ends access at
   * once rather than when the token expires (BUG-0005). A token without one
   * predates the check and is refused; the admin answers that 401 with a
   * refresh, which mints a token that has one.
   */
  sid: string;
  /** Re-read from the database by `authenticate`, so a demotion is immediate. */
  role: StaffRole;
  /**
   * True while the account is still on the password the create-staff script
   * printed. Re-read from the database by `authenticate`, like `role`, and
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

/** How long after a rotation the replaced token is taken for a concurrent tab, not a copy. */
export const REPLAY_GRACE_MS = 10_000;

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

    const session = await this.prisma.client.staffSession.create({
      select: { id: true },
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

    return {
      accessToken: await this.signAccess({
        sub: staff.id,
        sid: session.id,
        role: staff.role,
        mustChange: staff.mustChangePassword,
        totpAt: Math.floor(Date.now() / 1000),
      }),
      refreshToken: token,
      staff: this.toMe(staff),
    };
  }

  private signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(
      { ...claims },
      {
        secret: this.accessSecret(),
        expiresIn: ttlSeconds(process.env.JWT_ACCESS_TTL, 15 * 60),
      },
    );
  }

  /**
   * Rotates the refresh token on every use, and remembers every hash it replaced.
   *
   * A replayed token is evidence: someone holds a copy. Whoever presents it
   * second — the attacker or the real user — gets the whole session revoked
   * and an audit entry, rather than the first presenter keeping it (BUG-0004).
   *
   * The exception is a hit on a hash retired less than `REPLAY_GRACE_MS` ago.
   * Admin tabs share one cookie, so two tabs refreshing together send the same
   * token; the loser is refused, as before, but not treated as theft.
   */
  async refresh(refreshToken: string, context: RequestContext): Promise<SessionResult> {
    const presented = hashToken(refreshToken);
    const session = await this.prisma.client.staffSession.findUnique({
      where: { tokenHash: presented },
      include: { staff: true },
    });

    if (!session) {
      await this.detectReplay(presented, context);
      throw new UnauthorizedException('Your session has expired.');
    }
    if (session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Your session has expired.');
    }
    if (!session.staff.isActive) {
      throw new UnauthorizedException('This account is no longer active.');
    }

    // Conditional on the hash we read, so of two concurrent refreshes with the
    // same token exactly one rotates and the other is refused. The retired hash
    // is written in the same transaction, so there is no moment at which the old
    // token is neither current nor on record.
    const { token, hash } = newRefreshToken();
    const now = new Date();
    const rotated = await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.staffSession.updateMany({
        where: { id: session.id, tokenHash: presented, revokedAt: null },
        data: { tokenHash: hash, lastSeenAt: now, ip: context.ip ?? null },
      });
      if (updated.count === 0) return false;
      await tx.staffRetiredToken.create({
        data: { hash: presented, sessionId: session.id, retiredAt: now },
      });
      return true;
    });
    if (!rotated) throw new UnauthorizedException('Your session has expired.');

    return {
      accessToken: await this.signAccess({
        sub: session.staff.id,
        sid: session.id,
        role: session.staff.role,
        mustChange: session.staff.mustChangePassword,
        totpAt: Math.floor((session.totpVerifiedAt ?? session.createdAt).getTime() / 1000),
      }),
      refreshToken: token,
      staff: this.toMe(session.staff),
    };
  }

  /**
   * A presented token that is no session's current one: stale, forged, or
   * replayed. Any retired hash counts, however many rotations ago — an attacker
   * decides how often the stolen copy is rotated before the victim returns.
   */
  private async detectReplay(presented: string, context: RequestContext): Promise<void> {
    const retired = await this.prisma.client.staffRetiredToken.findUnique({
      where: { hash: presented },
      select: { retiredAt: true, session: { select: { id: true, staffId: true } } },
    });
    if (!retired) return;
    if (Date.now() - retired.retiredAt.getTime() < REPLAY_GRACE_MS) {
      this.logger.log(
        `Refresh with a token retired moments ago on staff session ${retired.session.id}; refused as a concurrent tab.`,
      );
      return;
    }
    await this.revokeForReplay(retired.session, 'session.replay_revoked', context);
  }

  private async revokeForReplay(
    session: { id: string; staffId: string },
    action: string,
    context: RequestContext,
  ): Promise<void> {
    const revoked = await this.prisma.client.staffSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) return;

    this.logger.warn(`Refresh-token replay on staff session ${session.id}; session revoked.`);
    await this.audit.record({
      actorId: session.staffId,
      entity: 'StaffSession',
      entityId: session.id,
      action,
      ip: context.ip,
      userAgent: context.userAgent,
    });
  }

  /**
   * Ends the session the cookie belongs to — including when the cookie is a
   * retired token. That is the victim of a copied token signing out after the
   * attacker rotated it: matching only the current hash would revoke nothing
   * while telling them they were signed out.
   */
  async logout(refreshToken: string | undefined, context: RequestContext = {}): Promise<void> {
    if (!refreshToken) return;
    const presented = hashToken(refreshToken);
    const ended = await this.prisma.client.staffSession.updateMany({
      where: { tokenHash: presented, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (ended.count > 0) return;

    const retired = await this.prisma.client.staffRetiredToken.findUnique({
      where: { hash: presented },
      select: { retiredAt: true, session: { select: { id: true, staffId: true } } },
    });
    if (!retired) return;
    // Inside the grace window this is most likely a second tab of the same
    // person signing out: end the session, but do not record it as theft.
    if (Date.now() - retired.retiredAt.getTime() < REPLAY_GRACE_MS) {
      await this.prisma.client.staffSession.updateMany({
        where: { id: retired.session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }
    await this.revokeForReplay(retired.session, 'session.replay_logout', context);
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
   * What StaffGuard calls on every request: the signature, then the session.
   *
   * The signature alone meant a revoked session or a deactivated account kept
   * working until the access token expired (BUG-0005). One primary-key lookup
   * joined to the staff row closes that. There is deliberately no cache: any
   * cache is a window in which a revoked session still works, and staff
   * traffic is far too light for the query to matter.
   *
   * Role and the stale-password flag come from the row, not the token, so a
   * demotion also takes effect on the next request.
   */
  async authenticate(token: string): Promise<AccessClaims> {
    const claims = await this.verifyAccess(token);
    if (typeof claims.sid !== 'string' || claims.sid === '') {
      throw new UnauthorizedException('Your session has expired.');
    }

    const session = await this.prisma.client.staffSession.findUnique({
      where: { id: claims.sid },
      select: {
        staffId: true,
        revokedAt: true,
        expiresAt: true,
        staff: { select: { isActive: true, role: true, mustChangePassword: true } },
      },
    });
    if (
      !session ||
      session.staffId !== claims.sub ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Your session has expired.');
    }
    if (!session.staff.isActive) {
      throw new UnauthorizedException('This account is no longer active.');
    }

    return {
      ...claims,
      role: session.staff.role,
      mustChange: session.staff.mustChangePassword,
    };
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
    // Step-up re-attests a session, so there must be one: an access token alone
    // can outlive its revoked session by up to 15 minutes. The refresh cookie's
    // path covers this route.
    if (!refreshToken) throw new UnauthorizedException('Your session has expired.');
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
    const stamped = await this.prisma.client.staffSession.updateMany({
      where: {
        tokenHash: hashToken(refreshToken),
        staffId: staff.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { totpVerifiedAt: new Date(), lastSeenAt: new Date() },
    });
    // A revoked or someone else's session is not re-attested with a fresh token.
    if (stamped.count === 0) throw new UnauthorizedException('Your session has expired.');
    const session = await this.prisma.client.staffSession.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      select: { id: true },
    });
    if (!session) throw new UnauthorizedException('Your session has expired.');

    await this.audit.record({
      actorId: staff.id,
      entity: 'StaffUser',
      entityId: staff.id,
      action: 'totp.stepup',
      ip: context.ip,
      userAgent: context.userAgent,
    });

    return {
      accessToken: await this.signAccess({
        sub: staff.id,
        sid: session.id,
        role: staff.role,
        mustChange: staff.mustChangePassword,
        totpAt: Math.floor(Date.now() / 1000),
      }),
      // The refresh token is untouched: this is the same session, re-attested.
      refreshToken,
      staff: this.toMe(staff),
    };
  }

  async me(staffId: string): Promise<StaffMe> {
    const staff = await this.prisma.client.staffUser.findUnique({ where: { id: staffId } });
    if (!staff?.isActive) throw new UnauthorizedException('This account is no longer active.');
    return this.toMe(staff);
  }
}
