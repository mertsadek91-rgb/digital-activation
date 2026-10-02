import { UnauthorizedException } from '@nestjs/common';
import { cleanUtm, recordAnalyticsEventSchema } from '@da/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service.js';

import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsPruneService, analyticsCutoff } from './analytics-prune.service.js';
import { AnalyticsService } from './analytics.service.js';
import { isBot, referrerHost, visitorId } from './pii.js';

// Built, not written out: a literal of this shape is what a secret scanner looks for.
const ACCESS_SECRET = 'analytics-unit-test-'.repeat(3);
const INTERNAL_KEY = 'internal-unit-test-'.repeat(3);
const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
const IP = '203.0.113.7';

const saved = { ...process.env };
beforeEach(() => {
  process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
  process.env.INTERNAL_API_KEY = INTERNAL_KEY;
});
afterEach(() => {
  process.env = { ...saved };
});

function world() {
  const tx = { $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]) };
  const client = {
    product: { findUnique: vi.fn().mockResolvedValue({ id: 'prod_1' }) },
    category: { findUnique: vi.fn().mockResolvedValue({ id: 'cat_1' }) },
    analyticsEvent: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn((work: (t: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const prisma = { client } as unknown as PrismaService;
  return { client, tx, prisma, service: new AnalyticsService(prisma) };
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

  it('hashes the visitor per day and never includes the address', () => {
    const day = new Date('2026-10-02T09:00:00Z');
    const id = visitorId(IP, BROWSER, day);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(id).not.toContain('203');
    // Same visitor, same day: one id. Next day, a stranger.
    expect(visitorId(IP, BROWSER, new Date('2026-10-02T23:59:00Z'))).toBe(id);
    expect(visitorId(IP, BROWSER, new Date('2026-10-03T00:00:00Z'))).not.toBe(id);
    expect(visitorId('203.0.113.8', BROWSER, day)).not.toBe(id);
    // The key matters: another deployment's secret gives other ids.
    process.env.JWT_ACCESS_SECRET = 'other-unit-test-secret-'.repeat(2);
    expect(visitorId(IP, BROWSER, day)).not.toBe(id);
  });

  it('has no visitor id without a valid address', () => {
    expect(visitorId(undefined, BROWSER, new Date())).toBeNull();
    expect(visitorId('not-an-ip', BROWSER, new Date())).toBeNull();
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
      visitorId: visitorId(IP, BROWSER, now),
    });
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
    expect(await service.sweep(now)).toEqual({ deleted: 4 });
    expect(w.tx.$queryRaw).toHaveBeenCalled();
    expect(w.client.analyticsEvent.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2025-09-02T03:29:00Z') } },
    });
  });

  it('does nothing when another replica holds the lock', async () => {
    const w = world();
    w.tx.$queryRaw.mockResolvedValue([{ locked: false }]);
    const service = new AnalyticsPruneService(w.prisma);
    expect(await service.sweep()).toEqual({ deleted: 0 });
    expect(w.client.analyticsEvent.deleteMany).not.toHaveBeenCalled();
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
