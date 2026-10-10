import { type DynamicModule, Module } from '@nestjs/common'
import { AuditModule } from '../audit'
import { type EntitlementSource, EntitlementsModule } from '../entitlements'
import { PresenceService } from '../inbox'
import { AutomationExecuteProcessor } from './automation-execute.processor'
import { AutomationTriggerProcessor } from './automation-trigger.processor'
import { AUTOMATION_OPTIONS, type AutomationOptions } from './automation.options'
import {
  AutomationWebhookController,
  ExecutionsController,
  FlowsController,
} from './flows.controller'
import { FlowsService } from './flows.service'

@Module({})
export class AutomationModule {
  static forApi(options: AutomationOptions, entitlements?: EntitlementSource): DynamicModule {
    return {
      module: AutomationModule,
      imports: [AuditModule, EntitlementsModule.forRoot(entitlements)],
      controllers: [FlowsController, ExecutionsController, AutomationWebhookController],
      providers: [{ provide: AUTOMATION_OPTIONS, useValue: options }, FlowsService],
    }
  }

  /** Worker side. `imports` must provide MessagingService (the only send path). */
  static forWorker(
    options: AutomationOptions,
    imports: DynamicModule[],
    entitlements?: EntitlementSource,
  ): DynamicModule {
    return {
      module: AutomationModule,
      imports: [AuditModule, EntitlementsModule.forRoot(entitlements), ...imports],
      providers: [
        { provide: AUTOMATION_OPTIONS, useValue: options },
        PresenceService,
        AutomationTriggerProcessor,
        AutomationExecuteProcessor,
      ],
      exports: [AutomationTriggerProcessor, AutomationExecuteProcessor],
    }
  }
}
