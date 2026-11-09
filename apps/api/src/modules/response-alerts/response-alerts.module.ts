import { type DynamicModule, Module } from '@nestjs/common'
import { ResponseAlertsController } from './response-alerts.controller'
import { ResponseAlertsProcessor } from './response-alerts.processor'
import { ResponseAlertsService } from './response-alerts.service'

/** Missed-enquiry (response) alerts: waiting-for-staff episodes (docs/RESPONSE_ALERTS.md). */
@Module({})
export class ResponseAlertsModule {
  static forApi(): DynamicModule {
    return {
      module: ResponseAlertsModule,
      controllers: [ResponseAlertsController],
      providers: [ResponseAlertsService],
    }
  }

  static forWorker(): DynamicModule {
    return {
      module: ResponseAlertsModule,
      providers: [ResponseAlertsProcessor],
      exports: [ResponseAlertsProcessor],
    }
  }
}
