import { type DynamicModule, Module } from '@nestjs/common'
import { BillingController } from './billing.controller'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import { BillingService } from './billing.service'
import { BillingUsageProcessor } from './billing-usage.processor'

@Module({})
export class BillingModule {
  static forApi(options: BillingOptions): DynamicModule {
    return {
      module: BillingModule,
      controllers: [BillingController],
      providers: [{ provide: BILLING_OPTIONS, useValue: options }, BillingService],
    }
  }

  static forWorker(options: BillingOptions): DynamicModule {
    return {
      module: BillingModule,
      providers: [{ provide: BILLING_OPTIONS, useValue: options }, BillingUsageProcessor],
      exports: [BillingUsageProcessor],
    }
  }
}
