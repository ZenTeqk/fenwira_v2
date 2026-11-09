import { type DynamicModule, Module } from '@nestjs/common'
import { FollowUpsService } from './follow-ups.service'
import { OpportunitiesService } from './opportunities.service'
import {
  FollowUpsController,
  OpportunitiesController,
  SalesStagesController,
} from './sales.controller'
import { SalesEventsProcessor } from './sales-events.processor'
import { SalesStagesService } from './stages.service'

/** Follow-ups, sales stages and opportunities (docs/FOLLOW_UPS_AND_SALES.md). */
@Module({})
export class SalesModule {
  static forApi(): DynamicModule {
    return {
      module: SalesModule,
      controllers: [SalesStagesController, OpportunitiesController, FollowUpsController],
      providers: [SalesStagesService, OpportunitiesService, FollowUpsService],
    }
  }

  /** Worker side: due reminders, their recovery sweep and customer-reply review flags. */
  static forWorker(): DynamicModule {
    return {
      module: SalesModule,
      providers: [SalesEventsProcessor],
      exports: [SalesEventsProcessor],
    }
  }
}
