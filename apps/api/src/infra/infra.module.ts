import { Global, Module } from '@nestjs/common';

import { RedisThrottlerStorage } from './redis-throttler.storage.js';
import { RedisService } from './redis.service.js';

/**
 * Process-level plumbing: the Redis connection and the shared rate-limit
 * store. Global, because the throttler needs it and it is not a feature.
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
  ],
  exports: [RedisService, RedisThrottlerStorage],
})
export class InfraModule {}
