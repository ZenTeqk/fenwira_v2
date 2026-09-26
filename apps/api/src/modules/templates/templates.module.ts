import { GraphClient } from '@fenwira/whatsapp'
import { type DynamicModule, Module, type Provider } from '@nestjs/common'
import { AuditModule } from '../audit'
import { TemplateSyncService } from './template-sync.service'
import { TemplatesController } from './templates.controller'
import { TemplatesService } from './templates.service'
import { TemplatesSyncProcessor } from './templates-sync.processor'
import { TEMPLATES_GRAPH, TEMPLATES_OPTIONS, type TemplatesOptions } from './templates.options'

const shared = (options: TemplatesOptions): Provider[] => [
  { provide: TEMPLATES_OPTIONS, useValue: options },
  {
    provide: TEMPLATES_GRAPH,
    useFactory: () =>
      new GraphClient({ baseUrl: options.graphBaseUrl, version: options.graphVersion }),
  },
  TemplateSyncService,
]

@Module({})
export class TemplatesModule {
  /** API side: template management endpoints. */
  static forApi(options: TemplatesOptions): DynamicModule {
    return {
      module: TemplatesModule,
      controllers: [TemplatesController],
      providers: [...shared(options), TemplatesService],
    }
  }

  /** Worker side: the templates.sync processor and its scheduler. */
  static forWorker(options: TemplatesOptions): DynamicModule {
    return {
      module: TemplatesModule,
      imports: [AuditModule],
      providers: [...shared(options), TemplatesSyncProcessor],
      exports: [TemplatesSyncProcessor, TemplateSyncService],
    }
  }
}
