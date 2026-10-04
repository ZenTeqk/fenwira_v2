import { type DynamicModule, Module } from '@nestjs/common'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import {
  ALLOW_ALL_ENTITLEMENTS,
  ENTITLEMENT_SOURCE,
  type EntitlementSource,
  EntitlementsService,
} from './entitlements.service'
import { SubscriptionEntitlementSource } from './subscription-entitlement.source'

@Module({})
export class EntitlementsModule {
  /**
   * Without an explicit source (the production path), entitlements come from plans and
   * subscriptions (Phase 11 Step 4), configured once via CoreConfig.entitlements. Tests pass a
   * source, or swap one in with EntitlementsService.useSource.
   */
  static forRoot(source?: EntitlementSource): DynamicModule {
    return {
      module: EntitlementsModule,
      providers: [
        source
          ? { provide: ENTITLEMENT_SOURCE, useValue: source }
          : {
              provide: ENTITLEMENT_SOURCE,
              inject: [{ token: CORE_CONFIG, optional: true }],
              useFactory: (config?: CoreConfig): EntitlementSource =>
                config?.entitlements
                  ? new SubscriptionEntitlementSource(config.entitlements)
                  : ALLOW_ALL_ENTITLEMENTS,
            },
        EntitlementsService,
      ],
      exports: [EntitlementsService],
    }
  }
}
