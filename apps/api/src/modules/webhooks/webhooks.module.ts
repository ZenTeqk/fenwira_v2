import { type KeyRing } from '@fenwira/config'
import { type DynamicModule, Module } from '@nestjs/common'
import { AuditModule } from '../audit'
import { EntitlementsModule } from '../entitlements'
import { WebhookEventsProcessor } from './webhook-events.processor'
import { WebhooksController } from './webhooks.controller'
import { WEBHOOKS_OPTIONS, type WebhooksOptions } from './webhooks.options'
import { WebhooksService } from './webhooks.service'
import { WebhooksMaintenanceProcessor } from './webhooks-maintenance.processor'

/** Outbound webhooks (Phase 11 Step 3, docs/WEBHOOKS.md). */
@Module({})
export class WebhooksModule {
  static forApi(options: { keyRing: KeyRing; devHosts?: readonly string[] }): DynamicModule {
    const full: WebhooksOptions = {
      ...options,
      backoffMs: 30_000,
      maxRetryHours: 24,
      disableAfterFailures: 20,
    }
    return {
      module: WebhooksModule,
      imports: [AuditModule, EntitlementsModule.forRoot()],
      controllers: [WebhooksController],
      providers: [{ provide: WEBHOOKS_OPTIONS, useValue: full }, WebhooksService],
    }
  }

  static forWorker(options: WebhooksOptions): DynamicModule {
    return {
      module: WebhooksModule,
      providers: [
        { provide: WEBHOOKS_OPTIONS, useValue: options },
        WebhookEventsProcessor,
        WebhooksMaintenanceProcessor,
      ],
      exports: [WebhookEventsProcessor, WebhooksMaintenanceProcessor],
    }
  }
}
