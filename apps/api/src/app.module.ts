import { parseKeyRing, type ApiEnv } from '@fenwira/config'
import { type DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { type CoreConfig } from './core/config/core-config'
import { storageConfigFromEnv } from './core/storage/storage.service'
import { CoreModule } from './core/core.module'
import { HealthModule } from './core/health/health.module'
import {
  PostgresHealthIndicator,
  QueueHealthIndicator,
  RedisHealthIndicator,
} from './core/health/indicators'
import { CsrfGuard } from './core/security/csrf.guard'
import { AuditApiModule, AuditModule } from './modules/audit'
import { AuthGuard, IdentityModule } from './modules/identity'
import { PlatformApiModule } from './modules/platform/platform-api.module'
import { RealtimeModule } from './modules/realtime'
import { PermissionGuard, TenancyModule, TenantGuard } from './modules/tenancy'
import { ContactsModule } from './modules/contacts'
import { InboxModule } from './modules/inbox'
import { MessagingModule } from './modules/messaging'
import { TemplatesModule } from './modules/templates'
import { AnalyticsModule } from './modules/analytics'
import { BillingModule, billingPlatformFromEnv, billingSupportFromEnv } from './modules/billing'
import { CampaignsModule } from './modules/campaigns'
import { AutomationModule } from './modules/automation'
import { WhatsAppAccountsModule } from './modules/whatsapp-accounts'
import { ApiKeyGuard, ApiKeysModule } from './modules/api-keys'
import { WebhooksModule } from './modules/webhooks'

export function coreConfigFromApiEnv(
  env: ApiEnv,
  extra: Pick<CoreConfig, 'logDestination'> = {},
): CoreConfig {
  return {
    ...extra,
    service: 'api',
    version: env.APP_VERSION,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    dbPoolSize: env.DB_POOL_SIZE,
    redisUrl: env.REDIS_URL,
    webOrigin: env.WEB_ORIGIN,
    storage: storageConfigFromEnv(env),
    metricsPort: env.METRICS_PORT,
    entitlements: {
      enforced: env.BILLING_SUBSCRIPTIONS_ENFORCED,
      trialDays: env.BILLING_TRIAL_DAYS,
      trialPlanKey: env.BILLING_TRIAL_PLAN,
    },
  }
}

@Module({})
export class ApiModule {
  static forRoot(env: ApiEnv, extra: Pick<CoreConfig, 'logDestination'> = {}): DynamicModule {
    const keyRing = parseKeyRing(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY_ID)
    const identity = IdentityModule.forApi({
      jwtPrivateKey: env.JWT_PRIVATE_KEY,
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      cookies: { secure: env.COOKIE_SECURE, domain: env.COOKIE_DOMAIN },
      keyRing,
      webOrigin: env.WEB_ORIGIN,
    })
    const tenancy = TenancyModule.forApi(identity)
    const messaging = MessagingModule.forApi({
      keyRing,
      graphBaseUrl: env.META_GRAPH_BASE_URL,
      graphVersion: env.META_GRAPH_API_VERSION,
      appSecret: env.META_APP_SECRET,
      verifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
      billing: billingPlatformFromEnv(env),
    })
    return {
      module: ApiModule,
      imports: [
        CoreModule.forRoot(coreConfigFromApiEnv(env, extra)),
        AuditModule,
        identity,
        tenancy,
        AuditApiModule,
        ContactsModule.forApi(),
        messaging,
        InboxModule.forApi([messaging]),
        AnalyticsModule.forApi(),
        ApiKeysModule.forApi({
          pepper: env.API_KEY_PEPPER,
          rateLimitPerMinute: env.API_KEY_RATE_LIMIT_PER_MINUTE,
        }),
        WebhooksModule.forApi({ keyRing, devHosts: env.AUTOMATION_WEBHOOK_DEV_HOSTS }),
        BillingModule.forApi({
          ...billingPlatformFromEnv(env),
          support: billingSupportFromEnv(env),
        }),
        CampaignsModule.forApi({
          billing: billingPlatformFromEnv(env),
        }),
        AutomationModule.forApi({ keyRing, publicApiUrl: env.PUBLIC_API_URL }),
        TemplatesModule.forApi({
          keyRing,
          appId: env.META_APP_ID,
          graphVersion: env.META_GRAPH_API_VERSION,
          graphBaseUrl: env.META_GRAPH_BASE_URL,
        }),
        WhatsAppAccountsModule.forApi({
          keyRing,
          appId: env.META_APP_ID,
          appSecret: env.META_APP_SECRET,
          configId: env.META_ES_CONFIG_ID,
          graphVersion: env.META_GRAPH_API_VERSION,
          graphBaseUrl: env.META_GRAPH_BASE_URL,
          devConnect: env.WHATSAPP_DEV_CONNECT,
        }),
        RealtimeModule.forApi([identity, tenancy]),
        HealthModule.forRoot({
          indicators: [PostgresHealthIndicator, RedisHealthIndicator, QueueHealthIndicator],
        }),
        PlatformApiModule.forRoot({ systemPingEnabled: env.SYSTEM_PING_ENABLED }),
      ],
      // Order matters: API key → authenticate (session) → CSRF → resolve tenant → check permission
      // (default deny). ApiKeyGuard fully authenticates and short-circuits the rest for a Bearer
      // fw_ request; every other guard then sees requestContext.apiKey and passes through.
      providers: [
        { provide: APP_GUARD, useExisting: ApiKeyGuard },
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useExisting: TenantGuard },
        { provide: APP_GUARD, useExisting: PermissionGuard },
      ],
    }
  }
}
