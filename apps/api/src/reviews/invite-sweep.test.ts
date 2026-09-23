import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteSweepService } from './invite-sweep.service.js';
import type { ReviewsService } from './reviews.service.js';
import type { MarketingSettingsService } from '../marketing/marketing-settings.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Guards the two things about this sweep that fail silently.
 *
 * A send window and an advisory lock both fail the same way when they are
 * wrong: nothing is sent, nothing throws, and nobody finds out until somebody
 * asks why the store has no reviews. The timezone arithmetic in particular is
 * worth pinning — a gate that is accidentally always closed looks exactly like
 * a gate that is working, from the outside.
 */
function build(overrides?: {
  locked?: boolean;
  orders?: { id: string; number: string }[];
  reviewRequests?: { firstAfterDays: number; secondAfterDays: number };
}) {
  const invited: { orderId: string; stage: number }[] = [];
  const queries: string[] = [];
  /** Each stage's query: which stage, and the delivery cut-off it asked for. */
  const asked: { stage: number; due: Date }[] = [];

  const prisma = {
    client: {
      $queryRaw: (strings: TemplateStringsArray) => {
        const text = strings.join('?');
        queries.push(text);
        if (text.includes('pg_try_advisory_lock')) {
          return Promise.resolve([{ locked: overrides?.locked ?? true }]);
        }
        return Promise.resolve([]);
      },
      order: {
        findMany: ({
          where,
        }: {
          where: {
            reviewInvites: { none: { stage: number } };
            items: { some: { deliveredAt: { lte: Date } } };
          };
        }) => {
          asked.push({
            stage: where.reviewInvites.none.stage,
            due: where.items.some.deliveredAt.lte,
          });
          // Only stage 1 has anything due, so a pass that reaches stage 2 is
          // visible as an empty second query rather than as a duplicate send.
          return Promise.resolve(
            where.reviewInvites.none.stage === 1 ? (overrides?.orders ?? []) : [],
          );
        },
      },
    },
  } as unknown as PrismaService;

  const reviews = {
    invite: (input: { orderId: string; stage: number }) => {
      invited.push(input);
      return Promise.resolve({ sent: true });
    },
  } as unknown as ReviewsService;

  // The defaults are what the sweep hard-coded before the days were a setting.
  const settings = {
    get: () =>
      Promise.resolve(overrides?.reviewRequests ?? { firstAfterDays: 3, secondAfterDays: 10 }),
  } as unknown as MarketingSettingsService;

  return { service: new InviteSweepService(prisma, reviews, settings), invited, queries, asked };
}

describe('InviteSweepService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.STORE_TIMEZONE = 'Asia/Riyadh';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.STORE_TIMEZONE;
  });

  it('sends inside the store’s working hours', async () => {
    // 08:00 UTC is 11:00 in Riyadh.
    vi.setSystemTime(new Date('2026-09-12T08:00:00Z'));
    const { service, invited } = build({ orders: [{ id: 'o1', number: 'DA-1' }] });

    await expect(service.sweep()).resolves.toEqual({ sent: 1, skipped: 0 });
    expect(invited).toEqual([{ orderId: 'o1', stage: 1 }]);
  });

  it('sends nothing at 3am, which is an hour this store takes orders in', async () => {
    // 00:00 UTC is 03:00 in Riyadh — a real purchase hour here, and so a real
    // delivery hour, and so the hour a day-3 email would land without this.
    vi.setSystemTime(new Date('2026-09-12T00:00:00Z'));
    const { service, invited, queries } = build({ orders: [{ id: 'o1', number: 'DA-1' }] });

    await expect(service.sweep()).resolves.toEqual({ sent: 0, skipped: 0 });
    expect(invited).toEqual([]);
    // Refused before the lock: an hourly cron that grabs a database lock
    // fifteen times a night for nothing is a lock somebody has to explain.
    expect(queries).toEqual([]);
  });

  it('reads the window in the store’s timezone and not the server’s', async () => {
    // 21:00 UTC is midnight in Riyadh. A server reading its own UTC clock would
    // call this 21:00 and send.
    vi.setSystemTime(new Date('2026-09-12T21:00:00Z'));
    const { service, invited } = build({ orders: [{ id: 'o1', number: 'DA-1' }] });

    await expect(service.sweep()).resolves.toEqual({ sent: 0, skipped: 0 });
    expect(invited).toEqual([]);
  });

  it('does nothing when another replica already holds the lock', async () => {
    vi.setSystemTime(new Date('2026-09-12T08:00:00Z'));
    const { service, invited } = build({
      locked: false,
      orders: [{ id: 'o1', number: 'DA-1' }],
    });

    await expect(service.sweep()).resolves.toEqual({ sent: 0, skipped: 0 });
    expect(invited).toEqual([]);
  });

  it('releases the lock even when the pass throws', async () => {
    vi.setSystemTime(new Date('2026-09-12T08:00:00Z'));
    const { service, queries } = build({ orders: [{ id: 'o1', number: 'DA-1' }] });
    // A throw from `invite` is caught per order, so break the query instead.
    vi.spyOn(
      (service as unknown as { prisma: PrismaService }).prisma.client.order,
      'findMany',
    ).mockRejectedValue(new Error('database went away'));

    await expect(service.sweep()).rejects.toThrow('database went away');
    expect(queries.some((text) => text.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('counts an order it could not email as skipped and keeps going', async () => {
    vi.setSystemTime(new Date('2026-09-12T08:00:00Z'));
    const { service } = build({
      orders: [
        { id: 'o1', number: 'DA-1' },
        { id: 'o2', number: 'DA-2' },
      ],
    });
    let call = 0;
    vi.spyOn(
      (service as unknown as { reviews: ReviewsService }).reviews,
      'invite',
    ).mockImplementation(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error('SMTP refused'))
        : Promise.resolve({ sent: true });
    });

    await expect(service.sweep()).resolves.toEqual({ sent: 1, skipped: 1 });
  });

  it('asks at the days the review-request settings name', async () => {
    const now = new Date('2026-09-12T08:00:00Z');
    vi.setSystemTime(now);
    const { service, asked } = build({ reviewRequests: { firstAfterDays: 2, secondAfterDays: 7 } });

    await service.sweep();
    const day = 24 * 60 * 60 * 1000;
    expect(asked).toEqual([
      { stage: 1, due: new Date(now.getTime() - 2 * day) },
      { stage: 2, due: new Date(now.getTime() - 7 * day) },
    ]);
  });

  it('sends no reminder when the second request is set to 0', async () => {
    vi.setSystemTime(new Date('2026-09-12T08:00:00Z'));
    const { service, asked } = build({ reviewRequests: { firstAfterDays: 3, secondAfterDays: 0 } });

    await service.sweep();
    expect(asked.map((entry) => entry.stage)).toEqual([1]);
  });
});
