import { type DynamicModule, Global, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { CORE_CONFIG, type CoreConfig } from './config/core-config'
import { DatabaseLifecycle, databaseProvider } from './database/database.provider'
import { TenantDb } from './database/tenant-db'
import { AllExceptionsFilter } from './http/exception.filter'
import { LoggingModule } from './logging/logging.module'
import { QueueRegistry } from './queue/queue-registry'
import { REDIS, RedisLifecycle, redisProvider } from './redis/redis.provider'
import { RateLimitService } from './security/rate-limit.service'
import { MetricsService } from './metrics/metrics.service'
import { RealtimeEmitter } from './realtime/realtime-emitter'
import { StorageService } from './storage/storage.service'
import { Database } from '@fenwira/database'

/** Process-wide infrastructure shared by api and worker: config, logging, db, redis, queues. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(config: CoreConfig): DynamicModule {
    return {
      module: CoreModule,
      imports: [LoggingModule.forRoot(config)],
      providers: [
        { provide: CORE_CONFIG, useValue: config },
        databaseProvider,
        DatabaseLifecycle,
        redisProvider,
        RedisLifecycle,
        QueueRegistry,
        RateLimitService,
        TenantDb,
        RealtimeEmitter,
        MetricsService,
        ...(config.storage ? [StorageService] : []),
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
      exports: [
        CORE_CONFIG,
        Database,
        REDIS,
        QueueRegistry,
        RateLimitService,
        TenantDb,
        RealtimeEmitter,
        MetricsService,
        ...(config.storage ? [StorageService] : []),
        LoggingModule,
      ],
    }
  }
}
