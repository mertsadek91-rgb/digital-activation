import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service.js';
import type { KekService } from '../vault/kek.js';

import type { AuditService } from './audit.service.js';
import { AuthService, REPLAY_GRACE_MS } from './auth.service.js';
import { hashToken, newRefreshToken } from './crypto.js';

/**
 * TASK-0013 / BUG-0004. Rotation alone meant whoever presented a captured
 * refresh token first kept the session. Now every replaced hash is kept, and
 * presenting one again — outside the few seconds two tabs can race — revokes
 * the session and leaves an audit entry.
 */
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
interface Retired {
  hash: string;
  sessionId: string;
  retiredAt: Date;
}

const staff = {
  id: 'staff_1',
  email: 'ops@example.test',
  name: 'Ops',
  role: 'ADMIN',
  isActive: true,
  mustChangePassword: false,
  totpEnabledAt: new Date(),
};

function build() {
  const sessions: Session[] = [];
  const retired: Retired[] = [];
  const audits: { action: string; entityId: string }[] = [];
  /** When set, the next rotation loses a race: the row changed under it. */
  const race = { next: false };

  const matches = (row: Session, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const actual = row[key as keyof Session];
      if (value && typeof value === 'object' && 'gt' in value)
        return actual instanceof Date && actual > (value as { gt: Date }).gt;
      return actual === value;
    });

  const staffSession = {
    findUnique: ({ where }: { where: Record<string, unknown> }) => {
      const row = sessions.find((r) => matches(r, where));
      return Promise.resolve(row ? { ...row, staff } : null);
    },
    updateMany: ({ where, data }: { where: Record<string, unknown>; data: Partial<Session> }) => {
      if (race.next && 'tokenHash' in data) {
        race.next = false;
        return Promise.resolve({ count: 0 });
      }
      const hit = sessions.filter((r) => matches(r, where));
      for (const row of hit) Object.assign(row, data);
      return Promise.resolve({ count: hit.length });
    },
  };
  const staffRetiredToken = {
    create: ({ data }: { data: Retired }) => {
      if (retired.some((r) => r.hash === data.hash)) return Promise.reject(new Error('unique'));
      retired.push(data);
      return Promise.resolve(data);
    },
    findUnique: ({ where }: { where: { hash: string } }) => {
      const row = retired.find((r) => r.hash === where.hash);
      const session = sessions.find((s) => s.id === row?.sessionId);
      return Promise.resolve(
        row && session
          ? { retiredAt: row.retiredAt, session: { id: session.id, staffId: session.staffId } }
          : null,
      );
    },
  };
  const client = {
    staffSession,
    staffRetiredToken,
    staffUser: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve({ ...staff, id: where.id, totpSecret: 'sealed' }),
    },
    $transaction: <T>(work: (tx: unknown) => Promise<T>) =>
      work({ staffSession, staffRetiredToken }),
  };

  const prisma = { client } as unknown as PrismaService;
  const audit = {
    record: (entry: { action: string; entityId: string }) => {
      audits.push({ action: entry.action, entityId: entry.entityId });
      return Promise.resolve();
    },
  } as unknown as AuditService;
  const auth = new AuthService(prisma, new JwtService(), audit, {} as KekService);

  function open(): string {
    const { token, hash } = newRefreshToken();
    sessions.push({
      id: `session_${String(sessions.length + 1)}`,
      staffId: staff.id,
      tokenHash: hash,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      totpVerifiedAt: new Date(),
      createdAt: new Date(),
      lastSeenAt: new Date(),
      ip: null,
    });
    return token;
  }

  return { auth, sessions, retired, audits, race, open };
}

const context = { ip: '203.0.113.9', userAgent: 'test' };
const later = () => vi.setSystemTime(Date.now() + REPLAY_GRACE_MS + 1_000);

