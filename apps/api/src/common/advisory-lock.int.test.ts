import { prisma } from '@da/db';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { HAS_DATABASE } from '../integration/harness.js';

import { withAdvisoryLock } from './advisory-lock.js';

/**
 * BUG-0001 / TASK-0010. The sweeps used to take a *session* advisory lock with
 * one `$queryRaw` and release it with another. Both go through the pg pool, so
 * under load the unlock can run on a different connection: it returns false,
 * and the lock stays held by the first connection until that connection dies.
 * Every later tick that lands on another connection then skips the sweep.
 */
const KEY = 761_299_001;

async function holders(): Promise<number[]> {
  const rows = await prisma.$queryRaw<{ pid: number }[]>`
    select pid from pg_locks where locktype = 'advisory' and objid = ${KEY} and granted`;
  return rows.map((r) => r.pid);
}

/** Keep other pool connections busy, the way API traffic does. */
const noise = (n = 6): Promise<unknown>[] =>
  Array.from({ length: n }, () => prisma.$executeRaw`select pg_sleep(0.03)`);

/**
 * Ends whichever connection still holds the lock. A terminated backend stays
 * in the pg pool as an idle client until somebody borrows it, and that
 * somebody gets `57P01 terminating connection due to administrator command` —
 * which, under `noise()`, was the next test's first query often enough to
 * fail CI. So the pool is dropped after a kill and refills on the next query.
 */
async function release(): Promise<void> {
  const pids = await holders();
  for (const pid of pids) await prisma.$queryRaw`select pg_terminate_backend(${pid})`;
  if (pids.length) await prisma.$disconnect();
}

describe.skipIf(!HAS_DATABASE)('advisory locks for scheduled sweeps', () => {
  beforeEach(release);
  afterAll(async () => {
    await release();
    await prisma.$disconnect();
  });

  it('reproduces the defect: lock and unlock on separate pooled calls can leave the lock held', async () => {
    let leaked = 0;
    for (let i = 0; i < 30 && leaked === 0; i++) {
      const [lock] = await prisma.$queryRaw<
        { locked: boolean }[]
      >`select pg_try_advisory_lock(${KEY}) as locked`;
      if (!lock?.locked) continue;
      await Promise.all([
        ...noise(),
        prisma.$queryRaw`select pg_advisory_unlock(${KEY})`,
        ...noise(),
      ]);
      if ((await holders()).length) leaked += 1;
      await release();
    }
    expect(
      leaked,
      'the old pattern should leak at least once under concurrent load',
    ).toBeGreaterThan(0);
  });

  it('withAdvisoryLock always releases, even under the same load', async () => {
    for (let i = 0; i < 30; i++) {
      const [result] = await Promise.all([
        withAdvisoryLock(prisma, KEY, () => Promise.resolve('ran')),
        ...noise(),
      ]);
      expect(result).toEqual({ ran: true, value: 'ran' });
      expect(await holders()).toEqual([]);
    }
  });

  it('runs exactly one of several concurrent callers, and the next tick runs again', async () => {
    let entered = 0;
    const work = async (): Promise<number> => {
      entered += 1;
      await new Promise((r) => setTimeout(r, 150));
      return entered;
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => withAdvisoryLock(prisma, KEY, work)),
    );
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(entered).toBe(1);
    expect((await withAdvisoryLock(prisma, KEY, work)).ran).toBe(true);
  });

  it('says clearly when a sweep outlives its lock window (REV-0006)', async () => {
    let entered = false;
    const slow = withAdvisoryLock(
      prisma,
      KEY,
      async () => {
        entered = true;
        await new Promise((r) => setTimeout(r, 1_500));
      },
      { timeoutMs: 400 },
    );
    const settled = slow.then(
      () => null,
      (error: unknown) => error,
    );
    await new Promise((r) => setTimeout(r, 900));
    expect(entered, 'the lock was taken before the window closed').toBe(true);
    // The window has closed while the work runs on: the lock is free again,
    // which is exactly the concurrency the error warns about.
    expect((await withAdvisoryLock(prisma, KEY, () => Promise.resolve(1))).ran).toBe(true);
    expect(((await settled) as Error).message).toMatch(
      /completed, but outlived its 400 ms lock window/,
    );
  });

  it('releases the lock when the work throws', async () => {
    await expect(
      withAdvisoryLock(prisma, KEY, () => Promise.reject(new Error('sweep failed'))),
    ).rejects.toThrow('sweep failed');
    expect(await holders()).toEqual([]);
    expect((await withAdvisoryLock(prisma, KEY, () => Promise.resolve(1))).ran).toBe(true);
  });
});
