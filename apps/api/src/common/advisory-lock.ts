import type { PrismaClient } from '@da/db';

export type LockResult<T> = { ran: true; value: T } | { ran: false };

/** A sweep that runs longer than this loses its lock (Prisma closes the transaction) and reports it. */
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Run `work` only if no other process holds `key`, and always let go afterwards.
 *
 * The lock is *transaction*-scoped (`pg_try_advisory_xact_lock`) and taken
 * inside an interactive transaction, which Prisma pins to one pooled
 * connection. Postgres releases it by itself when that transaction ends —
 * commit, rollback, or the connection dying with the process — so there is no
 * unlock call to land on the wrong connection.
 *
 * That is the bug this replaces (BUG-0001): a session lock taken with one
 * `$queryRaw` and released with another. Both went through the pool, the
 * unlock could run on a different connection, and the lock then stayed with
 * the first one; every later tick that landed elsewhere skipped the sweep.
 *
 * `work` uses the ordinary client, not the transaction: the transaction only
 * holds the lock, so the sweep's own writes commit as they always did. The
 * cost is one pooled connection held idle for the length of a sweep.
 */
export async function withAdvisoryLock<T>(
  client: PrismaClient,
  key: number,
  work: () => Promise<T>,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<LockResult<T>> {
  // Set once `work` holds the lock, so a timeout before that — the pool busy
  // past `maxWait`, or the lock query itself slow — is not reported as an overrun.
  let started = 0;
  let outcome: 'completed' | 'failed' | undefined;
  try {
    return await client.$transaction(
      async (tx): Promise<LockResult<T>> => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`select pg_try_advisory_xact_lock(${key}) as locked`;
        if (!lock?.locked) return { ran: false };
        started = Date.now();
        try {
          const value = await work();
          outcome = 'completed';
          return { ran: true, value };
        } catch (error) {
          outcome = 'failed';
          if (Date.now() - started > timeoutMs) throw overrun(key, timeoutMs, 'failed', error);
          throw error;
        }
      },
      { maxWait: 10_000, timeout: timeoutMs },
    );
  } catch (error) {
    // Prisma closed the transaction because the work outlived `timeoutMs`. The
    // lock went with it while the work kept running, so another replica or the
    // next tick may have run the same sweep concurrently (REV-0006). Say so
    // loudly rather than surfacing a generic "expired transaction" error.
    if (
      outcome === 'completed' &&
      (error as { code?: string }).code === 'P2028' &&
      Date.now() - started > timeoutMs
    )
      throw overrun(key, timeoutMs, 'completed', error);
    throw error;
  }
}

function overrun(
  key: number,
  timeoutMs: number,
  outcome: 'completed' | 'failed',
  cause: unknown,
): Error {
  return new Error(
    `advisory lock ${String(key)}: the sweep ${outcome === 'completed' ? 'completed, but ' : 'failed after it '}outlived its ${String(timeoutMs)} ms lock window; the lock was released while it was still running, so a concurrent run was possible`,
    { cause },
  );
}
