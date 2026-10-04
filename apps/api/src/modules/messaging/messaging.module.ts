import { EntitlementsModule } from '../entitlements'
import { type DynamicModule, Module } from '@nestjs/common'
import { MessageEligibilityService } from './eligibility'
import { FilesController } from './messaging.controller'
import { FilesService } from './files.service'
import { InboundProcessor } from './inbound.processor'
import { MediaProcessor } from './media.processor'
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options'
import { MessagingService } from './messaging.service'
import { OutboundProcessor } from './outbound.processor'
import { StatusProcessor } from './status.processor'
import { WebhookIngestService } from './webhook-ingest.service'
import { WhatsAppWebhookController } from './webhooks.controller'

export const MESSAGING_PROCESSORS = [
  InboundProcessor,
  StatusProcessor,
  OutboundProcessor,
  MediaProcessor,
]

@Module({})
export class MessagingModule {
  /** API side: webhooks, conversations, files. MessagingService is exported for other modules. */
  static forApi(options: MessagingOptions): DynamicModule {
    return {
      module: MessagingModule,
      imports: [EntitlementsModule.forRoot()],
      controllers: [WhatsAppWebhookController, FilesController],
      providers: [
        { provide: MESSAGING_OPTIONS, useValue: options },
        MessagingService,
        MessageEligibilityService,
        FilesService,
        WebhookIngestService,
      ],
      exports: [MessagingService],
    }
  }

  /** Worker side: needs the platform worker module (OutboxRelayService) in `imports`. */
  static forWorker(options: MessagingOptions, imports: DynamicModule[]): DynamicModule {
    return {
      module: MessagingModule,
      imports: [EntitlementsModule.forRoot(), ...imports],
      providers: [
        { provide: MESSAGING_OPTIONS, useValue: options },
        MessagingService,
        MessageEligibilityService,
        ...MESSAGING_PROCESSORS,
      ],
      exports: [MessagingService, ...MESSAGING_PROCESSORS],
    }
  }
}
