import { type DynamicModule, Module } from '@nestjs/common'
import { AuditModule } from '../audit'
import { CampaignDispatchProcessor } from './campaign-dispatch.processor'
import { CampaignEventsProcessor } from './campaign-events.processor'
import { CampaignsController } from './campaigns.controller'
import { CAMPAIGNS_OPTIONS, type CampaignsOptions } from './campaigns.options'
import { CampaignsService } from './campaigns.service'

@Module({})
export class CampaignsModule {
  static forApi(options: CampaignsOptions): DynamicModule {
    return {
      module: CampaignsModule,
      controllers: [CampaignsController],
      providers: [{ provide: CAMPAIGNS_OPTIONS, useValue: options }, CampaignsService],
    }
  }

  /** Worker side. `imports` must provide MessagingService (the only send path). */
  static forWorker(options: CampaignsOptions, imports: DynamicModule[]): DynamicModule {
    return {
      module: CampaignsModule,
      imports: [AuditModule, ...imports],
      providers: [
        { provide: CAMPAIGNS_OPTIONS, useValue: options },
        CampaignDispatchProcessor,
        CampaignEventsProcessor,
      ],
      exports: [CampaignDispatchProcessor, CampaignEventsProcessor],
    }
  }
}
