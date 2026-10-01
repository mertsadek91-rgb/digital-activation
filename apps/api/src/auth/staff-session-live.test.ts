import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service.js';
import type { KekService } from '../vault/kek.js';

import type { AuditService } from './audit.service.js';
import { type AccessClaims, AuthService } from './auth.service.js';
import { hashToken, newRefreshToken } from './crypto.js';
import { ROLES_KEY, StaffGuard, type StaffRequest } from './staff.guard.js';

/**
 * TASK-0014 / BUG-0005. The guard used to trust the access JWT's signature and
 * nothing else, so a deactivated account or a signed-out session kept working
 * until the token expired. Now every request looks the session up.
 */
interface Staff {
  id: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'READONLY';
  isActive: boolean;
  mustChangePassword: boolean;
  totpSecret: string | null;
  totpEnabledAt: Date | null;
}
interface Session {
  id: string;
  staffId: string;
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
  totpVerifiedAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
  ip: string | null;
}

const SECRET = 'x'.repeat(48);

function build() {
  const people: Staff[] = [
    {
      id: 'staff_1',
      email: 'ops@example.test',
      name: 'Ops',
      role: 'ADMIN',
      isActive: true,
      mustChangePassword: false,
      totpSecret: 'sealed',
      totpEnabledAt: new Date(),
    },
    {
      id: 'staff_2',
      email: 'other@example.test',
      name: 'Other',
      role: 'READONLY',
      isActive: true,
      mustChangePassword: false,
      totpSecret: 'sealed',
      totpEnabledAt: new Date(),
    },
  ];
  const sessions: Session[] = [];
  const lookups = { count: 0 };

  const person = (id: string) => people.find((p) => p.id === id);
  const matches = (row: Session, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const actual = row[key as keyof Session];
      if (value && typeof value === 'object' && 'gt' in value)
        return actual instanceof Date && actual > (value as { gt: Date }).gt;
      return actual === value;
    });

  const staffSession = {
    create: ({
      data,
    }: {
      data: Omit<Session, 'id' | 'createdAt' | 'lastSeenAt' | 'revokedAt'>;
    }) => {
      const row: Session = {
        ...data,
        id: `session_${String(sessions.length + 1)}`,
        createdAt: new Date(),
        lastSeenAt: new Date(),
        revokedAt: null,
      };
      sessions.push(row);
      return Promise.resolve({ id: row.id });
    },
    findUnique: ({ where }: { where: Record<string, unknown> }) => {
      if ('id' in where) lookups.count++;
      const row = sessions.find((r) => matches(r, where));
      return Promise.resolve(row ? { ...row, staff: { ...person(row.staffId) } } : null);
    },
    updateMany: ({ where, data }: { where: Record<string, unknown>; data: Partial<Session> }) => {
      const hit = sessions.filter((r) => matches(r, where));
      for (const row of hit) Object.assign(row, data);
      return Promise.resolve({ count: hit.length });
    },
  };
  const staffRetiredToken = {
    create: () => Promise.resolve({}),
    findUnique: () => Promise.resolve(null),
  };
  const client = {
    staffSession,
    staffRetiredToken,
    staffUser: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(person(where.id) ?? null),
      update: ({ where }: { where: { id: string } }) => Promise.resolve(person(where.id)),
    },
    $transaction: <T>(work: (tx: unknown) => Promise<T>) =>
      work({ staffSession, staffRetiredToken }),
  };

  const prisma = { client } as unknown as PrismaService;
  const audit = { record: () => Promise.resolve() } as unknown as AuditService;
  const jwt = new JwtService();
  const auth = new AuthService(prisma, jwt, audit, {} as KekService);
  const guard = new StaffGuard(auth, new Reflector());

  /** Signs in the way login does, and returns both cookies. */
  async function signIn(staffId = 'staff_1') {
    const staff = person(staffId);
    if (!staff) throw new Error('no such staff');
    const issue = (
      auth as unknown as {
        issueSession: (
          s: Staff,
          c: object,
        ) => Promise<{ accessToken: string; refreshToken: string }>;
      }
    ).issueSession.bind(auth);
    return issue(staff, {});
  }

  /** Runs StaffGuard against a request carrying this access cookie. */
  async function call(accessToken: string, roles?: string[]) {
    const request = { cookies: { da_access: accessToken } } as unknown as StaffRequest;
    const handler = () => undefined;
    if (roles) Reflect.defineMetadata(ROLES_KEY, roles, handler);
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext;
    await guard.canActivate(context);
    return request.staff;
  }

  /** Signs arbitrary claims with the real secret: a legacy token, or a forged sid. */
  const sign = (claims: Partial<AccessClaims>) =>
    jwt.signAsync({ ...claims }, { secret: SECRET, expiresIn: 900 });

  return { auth, sessions, lookups, signIn, call, sign, person };
}

