import {
  type CoreConfig,
  CoreModule,
  HealthModule,
  MetricsController,
  PostgresHealthIndicator,
  RedisHealthIndicator,
  storageConfigFromEnv,
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
import { MESSAGING_PROCESSORS, MessagingModule } from '@fenwira/api/modules/messaging'
import {
  WhatsAppAccountsModule,
  WhatsAppSyncProcessor,
} from '@fenwira/api/modules/whatsapp-accounts'
import { parseKeyRing, type WorkerEnv } from '@fenwira/config'
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
    storage: storageConfigFromEnv(env),
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
    const keyRing = parseKeyRing(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY_ID)
    const messaging = MessagingModule.forWorker(
      {
        keyRing,
        graphBaseUrl: env.META_GRAPH_BASE_URL,
        graphVersion: env.META_GRAPH_API_VERSION,
        outboundBackoffBaseMs: env.WHATSAPP_OUTBOUND_BACKOFF_MS,
      },
      [platform],
    )
    const whatsapp = WhatsAppAccountsModule.forWorker({
      keyRing,
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      graphVersion: env.META_GRAPH_API_VERSION,
      graphBaseUrl: env.META_GRAPH_BASE_URL,
      devConnect: false,
      syncIntervalHours: env.WHATSAPP_SYNC_INTERVAL_HOURS,
    })
    const runtime = WorkerRuntimeModule.forRoot({
      imports: [platform, identity, tenancy, whatsapp, messaging],
      processors: [
        ...PLATFORM_PROCESSORS,
        IdentityProcessor,
        TenancyProcessor,
        WhatsAppSyncProcessor,
        ...MESSAGING_PROCESSORS,
      ],
    })

    return {
      module: WorkerModule,
      controllers: [MetricsController],
      imports: [
        CoreModule.forRoot(coreConfigFromWorkerEnv(env)),
        EmailModule.forRoot({ smtpUrl: env.SMTP_URL, from: env.MAIL_FROM }),
        platform,
        identity,
        tenancy,
        whatsapp,
        messaging,
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
