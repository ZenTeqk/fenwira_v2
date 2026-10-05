import { type DynamicModule, Module } from '@nestjs/common'
import { BILLING_OPTIONS, type BillingOptions } from '../billing'
import { CommercialOperationController } from './commercial-operation.controller'
import { CommercialOperationService } from './commercial-operation.service'
import { EntitlementsModule } from '../entitlements'
import { CommercialReadController } from './commercial-read.controller'
import { CommercialReadService } from './commercial-read.service'
import { PlatformAuthController } from './platform-auth.controller'
import { PlatformAuthService } from './platform-auth.service'
import { PlatformGuard } from './platform.guard'
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
      ],
      providers: [
        PlatformAuthService,
        PlatformGuard,
        CommercialReadService,
        CommercialOperationService,
        { provide: BILLING_OPTIONS, useValue: billing },
      ],
      exports: [PlatformGuard, PlatformAuthService],
    }
  }
}
