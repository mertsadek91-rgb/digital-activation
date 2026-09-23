import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { type ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';

import { onceEvery } from './once-every.js';

/** Not exported by the package's index, so named from the interface. */
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** The slice of an ioredis client this store uses, so a test can stand in for it. */
export interface ThrottleRedis {
  readonly status: string;
  eval(
    script: string,
    numberOfKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

/**
 * Count, expire and block in one round trip.
 *
 * One script rather than INCR then PEXPIRE from the client: two replicas
 * counting the same visitor would otherwise interleave, and a process dying
 * between the two commands leaves a counter with no expiry — a visitor
 * blocked until somebody deletes the key by hand.
 *
 * Semantics follow the in-memory store it replaces: a fixed window of `ttl`
 * starting at the first hit; past `limit` the caller is blocked for
 * `blockDuration` and the window restarts once the block lifts.
 *
 * Returns [hits, window ms left, blocked (0|1), block ms left].
 */
export const THROTTLE_SCRIPT = `
local hitsKey, blockKey = KEYS[1], KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])

local blockLeft = redis.call('PTTL', blockKey)
if blockLeft > 0 then
  return { limit + 1, blockLeft, 1, blockLeft }
end

local hits = redis.call('INCR', hitsKey)
local left = redis.call('PTTL', hitsKey)
if left < 0 then
  redis.call('PEXPIRE', hitsKey, ttl)
  left = ttl
end

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', block)
  redis.call('DEL', hitsKey)
  return { hits, left, 1, block }
end
return { hits, left, 0, 0 }
`;

/**
 * Rate-limit counters shared by every API replica.
 *
 * With the default in-memory store each replica counts on its own, so three
 * replicas behind the proxy turn "ten login attempts a minute" into thirty.
 *
 * Fails open to that in-memory store — never closed — when Redis is not
 * connected or a command errors. The limits protect login, coupons and key
 * reveals from brute force; refusing every one of those requests because the
 * counter is unreachable would turn a Redis outage into a checkout outage. The
 * per-process limits still hold during the fallback, only not summed.
 */
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly memory = new ThrottlerStorageService();
  private readonly warnGate: () => boolean;

  constructor(
    private readonly redis: ThrottleRedis | null,
    private readonly logger: Pick<Logger, 'warn'> = new Logger('Throttler'),
    now: () => number = Date.now,
  ) {
    this.warnGate = onceEvery(60_000, now);
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    if (!this.redis || this.redis.status !== 'ready') {
      this.degraded('Redis is not connected');
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    // The braces are a Redis Cluster hash tag: both keys land on one slot, so
    // the script stays legal if this ever runs against a cluster.
    const base = `da:throttle:{${throttlerName}:${key}}`;
    // PX 0 is an error in Redis, and a zero block means "block for the window".
    const block = blockDuration > 0 ? blockDuration : ttl;

    try {
      const reply = await this.redis.eval(
        THROTTLE_SCRIPT,
        2,
        `${base}:hits`,
        `${base}:block`,
        ttl,
        limit,
        block,
      );
      return toRecord(reply, ttl);
    } catch (error) {
      this.degraded(error instanceof Error ? error.message : String(error));
      return this.memory.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }

  onApplicationShutdown(): void {
    // The in-memory store holds a timer per hit; left running they keep a
    // stopping process alive for up to a minute.
    this.memory.onApplicationShutdown();
  }

  private degraded(reason: string): void {
    if (this.warnGate()) {
      this.logger.warn(`Rate limits are per process for now: ${reason}`);
    }
  }
}

function toRecord(reply: unknown, ttl: number): ThrottlerStorageRecord {
  if (!Array.isArray(reply) || reply.length !== 4) {
    throw new Error('Unexpected reply from the throttle script');
  }
  const [hits, windowLeft, blocked, blockLeft] = reply.map(Number) as [
    number,
    number,
    number,
    number,
  ];
  // The guard reports these in seconds (Retry-After, X-RateLimit-Reset), as
  // the in-memory store does.
  return {
    totalHits: hits,
    timeToExpire: Math.ceil((windowLeft > 0 ? windowLeft : ttl) / 1000),
    isBlocked: blocked === 1,
    timeToBlockExpire: Math.ceil(Math.max(blockLeft, 0) / 1000),
  };
}
