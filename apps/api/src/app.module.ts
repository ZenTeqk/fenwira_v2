import { type ApiEnv } from '@fenwira/config'
import { type DynamicModule, Module } from '@nestjs/common'
import { type CoreConfig } from './core/config/core-config'
import { CoreModule } from './core/core.module'
import { HealthModule } from './core/health/health.module'
import {
  PostgresHealthIndicator,
  QueueHealthIndicator,
  RedisHealthIndicator,
} from './core/health/indicators'
import { PlatformApiModule } from './modules/platform/platform-api.module'

export function coreConfigFromApiEnv(env: ApiEnv): CoreConfig {
  return {
    service: 'api',
    version: env.APP_VERSION,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    dbPoolSize: env.DB_POOL_SIZE,
    redisUrl: env.REDIS_URL,
  }
}

@Module({})
export class ApiModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: ApiModule,
      imports: [
        CoreModule.forRoot(coreConfigFromApiEnv(env)),
        HealthModule.forRoot({
          indicators: [PostgresHealthIndicator, RedisHealthIndicator, QueueHealthIndicator],
        }),
        PlatformApiModule.forRoot({ systemPingEnabled: env.SYSTEM_PING_ENABLED }),
      ],
    }
  }
}
