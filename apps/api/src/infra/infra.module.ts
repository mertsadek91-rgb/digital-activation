import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import { ERROR_REPORTER, type ErrorReporter, createErrorReporter } from './error-reporter.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import { RedisService } from './redis.service.js';

/**
 * Process-level plumbing: the Redis connection, the shared rate-limit store
 * and the error reporter. Global, because the throttler, the health probe and
 * the exception filter all need a piece of it and none of them is a feature.
 */
@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: RedisThrottlerStorage,
      useFactory: (redis: RedisService) => new RedisThrottlerStorage(redis.client),
      inject: [RedisService],
    },
    {
      provide: ERROR_REPORTER,
      useFactory: () => createErrorReporter(process.env.SENTRY_DSN),
    },
  ],
  exports: [RedisService, RedisThrottlerStorage, ERROR_REPORTER],
})
export class InfraModule implements OnApplicationShutdown {
  constructor(@Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter) {}

  async onApplicationShutdown(): Promise<void> {
    await this.reporter.flush(2_000).catch(() => undefined);
  }
}
