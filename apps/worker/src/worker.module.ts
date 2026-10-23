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
import { CONTACTS_PROCESSORS, ContactsModule } from '@fenwira/api/modules/contacts'
import { InboxEventsProcessor, InboxModule } from '@fenwira/api/modules/inbox'
import { MESSAGING_PROCESSORS, MessagingModule } from '@fenwira/api/modules/messaging'
import { TemplatesModule, TemplatesSyncProcessor } from '@fenwira/api/modules/templates'
import {
  BillingMaintenanceProcessor,
  BillingModule,
  billingPlatformFromEnv,
  billingSupportFromEnv,
  manualBillingFromEnv,
  BillingUsageProcessor,
} from '@fenwira/api/modules/billing'
import {
  AnalyticsEventsProcessor,
  AnalyticsModule,
  AnalyticsRollupProcessor,
} from '@fenwira/api/modules/analytics'
import {
  NotificationsDispatchProcessor,
  NotificationsModule,
} from '@fenwira/api/modules/notifications'
import {
  CampaignDispatchProcessor,
  CampaignEventsProcessor,
  CampaignsModule,
} from '@fenwira/api/modules/campaigns'
import {
  AutomationExecuteProcessor,
  AutomationModule,
  AutomationTriggerProcessor,
} from '@fenwira/api/modules/automation'
import {
  WhatsAppAccountsModule,
  WhatsAppSyncProcessor,
} from '@fenwira/api/modules/whatsapp-accounts'
import {
  WebhookEventsProcessor,
  WebhooksMaintenanceProcessor,
  WebhooksModule,
} from '@fenwira/api/modules/webhooks'
import {
  NativeModule,
  NativeProcessor,
  nativeOptions,
} from '@fenwira/api/modules/native-connectors'
import { parseKeyRing, type WorkerEnv } from '@fenwira/config'
import { type DynamicModule, Module } from '@nestjs/common'
import { ProcessorsHealthIndicator } from './processors.health'

export function coreConfigFromWorkerEnv(
  env: WorkerEnv,
  extra: Pick<CoreConfig, 'logDestination'> = {},
): CoreConfig {
  return {
    ...extra,
    service: 'worker',
    version: env.APP_VERSION,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    dbPoolSize: env.DB_POOL_SIZE,
    redisUrl: env.REDIS_URL,
    storage: storageConfigFromEnv(env),
    entitlements: {
      enforced: env.BILLING_SUBSCRIPTIONS_ENFORCED,
      trialDays: env.BILLING_TRIAL_DAYS,
      trialPlanKey: env.BILLING_TRIAL_PLAN,
    },
    features: { managedLaunch: env.MANAGED_LAUNCH_MODE },
  }
}

@Module({})
export class WorkerModule {
  static forRoot(env: WorkerEnv, extra: Pick<CoreConfig, 'logDestination'> = {}): DynamicModule {
    // One instance shared by the runtime and health modules (a second forRoot would mean a second relay).
    const platform = PlatformWorkerModule.forRoot({
      databaseUrl: env.DATABASE_URL,
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      batchSize: 200,
      leaseSeconds: 30,
      maxAttempts: 20,
    })
    const keyRing = parseKeyRing(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY_ID)
    const identity = IdentityWorkerModule.forWorker({ webOrigin: env.WEB_ORIGIN, keyRing })
    const tenancy = TenancyModule.forWorker({ webOrigin: env.WEB_ORIGIN, keyRing })
    const messaging = MessagingModule.forWorker(
      {
        keyRing,
        graphBaseUrl: env.META_GRAPH_BASE_URL,
        graphVersion: env.META_GRAPH_API_VERSION,
        outboundBackoffBaseMs: env.WHATSAPP_OUTBOUND_BACKOFF_MS,
        billing: billingPlatformFromEnv(env),
      },
      [platform],
    )
    const contacts = ContactsModule.forWorker([messaging])
    const inbox = InboxModule.forWorker()
    const whatsapp = WhatsAppAccountsModule.forWorker({
      keyRing,
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      graphVersion: env.META_GRAPH_API_VERSION,
      graphBaseUrl: env.META_GRAPH_BASE_URL,
      devConnect: false,
      syncIntervalHours: env.WHATSAPP_SYNC_INTERVAL_HOURS,
    })
    const templates = TemplatesModule.forWorker({
      keyRing,
      graphVersion: env.META_GRAPH_API_VERSION,
      graphBaseUrl: env.META_GRAPH_BASE_URL,
    })
    const billingPlatform = billingPlatformFromEnv(env)
    const billing = BillingModule.forWorker({
      ...billingPlatform,
      reservationGraceMinutes: env.BILLING_RESERVATION_GRACE_MINUTES,
      webOrigin: env.WEB_ORIGIN,
      manual: manualBillingFromEnv(env),
    })
    const notifications = NotificationsModule.forWorker({
      webOrigin: env.WEB_ORIGIN,
      billing: billingPlatform,
      support: billingSupportFromEnv(env),
    })
    const analytics = AnalyticsModule.forWorker({ settleSeconds: env.ANALYTICS_SETTLE_SECONDS })
    const campaigns = CampaignsModule.forWorker(
      {
        billing: billingPlatform,
        batchSize: env.CAMPAIGN_BATCH_SIZE,
      },
      [messaging],
    )
    const automation = AutomationModule.forWorker(
      { webhookDevHosts: env.AUTOMATION_WEBHOOK_DEV_HOSTS },
      [messaging],
    )
    const webhooks = WebhooksModule.forWorker({
      keyRing,
      devHosts: env.AUTOMATION_WEBHOOK_DEV_HOSTS,
      backoffMs: env.WEBHOOK_BACKOFF_MS,
      maxRetryHours: env.WEBHOOK_MAX_RETRY_HOURS,
      disableAfterFailures: env.WEBHOOK_DISABLE_AFTER_FAILURES,
    })
    const runtime = WorkerRuntimeModule.forRoot({
      imports: [
        NativeModule.forWorker(nativeOptions(env, keyRing)),
        platform,
        identity,
        tenancy,
        whatsapp,
        messaging,
        contacts,
        inbox,
        templates,
        billing,
        notifications,
        analytics,
        campaigns,
        automation,
        webhooks,
      ],
      processors: [
        ...PLATFORM_PROCESSORS,
        IdentityProcessor,
        TenancyProcessor,
        NativeProcessor,
        WhatsAppSyncProcessor,
        ...MESSAGING_PROCESSORS,
        ...CONTACTS_PROCESSORS,
        InboxEventsProcessor,
        TemplatesSyncProcessor,
        BillingUsageProcessor,
        BillingMaintenanceProcessor,
        NotificationsDispatchProcessor,
        AnalyticsEventsProcessor,
        AnalyticsRollupProcessor,
        CampaignDispatchProcessor,
        CampaignEventsProcessor,
        AutomationTriggerProcessor,
        AutomationExecuteProcessor,
        WebhookEventsProcessor,
        WebhooksMaintenanceProcessor,
      ],
    })

    return {
      module: WorkerModule,
      controllers: [MetricsController],
      imports: [
        CoreModule.forRoot(coreConfigFromWorkerEnv(env, extra)),
        EmailModule.forRoot({
          smtpUrl: env.SMTP_URL,
          from: env.MAIL_FROM,
          replyTo: env.MAIL_REPLY_TO,
          opsAlerts: { to: env.OPS_ALERT_EMAIL, environment: env.NODE_ENV },
        }),
        platform,
        identity,
        tenancy,
        whatsapp,
        messaging,
        contacts,
        inbox,
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
