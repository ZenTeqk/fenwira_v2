import { type DynamicModule, Module } from '@nestjs/common'
import { ComposeLockService } from './compose-lock.service'
import { ConversationsController, InboxController } from './inbox.controller'
import { InboxEventsProcessor } from './inbox-events.processor'
import { InboxGateway } from './inbox.gateway'
import { InboxService } from './inbox.service'
import { PresenceService } from './presence.service'

@Module({})
export class InboxModule {
  /** API side. `imports` must provide MessagingService. */
  static forApi(imports: DynamicModule[]): DynamicModule {
    return {
      module: InboxModule,
      imports,
      controllers: [ConversationsController, InboxController],
      providers: [InboxService, ComposeLockService, PresenceService, InboxGateway],
    }
  }

  /** Worker side: auto-assignment and inbox maintenance. */
  static forWorker(): DynamicModule {
    return {
      module: InboxModule,
      providers: [PresenceService, InboxEventsProcessor],
      exports: [InboxEventsProcessor],
    }
  }
}
