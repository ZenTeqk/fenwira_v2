import { type DynamicModule, Module } from '@nestjs/common'
import { AuditModule } from '../audit'
import { EntitlementsModule } from '../entitlements'
import { BillingController, WorkspaceStatusController } from './billing.controller'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import { BillingService } from './billing.service'
import { SubscriptionsService } from './subscriptions.service'
import { BillingMaintenanceProcessor } from './billing-maintenance.processor'
import { BillingUsageProcessor } from './billing-usage.processor'

@Module({})
export class BillingModule {
  static forApi(options: BillingOptions): DynamicModule {
    return {
      module: BillingModule,
      imports: [AuditModule, EntitlementsModule.forRoot()],
      controllers: [BillingController, WorkspaceStatusController],
      providers: [
        { provide: BILLING_OPTIONS, useValue: options },
        BillingService,
        SubscriptionsService,
      ],
    }
  }

  static forWorker(options: BillingOptions): DynamicModule {
    return {
      module: BillingModule,
      providers: [
        { provide: BILLING_OPTIONS, useValue: options },
        BillingUsageProcessor,
        BillingMaintenanceProcessor,
      ],
      exports: [BillingUsageProcessor, BillingMaintenanceProcessor],
    }
  }
}
