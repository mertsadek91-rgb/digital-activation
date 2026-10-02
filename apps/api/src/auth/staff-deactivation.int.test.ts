import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { StaffRole, type StaffUser } from '@da/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../integration/guard.js';
import { type Harness, HAS_DATABASE, bootApp } from '../integration/harness.js';

import { AuthService, type SessionResult } from './auth.service.js';

const DB_PACKAGE = path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'db');

/**
 * TASK-0088, end to end: the operator's CLI against the real schema, and the
 * real API answering the sessions it revoked.
 *
 * The script is run as a separate process, the way an operator runs it, with
 * DATABASE_URL pointed at the test database. dotenv never overrides a variable
 * that is already set, so the repo's `.env` cannot redirect it.
 */
function deactivateCli(...args: string[]): { status: number | null; output: string } {
  return dbScript('scripts/deactivate-staff.ts', args);
}

function dbScript(script: string, args: string[]): { status: number | null; output: string } {
  const url = testDatabaseUrl();
  if (!url) throw new Error('No test database.');
  const result = spawnSync(
    process.execPath,
    [path.join(DB_PACKAGE, 'node_modules', 'tsx', 'dist', 'cli.mjs'), script, ...args],
    {
      cwd: DB_PACKAGE,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
      timeout: 60_000,
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe.skipIf(!HAS_DATABASE)('deactivating a staff account', () => {
  let harness: Harness;
  let owner: StaffUser;
  let target: StaffUser;
  let sessions: SessionResult[];

  const me = (session: SessionResult) =>
    harness.app.inject({
      method: 'GET',
      url: '/v1/auth/staff/me',
      cookies: { da_access: session.accessToken },
    });
  const refresh = (session: SessionResult) =>
    harness.app.inject({
      method: 'POST',
      url: '/v1/auth/staff/refresh',
      cookies: { da_refresh: session.refreshToken },
    });

  beforeAll(async () => {
    harness = await bootApp();
    const run = randomBytes(4).toString('hex');
    const staff = (label: string, role: StaffRole) =>
      harness.db.staffUser.create({
        data: {
          email: `${label}-${run}@example.test`,
          name: label,
          role,
          passwordHash: 'not-a-real-hash',
          totpEnabledAt: new Date(),
        },
      });
    owner = await staff('owner', StaffRole.OWNER);
    target = await staff('ops', StaffRole.ADMIN);

    // Sign in twice, the way login does once the password and TOTP clear.
    const auth = harness.get(AuthService) as unknown as {
      issueSession: (staff: StaffUser, context: object) => Promise<SessionResult>;
    };
    sessions = [await auth.issueSession(target, {}), await auth.issueSession(target, {})];
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('both sessions work before anything is done', async () => {
    for (const session of sessions) expect((await me(session)).statusCode).toBe(200);
  });

  it('a dry run reports and writes nothing', async () => {
    const { status, output } = deactivateCli('--email', target.email, '--by', owner.email);

    expect(status, output).toBe(0);
    expect(output).toContain('Dry run');
    expect(
      (await harness.db.staffUser.findUniqueOrThrow({ where: { id: target.id } })).isActive,
    ).toBe(true);
    expect(
      await harness.db.staffSession.count({ where: { staffId: target.id, revokedAt: null } }),
    ).toBe(2);
    expect(
      await harness.db.auditLog.count({
        where: { entityId: target.id, action: 'staff.deactivated' },
      }),
    ).toBe(0);
    for (const session of sessions) expect((await me(session)).statusCode).toBe(200);
  });

  it('a non-owner actor is refused', () => {
    const { status, output } = deactivateCli(
      '--email',
      owner.email,
      '--by',
      target.email,
      '--apply',
    );

    expect(status).toBe(1);
    expect(output).toContain('not an active OWNER');
  });

  it('--apply turns the account off, revokes every session and writes the audit entry', async () => {
    const head = await harness.db.auditLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { hash: true },
    });

    const { status, output } = deactivateCli(
      '--email',
      target.email,
      '--by',
      owner.email,
      '--apply',
    );

    expect(status, output).toBe(0);
    expect(output).toContain('2 session(s) revoked');
    expect(
      (await harness.db.staffUser.findUniqueOrThrow({ where: { id: target.id } })).isActive,
    ).toBe(false);
    const rows = await harness.db.staffSession.findMany({ where: { staffId: target.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);

    const entry = await harness.db.auditLog.findFirstOrThrow({
      where: { entityId: target.id, action: 'staff.deactivated' },
    });
    expect(entry).toMatchObject({
      actorId: owner.id,
      actorType: 'STAFF',
      entity: 'StaffUser',
      before: { isActive: true, role: 'ADMIN' },
      after: { isActive: false, sessionsRevoked: 2, via: 'cli' },
      hashPrev: head?.hash ?? null,
    });
  });

  it('a still-valid access token is refused on its next request', async () => {
    for (const session of sessions) expect((await me(session)).statusCode).toBe(401);
  });

  it('reactivating the account revives none of the old sessions', async () => {
    await harness.db.staffUser.update({ where: { id: target.id }, data: { isActive: true } });

    for (const session of sessions) {
      expect((await me(session)).statusCode).toBe(401);
      expect((await refresh(session)).statusCode).toBe(401);
    }
    expect(
      await harness.db.staffSession.count({ where: { staffId: target.id, revokedAt: null } }),
    ).toBe(0);
  });

  it('create-staff, the real reactivation path, revokes any session left alive', async () => {
    // A session that slipped in while the account was off (a login racing the
    // deactivation): create-staff must not let it survive the reactivation.
    await harness.db.staffUser.update({ where: { id: target.id }, data: { isActive: false } });
    const stray = await harness.db.staffSession.create({
      data: {
        staffId: target.id,
        tokenHash: `stray-${target.id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const run = dbScript('scripts/create-staff.ts', [
      '--email',
      target.email,
      '--name',
      target.name,
      '--role',
      target.role,
    ]);
    expect(run.status, run.output).toBe(0);

    const after = await harness.db.staffUser.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.isActive).toBe(true);
    const row = await harness.db.staffSession.findUniqueOrThrow({ where: { id: stray.id } });
    expect(row.revokedAt).not.toBeNull();
    expect(
      await harness.db.staffSession.count({ where: { staffId: target.id, revokedAt: null } }),
    ).toBe(0);
  });
});
