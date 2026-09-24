import { parseKeyRing, type ApiEnv } from '@fenwira/config'
import { type DynamicModule, Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { type CoreConfig } from './core/config/core-config'
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

export function coreConfigFromApiEnv(env: ApiEnv): CoreConfig {
  return {
    service: 'api',
    version: env.APP_VERSION,
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    dbPoolSize: env.DB_POOL_SIZE,
    redisUrl: env.REDIS_URL,
    webOrigin: env.WEB_ORIGIN,
  }
}

@Module({})
export class ApiModule {
  static forRoot(env: ApiEnv): DynamicModule {
    const identity = IdentityModule.forApi({
      jwtPrivateKey: env.JWT_PRIVATE_KEY,
      jwtPublicKey: env.JWT_PUBLIC_KEY,
      cookies: { secure: env.COOKIE_SECURE, domain: env.COOKIE_DOMAIN },
      keyRing: parseKeyRing(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY_ID),
      webOrigin: env.WEB_ORIGIN,
    })
    const tenancy = TenancyModule.forApi(identity)
    return {
      module: ApiModule,
      imports: [
        CoreModule.forRoot(coreConfigFromApiEnv(env)),
        AuditModule,
        identity,
        tenancy,
        AuditApiModule,
        RealtimeModule.forApi([identity, tenancy]),
        HealthModule.forRoot({
          indicators: [PostgresHealthIndicator, RedisHealthIndicator, QueueHealthIndicator],
        }),
        PlatformApiModule.forRoot({ systemPingEnabled: env.SYSTEM_PING_ENABLED }),
      ],
      // Order matters: authenticate → CSRF → resolve tenant → check permission (default deny).
      providers: [
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useExisting: TenantGuard },
        { provide: APP_GUARD, useExisting: PermissionGuard },
      ],
    }
  }
}
