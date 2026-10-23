import { type DynamicModule, Module } from '@nestjs/common'
import { BILLING_OPTIONS, type BillingOptions } from '../billing'
import { CommercialOperationController } from './commercial-operation.controller'
import { CommercialOperationService } from './commercial-operation.service'
import { EntitlementsModule } from '../entitlements'
import { CommercialReadController } from './commercial-read.controller'
import { CommercialReadService } from './commercial-read.service'
import { PlatformAuthController } from './platform-auth.controller'
import { PlatformAuthService } from './platform-auth.service'
import { PlatformAccountsController } from './platform-accounts.controller'
import { PlatformAccountsService } from './platform-accounts.service'
import { PlatformBillingController } from './platform-billing.controller'
import { PlatformBillingService } from './platform-billing.service'
import { PlatformGuard } from './platform.guard'
import { PlatformPlansController } from './platform-plans.controller'
import { PlatformPlansService } from './platform-plans.service'
import { PlatformOverviewController } from './platform-overview.controller'
import { PlatformOverviewService } from './platform-overview.service'
@Module({})
export class PlatformOperationsModule {
  static forApi(identity: DynamicModule, billing: BillingOptions): DynamicModule {
    return {
      module: PlatformOperationsModule,
      imports: [identity, EntitlementsModule.forRoot()],
      controllers: [
        PlatformAuthController,
        CommercialReadController,
        CommercialOperationController,
        PlatformBillingController,
        PlatformAccountsController,
        PlatformPlansController,
        PlatformOverviewController,
      ],
      providers: [
        PlatformAuthService,
        PlatformGuard,
        CommercialReadService,
        CommercialOperationService,
        PlatformBillingService,
        PlatformAccountsService,
        PlatformPlansService,
        PlatformOverviewService,
        { provide: BILLING_OPTIONS, useValue: billing },
      ],
      exports: [PlatformGuard, PlatformAuthService],
    }
  }
}
