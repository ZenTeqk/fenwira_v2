import { createRedisConnection } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationShutdown, type Provider } from '@nestjs/common'
import type IORedis from 'ioredis'
import { CORE_CONFIG, type CoreConfig } from '../config/core-config'

/** Command connection (fail-fast, no offline queue) for app reads/writes and health checks. */
export const REDIS = Symbol('REDIS')

export const redisProvider: Provider = {
  provide: REDIS,
  useFactory: (config: CoreConfig) => createRedisConnection(config.redisUrl, 'command'),
  inject: [CORE_CONFIG],
}

@Injectable()
export class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: IORedis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect())
  }
}
