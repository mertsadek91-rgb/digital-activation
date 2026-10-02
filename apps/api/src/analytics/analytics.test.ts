import { UnauthorizedException } from '@nestjs/common';
import { cleanUtm, recordAnalyticsEventSchema } from '@da/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service.js';

import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsPruneService, analyticsCutoff } from './analytics-prune.service.js';
import { AnalyticsService } from './analytics.service.js';
import { isBot, referrerHost, visitorId } from './pii.js';
import { SALT_BYTES, VisitorSaltService, utcDay } from './visitor-salt.service.js';

// Built, not written out: a literal of this shape is what a secret scanner looks for.
const INTERNAL_KEY = 'internal-unit-test-'.repeat(3);
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
const IP = '203.0.113.7';

const saved = { ...process.env };
beforeEach(() => {
  // Visitor ids must not depend on the access secret (TASK-0097): it is unset throughout.
  delete process.env.JWT_ACCESS_SECRET;
  process.env.INTERNAL_API_KEY = INTERNAL_KEY;
});
afterEach(() => {
  process.env = { ...saved };
});

/**
 * An in-memory `AnalyticsSalt` table with the semantics that matter: the day is
 * the primary key, `skipDuplicates` keeps the first row, and every call yields
 * to the event loop first so concurrent callers really interleave.
 */
function saltTable() {
  const rows = new Map<number, Uint8Array>();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    rows,
    createMany: vi.fn(
      async ({
        data,
        skipDuplicates,
      }: {
        data: { day: Date; salt: Uint8Array }[];
        skipDuplicates?: boolean;
      }) => {
        await tick();
        let count = 0;
        for (const row of data) {
          if (rows.has(row.day.getTime())) {
            if (!skipDuplicates) throw new Error('unique constraint');
            continue;
          }
          rows.set(row.day.getTime(), row.salt);
          count += 1;
        }
        return { count };
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: { day: Date } }) => {
      await tick();
      const salt = rows.get(where.day.getTime());
      return salt ? { salt } : null;
    }),
    deleteMany: vi.fn(async ({ where }: { where: { day: { lt: Date } } }) => {
      await tick();
      let count = 0;
      for (const day of [...rows.keys()]) {
        if (day < where.day.lt.getTime()) {
          rows.delete(day);
          count += 1;
        }
      }
      return { count };
    }),
  };
}

function world(analyticsSalt = saltTable()) {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]) };
  const client = {
    product: { findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' }) },
    category: { findUnique: vi.fn().mockResolvedValue({ id: 'cat_1' }) },
    analyticsEvent: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
    },
    analyticsSalt,
    $queryRaw: vi.fn(),
    $transaction: vi.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const prisma = { client } as unknown as PrismaService;
  const salts = new VisitorSaltService(prisma);
  return { client, tx, prisma, salts, service: new AnalyticsService(prisma, salts) };
}

const view = {
  type: 'PRODUCT_VIEW',
  path: '/store/office-2024',
  locale: 'ar',
  productSlug: 'office-2024',
} as const;

