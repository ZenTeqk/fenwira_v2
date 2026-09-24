import {
  type CoreConfig,
  CoreModule,
  HealthModule,
  PostgresHealthIndicator,
  RedisHealthIndicator,
  WorkerRuntimeModule,
} from '@fenwira/api/core'
import { IdentityProcessor, IdentityWorkerModule } from '@fenwira/api/modules/identity'
import {
  EmailModule,
  OutboxRelayHealthIndicator,
  PLATFORM_PROCESSORS,
  PlatformWorkerModule,
} from '@fenwira/api/modules/platform'
import { TenancyModule, TenancyProcessor } from '@fenwira/api/modules/tenancy'
import { type WorkerEnv } from '@fenwira/config'
import { type DynamicModule, Module } from '@nestjs/common'
import { ProcessorsHealthIndicator } from './processors.health'

export function coreConfigFromWorkerEnv(env: WorkerEnv): CoreConfig {
  return {
    service: 'worker',
    version: env.APP_VERSION,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    dbPoolSize: env.DB_POOL_SIZE,
    redisUrl: env.REDIS_URL,
  }
}

@Module({})
export class WorkerModule {
  static forRoot(env: WorkerEnv): DynamicModule {
    // One instance shared by the runtime and health modules (a second forRoot would mean a second relay).
    const platform = PlatformWorkerModule.forRoot({
      databaseUrl: env.DATABASE_URL,
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      batchSize: 200,
      leaseSeconds: 30,
      maxAttempts: 20,
    })
    const identity = IdentityWorkerModule.forWorker({ webOrigin: env.WEB_ORIGIN })
    const tenancy = TenancyModule.forWorker({ webOrigin: env.WEB_ORIGIN })
    const runtime = WorkerRuntimeModule.forRoot({
      imports: [platform, identity, tenancy],
      processors: [...PLATFORM_PROCESSORS, IdentityProcessor, TenancyProcessor],
    })

    return {
      module: WorkerModule,
      imports: [
        CoreModule.forRoot(coreConfigFromWorkerEnv(env)),
        EmailModule.forRoot({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM }),
        platform,
        identity,
        tenancy,
        runtime,
        HealthModule.forRoot({
          imports: [platform, runtime],
          indicators: [
            PostgresHealthIndicator,
            RedisHealthIndicator,
            ProcessorsHealthIndicator,
            OutboxRelayHealthIndicator,
          ],
        }),
      ],
    }
  }
}
