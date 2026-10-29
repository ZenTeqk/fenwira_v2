import { type DynamicModule, Module } from '@nestjs/common'
import { AuditModule } from '../audit'
import { type EntitlementSource, EntitlementsModule } from '../entitlements'
import { PresenceService } from '../inbox'
import { AiAssistantFlowController, AiAssistantFlowService } from './ai-assistant-flow'
import { AutomationExecuteProcessor } from './automation-execute.processor'
import { AutomationTriggerProcessor } from './automation-trigger.processor'
import { AUTOMATION_OPTIONS, type AutomationOptions } from './automation.options'
import {
  AutomationWebhookController,
  ExecutionsController,
  FlowsController,
} from './flows.controller'
import { ReplyStudioController } from './reply-studio.controller'
import { FlowTestService } from './flow-test.service'
import { FlowsService } from './flows.service'

@Module({})
export class AutomationModule {
  static forApi(options: AutomationOptions, entitlements?: EntitlementSource): DynamicModule {
    return {
      module: AutomationModule,
      imports: [AuditModule, EntitlementsModule.forRoot(entitlements)],
      controllers: [
        FlowsController,
        ReplyStudioController,
        ExecutionsController,
        AutomationWebhookController,
        AiAssistantFlowController,
      ],
      providers: [
        { provide: AUTOMATION_OPTIONS, useValue: options },
        FlowsService,
        FlowTestService,
        AiAssistantFlowService,
      ],
    }
  }

  /**
   * Worker side. `imports` must provide MessagingService (the only send path) and AiModule's
   * AiAnswerService (the AI reply step).
   */
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
