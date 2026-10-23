import { type DynamicModule, Module, type Provider } from '@nestjs/common'
import { GraphClient } from '@fenwira/whatsapp'
import { AuditModule } from '../audit'
import { WhatsAppConnectionService } from './connection.service'
import { WhatsAppSyncService } from './sync.service'
import { SelfServeConnectionGuard, WhatsAppConnectionsController } from './whatsapp.controller'
import { WhatsAppSyncProcessor } from './whatsapp-sync.processor'
import { WHATSAPP_OPTIONS, type WhatsAppOptions } from './whatsapp.options'

const shared = (options: WhatsAppOptions): Provider[] => [
  { provide: WHATSAPP_OPTIONS, useValue: options },
  {
    provide: GraphClient,
    useFactory: () =>
      new GraphClient({ baseUrl: options.graphBaseUrl, version: options.graphVersion }),
  },
  WhatsAppSyncService,
]

@Module({})
export class WhatsAppAccountsModule {
  /** API side: connection endpoints. Requires AuditModule (global) and the tenancy guards. */
  static forApi(options: WhatsAppOptions): DynamicModule {
    return {
      module: WhatsAppAccountsModule,
      controllers: [WhatsAppConnectionsController],
      providers: [...shared(options), WhatsAppConnectionService, SelfServeConnectionGuard],
      // ADR-0027: the operator console (PlatformWhatsAppModule) drives the same service.
      exports: [WhatsAppConnectionService],
    }
  }

  /** Worker side: the whatsapp.sync processor and its scheduler. */
  static forWorker(options: WhatsAppOptions): DynamicModule {
    return {
      module: WhatsAppAccountsModule,
      // The API app imports AuditModule at the root; the worker doesn't, so bring it in here.
      imports: [AuditModule],
      providers: [...shared(options), WhatsAppSyncProcessor],
      exports: [WhatsAppSyncProcessor],
    }
  }
}
