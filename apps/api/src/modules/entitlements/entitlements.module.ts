import { type DynamicModule, Module } from '@nestjs/common'
import {
  ALLOW_ALL_ENTITLEMENTS,
  ENTITLEMENT_SOURCE,
  type EntitlementSource,
  EntitlementsService,
} from './entitlements.service'

@Module({})
export class EntitlementsModule {
  static forRoot(source: EntitlementSource = ALLOW_ALL_ENTITLEMENTS): DynamicModule {
    return {
      module: EntitlementsModule,
      providers: [{ provide: ENTITLEMENT_SOURCE, useValue: source }, EntitlementsService],
      exports: [EntitlementsService],
    }
  }
}