describe('StaffGuard checks the session on every request', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubEnv('JWT_ACCESS_SECRET', SECRET);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('lets a live session through with one lookup, and the token carries its sid', async () => {
    const { signIn, call, lookups, sessions } = build();
    const { accessToken } = await signIn();

    const staff = await call(accessToken);

    expect(staff?.sub).toBe('staff_1');
    expect(staff?.sid).toBe(sessions[0]?.id);
    expect(lookups.count).toBe(1);
  });

  it('refuses the next request once the account is deactivated', async () => {
    const { signIn, call, person } = build();
    const { accessToken } = await signIn();
    await call(accessToken);

    const staff = person('staff_1');
    if (staff) staff.isActive = false;

    await expect(call(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses the access cookie after logout', async () => {
    const { auth, signIn, call } = build();
    const { accessToken, refreshToken } = await signIn();
    await call(accessToken);

    await auth.logout(refreshToken);

    await expect(call(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an access token whose session was revoked for any reason', async () => {
    const { signIn, call, sessions } = build();
    const { accessToken } = await signIn();
    if (sessions[0]) sessions[0].revokedAt = new Date();

    await expect(call(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a token whose session has expired', async () => {
    const { signIn, call, sessions } = build();
    const { accessToken } = await signIn();
    if (sessions[0]) sessions[0].expiresAt = new Date(Date.now() - 1);

    await expect(call(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a token minted before sessions were checked (no sid)', async () => {
    const { call, sign, lookups } = build();
    const token = await sign({ sub: 'staff_1', role: 'ADMIN', mustChange: false, totpAt: 0 });

    await expect(call(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(lookups.count).toBe(0);
  });

  it("refuses a sid that belongs to someone else's session", async () => {
    const { signIn, call, sessions, sign } = build();
    await signIn('staff_2');
    const forged = await sign({ sub: 'staff_1', sid: sessions[0]?.id ?? '', role: 'OWNER' });

    await expect(call(forged)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('applies a demotion on the next request, not when the token expires', async () => {
    const { signIn, call, person } = build();
    const { accessToken } = await signIn();
    await call(accessToken, ['ADMIN']);

    const staff = person('staff_1');
    if (staff) staff.role = 'READONLY';

    await expect(call(accessToken, ['ADMIN'])).rejects.toBeInstanceOf(ForbiddenException);
    expect((await call(accessToken))?.role).toBe('READONLY');
  });

  it('keeps working across a refresh, and the rotated token keeps the same sid', async () => {
    const { auth, signIn, call, sessions } = build();
    const first = await signIn();

    const next = await auth.refresh(first.refreshToken, {});

    expect((await call(next.accessToken))?.sid).toBe(sessions[0]?.id);
    expect(sessions[0]?.tokenHash).toBe(hashToken(next.refreshToken));
  });

  it('step-up mints a token for the same session', async () => {
    const { auth, signIn, call, sessions } = build();
    const { refreshToken } = await signIn();
    vi.spyOn(
      auth as unknown as { acceptTotp: () => Promise<boolean> },
      'acceptTotp',
    ).mockResolvedValue(true);

    const stepped = await auth.stepUp('staff_1', '123456', refreshToken, {});

    expect((await call(stepped.accessToken))?.sid).toBe(sessions[0]?.id);
  });

  it('refuses a token signed with the wrong secret before touching the database', async () => {
    const { call, lookups } = build();
    const forged = await new JwtService().signAsync(
      { sub: 'staff_1', sid: 'session_1', role: 'OWNER', mustChange: false, totpAt: 0 },
      { secret: 'y'.repeat(48), expiresIn: 900 },
    );

    await expect(call(forged)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(lookups.count).toBe(0);
  });

  it('an unknown refresh token on logout leaves live sessions alone', async () => {
    const { auth, signIn, call } = build();
    const { accessToken } = await signIn();

    await auth.logout(newRefreshToken().token);

    expect((await call(accessToken))?.sub).toBe('staff_1');
  });
});