describe('staff refresh-token rotation and replay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(48));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('rotates normally and keeps the hash it replaced', async () => {
    const { auth, sessions, retired, audits, open } = build();
    const first = open();

    const next = await auth.refresh(first, context);

    expect(next.refreshToken).not.toBe(first);
    expect(sessions[0]?.tokenHash).toBe(hashToken(next.refreshToken));
    expect(retired.map((r) => r.hash)).toEqual([hashToken(first)]);
    expect(sessions[0]?.revokedAt).toBeNull();
    expect((await auth.refresh(next.refreshToken, context)).refreshToken).toBeTruthy();
    expect(audits).toEqual([]);
  });

  it('revokes the session when a replaced token comes back after the grace window', async () => {
    const { auth, sessions, audits, open } = build();
    const stolen = open();
    // The attacker refreshes first; the real user's copy is now retired.
    const attacker = await auth.refresh(stolen, context);

    later();
    await expect(auth.refresh(stolen, context)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(audits).toEqual([{ action: 'session.replay_revoked', entityId: 'session_1' }]);
    // And the winner of the race is out too.
    await expect(auth.refresh(attacker.refreshToken, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('still catches the copy after the attacker rotates several times', async () => {
    const { auth, sessions, audits, open } = build();
    const stolen = open();
    let current = stolen;
    for (let i = 0; i < 3; i++) current = (await auth.refresh(current, context)).refreshToken;

    later();
    await expect(auth.refresh(stolen, context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(audits).toHaveLength(1);
  });

  it('refuses, but does not revoke, a second tab racing inside the grace window', async () => {
    const { auth, sessions, audits, open } = build();
    const shared = open();
    const winner = await auth.refresh(shared, context);

    await expect(auth.refresh(shared, context)).rejects.toBeInstanceOf(UnauthorizedException);

    expect(sessions[0]?.revokedAt).toBeNull();
    expect(audits).toEqual([]);
    expect((await auth.refresh(winner.refreshToken, context)).refreshToken).toBeTruthy();
  });

  it('refuses the loser of a concurrent rotation without recording a retired hash', async () => {
    const { auth, sessions, retired, race, open } = build();
    const token = open();
    race.next = true;

    await expect(auth.refresh(token, context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(retired).toEqual([]);
    expect(sessions[0]?.revokedAt).toBeNull();
  });

  it('never refreshes a revoked session, and a second replay writes no second entry', async () => {
    const { auth, audits, open } = build();
    const stolen = open();
    const current = await auth.refresh(stolen, context);
    later();
    await expect(auth.refresh(stolen, context)).rejects.toThrow();
    await expect(auth.refresh(stolen, context)).rejects.toThrow();
    await expect(auth.refresh(current.refreshToken, context)).rejects.toThrow();

    expect(audits).toHaveLength(1);
  });

  it('refuses an expired session', async () => {
    const { auth, sessions, open } = build();
    const token = open();
    const next = await auth.refresh(token, context);
    if (sessions[0]) sessions[0].expiresAt = new Date(Date.now() - 1);

    await expect(auth.refresh(next.refreshToken, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('treats an unknown token as expired without touching any session', async () => {
    const { auth, sessions, audits, open } = build();
    open();
    await expect(auth.refresh(newRefreshToken().token, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(sessions[0]?.revokedAt).toBeNull();
    expect(audits).toEqual([]);
  });
});

describe('staff logout with a stale cookie', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(48));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('ends the session normally with the current token', async () => {
    const { auth, sessions, audits, open } = build();
    await auth.logout(open(), context);
    expect(sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(audits).toEqual([]);
  });

  it('ends the session, and records the replay, when the victim signs out after a theft', async () => {
    const { auth, sessions, audits, open } = build();
    const stolen = open();
    await auth.refresh(stolen, context); // the attacker rotates
    later();

    await auth.logout(stolen, context);

    expect(sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(audits).toEqual([{ action: 'session.replay_logout', entityId: 'session_1' }]);
  });

  it('ends the session without calling it theft inside the grace window', async () => {
    const { auth, sessions, audits, open } = build();
    const shared = open();
    await auth.refresh(shared, context);

    await auth.logout(shared, context);

    expect(sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect(audits).toEqual([]);
  });
});

describe('staff step-up needs a live session', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(48));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /** TOTP itself is covered in totp.test.ts; here only the session check matters. */
  const acceptAnyCode = (auth: AuthService) =>
    vi
      .spyOn(auth as unknown as { acceptTotp: () => Promise<boolean> }, 'acceptTotp')
      .mockResolvedValue(true);

  it('re-attests the current session and keeps its refresh token', async () => {
    const { auth, sessions, open } = build();
    const token = open();
    acceptAnyCode(auth);

    const result = await auth.stepUp(staff.id, '123456', token, context);

    expect(result.refreshToken).toBe(token);
    expect(sessions[0]?.revokedAt).toBeNull();
  });

  it('refuses without a refresh cookie, before the code is checked', async () => {
    const { auth } = build();
    const accept = acceptAnyCode(auth);

    await expect(auth.stepUp(staff.id, '123456', undefined, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(accept).not.toHaveBeenCalled();
  });

  it('refuses a session revoked for replay', async () => {
    const { auth, open } = build();
    const stolen = open();
    const current = await auth.refresh(stolen, context);
    later();
    await expect(auth.refresh(stolen, context)).rejects.toThrow();
    acceptAnyCode(auth);

    await expect(
      auth.stepUp(staff.id, '123456', current.refreshToken, context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuses another staff member's session", async () => {
    const { auth, open } = build();
    const token = open();
    acceptAnyCode(auth);

    await expect(auth.stepUp('staff_2', '123456', token, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('staff step-up and expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.stubEnv('JWT_ACCESS_SECRET', 'x'.repeat(48));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('refuses an expired, unrevoked session', async () => {
    const { auth, sessions, open } = build();
    const token = open();
    if (sessions[0]) sessions[0].expiresAt = new Date(Date.now() - 1);
    vi.spyOn(
      auth as unknown as { acceptTotp: () => Promise<boolean> },
      'acceptTotp',
    ).mockResolvedValue(true);

    await expect(auth.stepUp(staff.id, '123456', token, context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
