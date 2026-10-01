import type { PrismaClient } from '@da/db';
import { describe, expect, it } from 'vitest';

import { withAdvisoryLock } from './advisory-lock.js';

/**
 * Prisma gives every transaction-manager failure the same code, P2028 — a
 * transaction that expired under running work, and one that never started
 * because the pool stayed busy past `maxWait`. Only the first is an overrun
 * (REV-0006 follow-up); the real-Postgres cases are in advisory-lock.int.test.ts.
 */
const p2028 = (message: string) => Object.assign(new Error(message), { code: 'P2028' });

describe('withAdvisoryLock overrun reporting', () => {
  it('passes a pool-wait timeout through unchanged: the work never ran', async () => {
    const client = {
      $transaction: () => Promise.reject(p2028('Unable to start a transaction in the given time.')),
    } as unknown as PrismaClient;
    let ran = false;

    await expect(
      withAdvisoryLock(client, 1, () => {
        ran = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow('Unable to start a transaction in the given time.');
    expect(ran).toBe(false);
  });

  it('names the overrun when the work completed but the transaction had expired', async () => {
    const client = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback({ $queryRaw: () => Promise.resolve([{ locked: true }]) });
        throw p2028('A commit cannot be executed on an expired transaction.');
      },
    } as unknown as PrismaClient;

    const slow = () => new Promise<void>((r) => setTimeout(r, 80));
    await expect(withAdvisoryLock(client, 7, slow, { timeoutMs: 50 })).rejects.toThrow(
      /advisory lock 7: the sweep completed, but outlived its 50 ms lock window/,
    );
  });

  it('does not blame the window for a commit failure inside it', async () => {
    const client = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        await callback({ $queryRaw: () => Promise.resolve([{ locked: true }]) });
        throw p2028('Transaction API error: connection closed.');
      },
    } as unknown as PrismaClient;

    await expect(
      withAdvisoryLock(client, 7, () => Promise.resolve(), { timeoutMs: 60_000 }),
    ).rejects.toThrow('Transaction API error: connection closed.');
  });

  it('names the overrun when the work fails after the window closed', async () => {
    const client = {
      $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ $queryRaw: () => Promise.resolve([{ locked: true }]) }),
    } as unknown as PrismaClient;
    const failsLate = () =>
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('sweep failed')), 80));

    const error = await withAdvisoryLock(client, 7, failsLate, { timeoutMs: 50 }).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toMatch(/the sweep failed after it outlived its 50 ms lock window/);
    expect((error?.cause as Error).message).toBe('sweep failed');
  });
});
