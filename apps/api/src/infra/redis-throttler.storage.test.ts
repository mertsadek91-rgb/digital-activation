import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  RedisThrottlerStorage,
  THROTTLE_SCRIPT,
  type ThrottleRedis,
} from './redis-throttler.storage.js';

/**
 * A Redis that runs THROTTLE_SCRIPT's logic against a map and a fake clock.
 *
 * There is no Lua engine to hand, so the script's steps are mirrored here one
 * for one. What this proves is the storage's half of the contract — the keys
 * it names, the arguments it sends, the units it converts, and above all that
 * it falls back instead of failing when Redis does.
 */
class FakeRedis implements ThrottleRedis {
  status = 'ready';
  now = 0;
  calls: unknown[][] = [];
  failWith: Error | null = null;
  private readonly store = new Map<string, { value: number; expiresAt: number | null }>();

  private live(key: string) {
    const entry = this.store.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  private pttl(key: string): number {
    const entry = this.live(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? -1 : entry.expiresAt - this.now;
  }

  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown> {
    this.calls.push([numberOfKeys, ...args]);
    if (this.failWith) return Promise.reject(this.failWith);
    expect(script).toBe(THROTTLE_SCRIPT);

    const [hitsKey, blockKey, ttl, limit, block] = args as [string, string, number, number, number];

    const blockLeft = this.pttl(blockKey);
    if (blockLeft > 0) return Promise.resolve([limit + 1, blockLeft, 1, blockLeft]);

    const entry = this.live(hitsKey) ?? { value: 0, expiresAt: null };
    entry.value += 1;
    this.store.set(hitsKey, entry);
    let left = this.pttl(hitsKey);
    if (left < 0) {
      entry.expiresAt = this.now + ttl;
      left = ttl;
    }

    if (entry.value > limit) {
      this.store.set(blockKey, { value: 1, expiresAt: this.now + block });
      this.store.delete(hitsKey);
      return Promise.resolve([entry.value, left, 1, block]);
    }
    return Promise.resolve([entry.value, left, 0, 0]);
  }
}

function setup() {
  const redis = new FakeRedis();
  const logger = { warn: vi.fn() };
  const storage = new RedisThrottlerStorage(redis, logger, () => redis.now);
  return { redis, logger, storage };
}

describe('RedisThrottlerStorage', () => {
  const stores: RedisThrottlerStorage[] = [];
  afterEach(() => {
    // The in-memory fallback leaves a timer per hit.
    stores.splice(0).forEach((store) => store.onApplicationShutdown());
  });

  it('counts hits in Redis and reports the window in seconds', async () => {
    const { redis, storage } = setup();

    const first = await storage.increment('k', 60_000, 3, 60_000, 'default');
    redis.now = 15_000;
    const second = await storage.increment('k', 60_000, 3, 60_000, 'default');

    expect(first).toEqual({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(second).toEqual({
      totalHits: 2,
      timeToExpire: 45,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    // Both keys share one hash tag, and the throttler's name is in it.
    expect(redis.calls[0]).toEqual([
      2,
      'da:throttle:{default:k}:hits',
      'da:throttle:{default:k}:block',
      60_000,
      3,
      60_000,
    ]);
  });

  it('blocks past the limit and starts a fresh window once the block lifts', async () => {
    const { redis, storage } = setup();

    for (let i = 0; i < 2; i += 1) await storage.increment('k', 60_000, 2, 30_000, 'default');
    const over = await storage.increment('k', 60_000, 2, 30_000, 'default');
    expect(over.isBlocked).toBe(true);
    expect(over.timeToBlockExpire).toBe(30);

    redis.now = 10_000;
    const still = await storage.increment('k', 60_000, 2, 30_000, 'default');
    expect(still).toMatchObject({ isBlocked: true, timeToBlockExpire: 20 });

    redis.now = 30_001;
    const after = await storage.increment('k', 60_000, 2, 30_000, 'default');
    expect(after).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps separate counts for separate keys', async () => {
    const { storage } = setup();
    await storage.increment('a', 60_000, 5, 60_000, 'default');
    const b = await storage.increment('b', 60_000, 5, 60_000, 'default');
    expect(b.totalHits).toBe(1);
  });

  it('never sends a zero block duration, which Redis rejects', async () => {
    const { redis, storage } = setup();
    await storage.increment('k', 60_000, 5, 0, 'default');
    expect(redis.calls[0]?.at(-1)).toBe(60_000);
  });

  it('falls back to memory while Redis is not connected, and still limits', async () => {
    const { redis, logger, storage } = setup();
    stores.push(storage);
    redis.status = 'reconnecting';

    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await storage.increment('k', 60_000, 2, 60_000, 'default'));
    }

    expect(redis.calls).toHaveLength(0);
    expect(results.map((r) => r.isBlocked)).toEqual([false, false, true]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('falls back to memory when a command fails, instead of failing the request', async () => {
    const { redis, storage } = setup();
    stores.push(storage);
    redis.failWith = new Error('Command timed out');

    const record = await storage.increment('k', 60_000, 2, 60_000, 'default');
    expect(record).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('treats a malformed reply as a failure', async () => {
    const redis = { status: 'ready', eval: () => Promise.resolve('OK') };
    const storage = new RedisThrottlerStorage(redis, { warn: vi.fn() });
    stores.push(storage);
    await expect(storage.increment('k', 60_000, 2, 60_000, 'default')).resolves.toMatchObject({
      totalHits: 1,
    });
  });

  it('warns at most once a minute while degraded', async () => {
    const { redis, logger, storage } = setup();
    stores.push(storage);
    redis.status = 'end';

    await storage.increment('k', 60_000, 100, 60_000, 'default');
    redis.now = 59_000;
    await storage.increment('k', 60_000, 100, 60_000, 'default');
    expect(logger.warn).toHaveBeenCalledTimes(1);

    redis.now = 60_000;
    await storage.increment('k', 60_000, 100, 60_000, 'default');
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('works with no Redis client at all', async () => {
    const storage = new RedisThrottlerStorage(null, { warn: vi.fn() });
    stores.push(storage);
    await expect(storage.increment('k', 60_000, 1, 60_000, 'default')).resolves.toMatchObject({
      totalHits: 1,
    });
  });
});