describe('recordAnalyticsEventSchema', () => {
  it('accepts a product view with attribution', () => {
    const parsed = recordAnalyticsEventSchema.safeParse({
      ...view,
      referrer: 'https://www.google.com/search?q=office',
      utmSource: 'google',
      utmMedium: 'cpc',
      utmCampaign: 'ramadan-2026',
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ['an unknown type', { ...view, type: 'PAGE_VIEW' }],
    ['a path with a query string', { ...view, path: '/store/x?token=abc' }],
    ['a path with a fragment', { ...view, path: '/store/x#y' }],
    ['a relative path', { ...view, path: 'store/x' }],
    ['an unknown locale', { ...view, locale: 'fr' }],
    ['a field it does not know (an email)', { ...view, email: 'a@b.test' }],
    ['a UTM value outside the allow-list', { ...view, utmSource: '<script>' }],
    ['an unknown WhatsApp placement', { ...view, type: 'WHATSAPP_CLICK', placement: 'banner' }],
  ])('refuses %s', (_label, input) => {
    expect(recordAnalyticsEventSchema.safeParse(input).success).toBe(false);
  });

  it('cleanUtm keeps short labels and drops anything that is not one', () => {
    expect(cleanUtm(' Instagram ')).toBe('instagram');
    expect(cleanUtm('someone@example.test')).toBeUndefined();
    expect(cleanUtm('a'.repeat(101))).toBeUndefined();
    expect(cleanUtm(['google'])).toBeUndefined();
  });
});

describe('PII reduction', () => {
  it('keeps only the host of a referrer', () => {
    expect(referrerHost('https://WWW.Google.com/search?q=office&token=secret')).toBe(
      'www.google.com',
    );
    expect(referrerHost('instagram.com')).toBe('instagram.com');
    expect(referrerHost('javascript:alert(1)')).toBeNull();
    expect(referrerHost('not a url at all')).toBeNull();
    expect(referrerHost(undefined)).toBeNull();
  });

  it('hashes the visitor with the salt alone and never includes the address', () => {
    const salt = new Uint8Array(SALT_BYTES).fill(7);
    const id = visitorId(IP, BROWSER, salt);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(id).not.toContain('203');
    expect(visitorId(IP, BROWSER, new Uint8Array(salt))).toBe(id);
    expect(visitorId('203.0.113.8', BROWSER, salt)).not.toBe(id);
    expect(visitorId(IP, BROWSER, new Uint8Array(SALT_BYTES).fill(8))).not.toBe(id);
    // No secret from the environment takes part.
    process.env.JWT_ACCESS_SECRET = 'other-unit-test-secret-'.repeat(2);
    expect(visitorId(IP, BROWSER, salt)).toBe(id);
  });

  it('has no visitor id without a valid address or without a salt', () => {
    const salt = new Uint8Array(SALT_BYTES).fill(7);
    expect(visitorId(undefined, BROWSER, salt)).toBeNull();
    expect(visitorId('not-an-ip', BROWSER, salt)).toBeNull();
    expect(visitorId(IP, BROWSER, null)).toBeNull();
    expect(visitorId(IP, BROWSER, new Uint8Array())).toBeNull();
  });

  it('stores a host, a hash and ids — never the address, user agent or full referrer', async () => {
    const w = world();
    const now = new Date('2026-10-02T09:00:00Z');
    const recorded = await w.service.record(
      { ...view, referrer: 'https://t.co/abc?login_token=secret', utmSource: 'twitter' },
      { ip: IP, userAgent: BROWSER },
      now,
    );
    expect(recorded).toBe(true);
    const { data } = w.client.analyticsEvent.create.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data).toMatchObject({
      type: 'PRODUCT_VIEW',
      path: '/store/office-2024',
      productId: 'prod_1',
      categoryId: null,
      locale: 'AR',
      referrerHost: 't.co',
      utmSource: 'twitter',
      visitorId: visitorId(IP, BROWSER, w.client.analyticsSalt.rows.get(utcDay(now).getTime())!),
    });
    expect(data.visitorId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const stored = JSON.stringify(data);
    expect(stored).not.toContain(IP);
    expect(stored).not.toContain('Mozilla');
    expect(stored).not.toContain('login_token');
  });

  it('records nothing for a crawler or a link preview', async () => {
    const w = world();
    expect(await w.service.record(view, { ip: IP, userAgent: 'WhatsApp/2.23.20.0' })).toBe(false);
    expect(await w.service.record(view, { ip: IP, userAgent: 'Googlebot/2.1' })).toBe(false);
    expect(await w.service.record(view, { ip: IP })).toBe(false);
    expect(w.client.analyticsEvent.create).not.toHaveBeenCalled();
    expect(isBot(BROWSER)).toBe(false);
  });
});

describe('VisitorSaltService', () => {
  const morning = new Date('2026-10-02T00:00:01Z');
  const night = new Date('2026-10-02T23:59:59Z');
  const tomorrow = new Date('2026-10-03T00:00:00Z');

  it('gives the same visitor one id all day and a different one the next day', async () => {
    const w = world();
    const id = async (now: Date) => {
      await w.service.record(view, { ip: IP, userAgent: BROWSER }, now);
      const calls = w.client.analyticsEvent.create.mock.calls;
      return (calls[calls.length - 1]![0] as { data: { visitorId: string | null } }).data.visitorId;
    };
    const first = await id(morning);
    expect(first).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await id(night)).toBe(first);
    expect(await id(tomorrow)).not.toBe(first);
    expect(w.client.analyticsSalt.rows.size).toBe(2);
    expect(process.env.JWT_ACCESS_SECRET).toBeUndefined();
  });

  it('creates 32 random bytes for the UTC day and caches them until the day changes', async () => {
    const w = world();
    const salt = await w.salts.saltFor(morning);
    expect(salt).toHaveLength(SALT_BYTES);
    expect(w.client.analyticsSalt.rows.get(Date.UTC(2026, 9, 2))).toEqual(salt);
    expect(await w.salts.saltFor(night)).toBe(salt);
    expect(w.client.analyticsSalt.createMany).toHaveBeenCalledTimes(1);
    expect(w.client.analyticsSalt.findUnique).toHaveBeenCalledTimes(1);
    expect(await w.salts.saltFor(tomorrow)).not.toEqual(salt);
    expect(w.client.analyticsSalt.createMany).toHaveBeenCalledTimes(2);
  });

  it('ends up with one salt when two replicas ask for the first time at once', async () => {
    const table = saltTable();
    const a = world(table).salts;
    const b = world(table).salts;
    const [sa, sb, sa2] = await Promise.all([
      a.saltFor(morning),
      b.saltFor(morning),
      a.saltFor(morning),
    ]);
    expect(table.rows.size).toBe(1);
    expect(sa).toEqual(table.rows.get(Date.UTC(2026, 9, 2)));
    expect(sb).toEqual(sa);
    expect(sa2).toBe(sa);
    // Both replicas inserted with skipDuplicates; within one, the lookup in flight was shared.
    expect(table.createMany).toHaveBeenCalledTimes(2);
    for (const [args] of table.createMany.mock.calls) expect(args.skipDuplicates).toBe(true);
  });

  it('records the event without a visitor id when the database cannot give a salt', async () => {
    const w = world();
    w.client.analyticsSalt.createMany.mockRejectedValueOnce(new Error('connection refused'));
    expect(await w.service.record(view, { ip: IP, userAgent: BROWSER }, morning)).toBe(true);
    const { data } = w.client.analyticsEvent.create.mock.calls[0]![0] as {
      data: { visitorId: string | null };
    };
    expect(data.visitorId).toBeNull();
    // The failure is not cached: the next event gets a salt.
    expect(await w.salts.saltFor(morning)).toHaveLength(SALT_BYTES);
  });

  it("forgets a past day's salt after midnight, and keeps today's", async () => {
    const w = world();
    await w.salts.saltFor(morning);
    w.salts.forgetPast(night);
    await w.salts.saltFor(night);
    expect(w.client.analyticsSalt.findUnique).toHaveBeenCalledTimes(1);
    w.salts.forgetPast(tomorrow);
    // The prune has deleted yesterday's row by now; nothing in memory still holds it.
    expect(Reflect.get(w.salts, 'cached')).toBeUndefined();
  });

  it('does not touch the salt table for an event without an address', async () => {
    const w = world();
    expect(await w.service.record(view, { userAgent: BROWSER }, morning)).toBe(true);
    expect(w.client.analyticsSalt.createMany).not.toHaveBeenCalled();
  });
});

describe('POST /v1/analytics/events', () => {
  it('refuses a call without the internal key, with a wrong one, and when none is configured', async () => {
    const w = world();
    const controller = new AnalyticsController(w.service);
    await expect(controller.record(view, undefined, IP, BROWSER)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.record(view, 'wrong', IP, BROWSER)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    delete process.env.INTERNAL_API_KEY;
    await expect(controller.record(view, INTERNAL_KEY, IP, BROWSER)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(w.client.analyticsEvent.create).not.toHaveBeenCalled();
  });

  it('checks the key before the body: no key and a junk body is 401, not 400', async () => {
    const w = world();
    const controller = new AnalyticsController(w.service);
    await expect(controller.record({}, undefined, IP, BROWSER)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // With the key, the same junk body is refused as invalid.
    await expect(controller.record({}, INTERNAL_KEY, IP, BROWSER)).rejects.not.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('records with the key, ignoring a forwarded address that is not one', async () => {
    const w = world();
    const controller = new AnalyticsController(w.service);
    expect(await controller.record(view, INTERNAL_KEY, IP, BROWSER)).toEqual({ recorded: true });
    expect(await controller.record(view, INTERNAL_KEY, 'junk', BROWSER)).toEqual({
      recorded: true,
    });
    const second = w.client.analyticsEvent.create.mock.calls[1]![0] as {
      data: { visitorId: string | null };
    };
    expect(second.data.visitorId).toBeNull();
  });
});

describe('AnalyticsPruneService', () => {
  it('keeps thirteen months', () => {
    expect(analyticsCutoff(new Date('2026-10-02T03:29:00Z'))).toEqual(
      new Date('2025-09-02T03:29:00Z'),
    );
  });

  it('deletes rows older than the cutoff, under its advisory lock', async () => {
    const w = world();
    const service = new AnalyticsPruneService(w.prisma);
    const now = new Date('2026-10-02T03:29:00Z');
    expect(await service.sweep(now)).toEqual({ deleted: 4, saltsDeleted: 0 });
    expect(w.tx.$queryRaw).toHaveBeenCalled();
    expect(w.client.analyticsEvent.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2025-09-02T03:29:00Z') } },
    });
  });

  it('does nothing when another replica holds the lock', async () => {
    const w = world();
    w.tx.$queryRaw.mockResolvedValue([{ locked: false }]);
    const service = new AnalyticsPruneService(w.prisma);
    expect(await service.sweep()).toEqual({ deleted: 0, saltsDeleted: 0 });
    expect(w.client.analyticsEvent.deleteMany).not.toHaveBeenCalled();
    expect(w.client.analyticsSalt.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes every salt older than the current UTC day and keeps today's", async () => {
    const w = world();
    const salts = w.client.analyticsSalt.rows;
    for (const day of [Date.UTC(2026, 8, 30), Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 2)]) {
      salts.set(day, new Uint8Array(SALT_BYTES));
    }
    const service = new AnalyticsPruneService(w.prisma);
    expect(await service.sweep(new Date('2026-10-02T03:29:00Z'))).toEqual({
      deleted: 4,
      saltsDeleted: 2,
    });
    expect([...salts.keys()]).toEqual([Date.UTC(2026, 9, 2)]);
    expect(w.client.analyticsSalt.deleteMany).toHaveBeenCalledWith({
      where: { day: { lt: new Date('2026-10-02T00:00:00Z') } },
    });
  });
});

describe('summary', () => {
  it('reads counts per day and type for thirty days', async () => {
    const w = world();
    w.client.$queryRaw.mockResolvedValue([
      { day: '2026-10-01', type: 'PRODUCT_VIEW', events: 12, visitors: 5 },
    ]);
    const summary = await w.service.summary(new Date('2026-10-02T00:00:00Z'));
    expect(summary).toEqual({
      since: '2026-09-02T00:00:00.000Z',
      days: [{ day: '2026-10-01', type: 'PRODUCT_VIEW', events: 12, visitors: 5 }],
    });
  });
});
