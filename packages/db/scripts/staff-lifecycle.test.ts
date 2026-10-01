import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '../src/index.js';

import { deactivateStaff, planDeactivation } from './staff-lifecycle.js';

interface Staff {
  id: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'READONLY';
  isActive: boolean;
}
interface Session {
  id: string;
  staffId: string;
  revokedAt: Date | null;
}
interface Audit {
  actorId: string | null;
  actorType: string;
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  hashPrev: string | null;
  hash: string;
}

/** Just enough of the client for the deactivation path, held in memory. */
function build() {
  const people: Staff[] = [
    { id: 'owner_1', email: 'owner@example.test', role: 'OWNER', isActive: true },
    { id: 'owner_2', email: 'second@example.test', role: 'OWNER', isActive: true },
    { id: 'admin_1', email: 'ops@example.test', role: 'ADMIN', isActive: true },
  ];
  const sessions: Session[] = [
    { id: 's1', staffId: 'admin_1', revokedAt: null },
    { id: 's2', staffId: 'admin_1', revokedAt: null },
    { id: 's3', staffId: 'admin_1', revokedAt: new Date('2026-01-01T00:00:00Z') },
    { id: 's4', staffId: 'owner_1', revokedAt: null },
  ];
  const audit: Audit[] = [
    {
      actorId: null,
      actorType: 'SYSTEM',
      entity: 'X',
      entityId: 'x',
      action: 'seed',
      before: null,
      after: null,
      hashPrev: null,
      hash: 'head',
    },
  ];
  let transactions = 0;

  const sessionMatches = (row: Session, where: { staffId: string; revokedAt: null }) =>
    row.staffId === where.staffId && row.revokedAt === null;

  const client = {
    staffUser: {
      findUnique: ({ where }: { where: { email: string } }) => {
        // A copy, as Prisma returns: a later update must not rewrite what was read.
        const row = people.find((p) => p.email === where.email);
        return Promise.resolve(row ? { ...row } : null);
      },
      count: ({ where }: { where: { role: string; isActive: boolean; NOT: { id: string } } }) =>
        Promise.resolve(
          people.filter(
            (p) => p.role === where.role && p.isActive === where.isActive && p.id !== where.NOT.id,
          ).length,
        ),
      update: ({ where, data }: { where: { id: string }; data: Partial<Staff> }) => {
        const row = people.find((p) => p.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
    staffSession: {
      count: ({ where }: { where: { staffId: string; revokedAt: null } }) =>
        Promise.resolve(sessions.filter((s) => sessionMatches(s, where)).length),
      updateMany: ({
        where,
        data,
      }: {
        where: { staffId: string; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        const hit = sessions.filter((s) => sessionMatches(s, where));
        for (const row of hit) row.revokedAt = data.revokedAt;
        return Promise.resolve({ count: hit.length });
      },
    },
    auditLog: {
      findFirst: () => Promise.resolve(audit.at(-1) ?? null),
      create: ({ data }: { data: Audit }) => {
        audit.push(data);
        return Promise.resolve(data);
      },
    },
    $transaction: <T>(work: (tx: unknown) => Promise<T>) => {
      transactions++;
      return work(client);
    },
  };

  return {
    db: client as unknown as PrismaClient,
    people,
    sessions,
    audit,
    transactions: () => transactions,
  };
}

const NOW = new Date('2026-10-01T12:00:00Z');
const ops = { email: 'ops@example.test', by: 'owner@example.test' };

describe('deactivateStaff (TASK-0088)', () => {
  it('turns the account off and revokes every session it still had, in one transaction', async () => {
    const { db, people, sessions, transactions } = build();

    const result = await deactivateStaff(db, ops, NOW);

    expect(result).toEqual({ staffId: 'admin_1', wasActive: true, sessionsRevoked: 2 });
    expect(people.find((p) => p.id === 'admin_1')?.isActive).toBe(false);
    const own = sessions.filter((s) => s.staffId === 'admin_1');
    expect(own.every((s) => s.revokedAt !== null)).toBe(true);
    expect(own.filter((s) => s.revokedAt === NOW)).toHaveLength(2);
    // An earlier revocation keeps its own timestamp.
    expect(sessions.find((s) => s.id === 's3')?.revokedAt).toEqual(
      new Date('2026-01-01T00:00:00Z'),
    );
    // Nobody else's session is touched.
    expect(sessions.find((s) => s.id === 's4')?.revokedAt).toBeNull();
    expect(transactions()).toBe(1);
  });

  it('writes staff.deactivated with the actor, chained onto the previous audit row', async () => {
    const { db, audit } = build();

    await deactivateStaff(db, ops, NOW);

    const entry = audit.at(-1);
    expect(entry).toMatchObject({
      actorId: 'owner_1',
      actorType: 'STAFF',
      entity: 'StaffUser',
      entityId: 'admin_1',
      action: 'staff.deactivated',
      before: { isActive: true, role: 'ADMIN' },
      after: { isActive: false, sessionsRevoked: 2, via: 'cli' },
      hashPrev: 'head',
    });
    expect(entry?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reactivating afterwards leaves every old session revoked', async () => {
    const { db, people, sessions } = build();
    await deactivateStaff(db, ops, NOW);

    // What `pnpm db:staff` does to the row: it touches no session but to revoke.
    const staff = people.find((p) => p.id === 'admin_1');
    if (staff) staff.isActive = true;

    expect(sessions.filter((s) => s.staffId === 'admin_1' && s.revokedAt === null)).toHaveLength(0);
  });

  it('accepts the email in any case and with stray spaces', async () => {
    const { db } = build();

    const result = await deactivateStaff(
      db,
      { email: '  OPS@Example.test ', by: 'Owner@example.test' },
      NOW,
    );

    expect(result.staffId).toBe('admin_1');
  });

  it('repairs an account switched off by hand whose sessions were left live', async () => {
    const { db, people, sessions, audit } = build();
    const staff = people.find((p) => p.id === 'admin_1');
    if (staff) staff.isActive = false;

    const result = await deactivateStaff(db, ops, NOW);

    expect(result).toEqual({ staffId: 'admin_1', wasActive: false, sessionsRevoked: 2 });
    expect(sessions.filter((s) => s.staffId === 'admin_1' && s.revokedAt === null)).toHaveLength(0);
    expect(audit.at(-1)?.before).toEqual({ isActive: false, role: 'ADMIN' });
  });

  it('is a no-op that writes nothing when there is nothing left to do', async () => {
    const { db, audit } = build();
    await deactivateStaff(db, ops, NOW);
    const rows = audit.length;

    const again = await deactivateStaff(db, ops, NOW);

    expect(again.sessionsRevoked).toBe(0);
    expect(audit).toHaveLength(rows);
  });

  it('refuses an actor that is not an active OWNER, and writes nothing', async () => {
    const { db, people, sessions, audit } = build();

    await expect(
      deactivateStaff(db, { email: 'ops@example.test', by: 'ops@example.test' }, NOW),
    ).rejects.toThrow(/not an active OWNER/);
    await expect(
      deactivateStaff(db, { email: 'ops@example.test', by: 'nobody@example.test' }, NOW),
    ).rejects.toThrow(/not an active OWNER/);
    const owner = people.find((p) => p.id === 'owner_2');
    if (owner) owner.isActive = false;
    await expect(
      deactivateStaff(db, { email: 'ops@example.test', by: 'second@example.test' }, NOW),
    ).rejects.toThrow(/not an active OWNER/);

    expect(people.find((p) => p.id === 'admin_1')?.isActive).toBe(true);
    expect(sessions.filter((s) => s.revokedAt === null)).toHaveLength(3);
    expect(audit).toHaveLength(1);
  });

  it('refuses to deactivate the last active OWNER', async () => {
    const { db, people } = build();
    const second = people.find((p) => p.id === 'owner_2');
    if (second) second.isActive = false;

    await expect(
      deactivateStaff(db, { email: 'owner@example.test', by: 'owner@example.test' }, NOW),
    ).rejects.toThrow(/only active OWNER/);
    expect(people.find((p) => p.id === 'owner_1')?.isActive).toBe(true);
  });

  it('lets one OWNER deactivate another while a second remains', async () => {
    const { db, people } = build();

    await deactivateStaff(db, { email: 'second@example.test', by: 'owner@example.test' }, NOW);

    expect(people.find((p) => p.id === 'owner_2')?.isActive).toBe(false);
  });

  it('refuses an unknown account', async () => {
    const { db } = build();

    await expect(
      deactivateStaff(db, { email: 'ghost@example.test', by: 'owner@example.test' }, NOW),
    ).rejects.toThrow(/No staff account/);
  });

  it('the plan reports the live sessions without writing anything', async () => {
    const { db, sessions, audit } = build();

    const plan = await planDeactivation(db, ops);

    expect(plan).toMatchObject({ liveSessions: 2, noop: false, actor: { id: 'owner_1' } });
    expect(sessions.filter((s) => s.revokedAt === null)).toHaveLength(3);
    expect(audit).toHaveLength(1);
  });
});
