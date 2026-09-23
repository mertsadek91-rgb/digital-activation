import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import { onceEvery } from './once-every.js';

/**
 * The API's one Redis connection, shared by the rate limiter and the health
 * probe.
 *
 * Redis is an accelerator here, not a dependency: nothing the API answers is
 * stored in it, so the process boots and serves without it. Everything that
 * uses this client asks `ready` first and has a way to carry on when the
 * answer is no — which is why the options below fail fast rather than wait.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger('Redis');
  private readonly warnGate = onceEvery(60_000);
  readonly client: Redis;

  constructor() {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      // A command sent while disconnected errors at once instead of queueing
      // until the connection returns. A queued rate-limit check is a request
      // held open for as long as Redis is down; an error is a fallback now.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      // A Redis that accepts the connection and then stalls must not stall
      // every throttled request with it.
      commandTimeout: 500,
      // Keep trying, but back off: the connection coming back is how the
      // shared counters come back, and nobody restarts the API to get it.
      retryStrategy: (times) => Math.min(times * 1_000, 30_000),
    });

    // Without a listener ioredis reports every failed reconnect as an
    // unhandled 'error' event, once a second, forever.
    this.client.on('error', (error: Error & { code?: string }) => {
      if (this.warnGate()) {
        // A refused connection to a dual-stack host is an AggregateError with
        // an empty message; its code is the part that says what happened.
        const reason = error.message || error.code || error.name;
        this.logger.warn(
          `Redis unavailable (${reason}); rate limits fall back to this process's memory`,
        );
      }
    });
    this.client.on('ready', () => this.logger.log('Redis connected'));
  }

  get ready(): boolean {
    return this.client.status === 'ready';
  }

  /** A round trip, bounded — for the readiness probe. */
  async ping(timeoutMs = 500): Promise<boolean> {
    if (!this.ready) return false;
    let timer: NodeJS.Timeout | undefined;
    try {
      const answer = await Promise.race([
        this.client.ping(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
      return answer === 'PONG';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    // `quit` lets in-flight commands finish; when the connection is already
    // gone it would wait on nothing, so that case just drops the socket.
    if (this.ready) {
      await this.client.quit().catch(() => this.client.disconnect());
    } else {
      this.client.disconnect();
    }
  }
}
