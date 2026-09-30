import { FulfillmentMode } from '@da/db';
import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthController, MONITOR_KEY_HEADER } from './health.controller.js';
import { type DeliveryRow, cronStatus, deliveryHealth, sweepHealth } from './ops-checks.js';

const NOW = new Date('2026-09-30T12:00:00Z');
const MINUTE = 60_000;
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

describe('cronStatus', () => {
  const job = { name: 'stranded-orders', active: true, periodMs: 5 * MINUTE };

  it('is fresh within two periods of its last tick', () => {
    expect(cronStatus({ ...job, lastRunAt: ago(9 * MINUTE) }, ago(60 * MINUTE), NOW).stale).toBe(
      false,
    );
  });

  it('is stale once two periods pass without a tick', () => {
    expect(cronStatus({ ...job, lastRunAt: ago(12 * MINUTE) }, ago(60 * MINUTE), NOW).stale).toBe(
      true,
    );
  });

  it('judges a job that has not fired yet from the boot, so a daily job is fine after a deploy', () => {
    const daily = { name: 'fx-refresh', active: true, periodMs: 24 * 60 * MINUTE, lastRunAt: null };
    expect(cronStatus(daily, ago(60 * MINUTE), NOW).stale).toBe(false);
    expect(cronStatus(daily, ago(49 * 60 * MINUTE), NOW).stale).toBe(true);
  });

  it('is stale when stopped, however recent', () => {
    expect(
      cronStatus({ ...job, active: false, lastRunAt: ago(MINUTE) }, ago(60 * MINUTE), NOW).stale,
    ).toBe(true);
  });
});

describe('sweepHealth', () => {
  const fresh = cronStatus(
    { name: 'stranded-orders', active: true, periodMs: 5 * MINUTE, lastRunAt: ago(MINUTE) },
    ago(60 * MINUTE),
    NOW,
  );

  it('is ok with fresh jobs and no backlog', () => {
    expect(sweepHealth([fresh], 0, 0).status).toBe('ok');
  });

  it('alerts on a stranded paid line even while the job keeps firing', () => {
    expect(sweepHealth([fresh], 1, 0).status).toBe('alert');
  });

  it('alerts on an overdue draft', () => {
    expect(sweepHealth([fresh], 0, 2).status).toBe('alert');
  });

  it('alerts when no job is registered at all', () => {
    expect(sweepHealth([], 0, 0).status).toBe('alert');
  });
});

describe('deliveryHealth', () => {
  const stocked = (paidAgoMs: number, tookSeconds: number | null): DeliveryRow => ({
    paidAt: ago(paidAgoMs),
    deliveredAt:
      tookSeconds === null ? null : new Date(ago(paidAgoMs).getTime() + tookSeconds * 1000),
    slaSeconds: 60,
    mode: FulfillmentMode.FROM_STOCK,
  });

  it('is ok when every stocked line went out within 60 s', () => {
    const health = deliveryHealth([stocked(30 * MINUTE, 4), stocked(20 * MINUTE, 12)], [], NOW);
    expect(health).toMatchObject({ status: 'ok', delivered: 2, deliveredLate: 0 });
    expect(health.stocked).toEqual({ count: 2, p50: 4, p95: 12, max: 12 });
  });

  it('alerts when a stocked line took longer than 60 s', () => {
    const health = deliveryHealth([stocked(30 * MINUTE, 4), stocked(20 * MINUTE, 61)], [], NOW);
    expect(health).toMatchObject({ status: 'alert', deliveredLate: 1 });
  });

  it('alerts on a paid line still waiting past its promise', () => {
    expect(deliveryHealth([], [stocked(2 * MINUTE, null)], NOW)).toMatchObject({
      status: 'alert',
      waitingPastPromise: 1,
    });
  });

  it('holds a supplier-ordered line to its own, longer promise', () => {
    const onDemand: DeliveryRow = {
      paidAt: ago(2 * 60 * MINUTE),
      deliveredAt: null,
      slaSeconds: 6 * 3600,
      mode: FulfillmentMode.ON_DEMAND,
    };
    expect(deliveryHealth([], [onDemand], NOW).status).toBe('ok');
  });
});

describe('HealthController probes', () => {
  const KEY = 'k'.repeat(40);
  const prisma = {
    client: {
      orderItem: { count: vi.fn(() => 0), findMany: vi.fn(() => []) },
      order: { count: vi.fn(() => 0) },
    },
  };
  const job = {
    isActive: true,
    lastDate: () => new Date(),
    nextDates: () => [{ toMillis: () => 0 }, { toMillis: () => 5 * MINUTE }],
  };
  const scheduler = { getCronJobs: () => new Map([['stranded-orders', job]]) };
  const controller = new HealthController(
    prisma as never,
    { ping: () => Promise.resolve(true) } as never,
    scheduler as never,
  );

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not exist without MONITOR_API_KEY', async () => {
    vi.stubEnv('MONITOR_API_KEY', '');
    await expect(controller.sweeps(KEY)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.delivery(KEY)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not accept INTERNAL_API_KEY in its place', async () => {
    const internal = 'i'.repeat(40);
    vi.stubEnv('INTERNAL_API_KEY', internal);
    vi.stubEnv('MONITOR_API_KEY', '');
    await expect(controller.sweeps(internal)).rejects.toBeInstanceOf(NotFoundException);
    vi.stubEnv('MONITOR_API_KEY', KEY);
    await expect(controller.sweeps(internal)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('is rate-limited and reads the monitor header', () => {
    const proto = HealthController.prototype as unknown as Record<'sweeps' | 'delivery', object>;
    for (const handler of [proto.sweeps, proto.delivery]) {
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(30);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
    }
    expect(MONITOR_KEY_HEADER).toBe('x-da-monitor');
  });

  it('refuses a caller without the key', async () => {
    vi.stubEnv('MONITOR_API_KEY', KEY);
    await expect(controller.delivery('wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.delivery(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('answers 200 when all is well and 503 when a line is stranded', async () => {
    vi.stubEnv('MONITOR_API_KEY', KEY);
    await expect(controller.sweeps(KEY)).resolves.toMatchObject({ status: 'ok' });
    prisma.client.orderItem.count.mockReturnValueOnce(3);
    await expect(controller.sweeps(KEY)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
