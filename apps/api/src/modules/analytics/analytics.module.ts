import { type DynamicModule, Module } from '@nestjs/common'
import { EntitlementsModule } from '../entitlements'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsEventsProcessor } from './analytics-events.processor'
import { AnalyticsRollupProcessor } from './analytics-rollup.processor'
import {
  ANALYTICS_OPTIONS,
  type AnalyticsOptions,
  DEFAULT_ANALYTICS_OPTIONS,
} from './analytics.options'
import { AnalyticsService } from './analytics.service'

/** Analytics (Phase 11 Step 2, docs/ANALYTICS.md): derived projections and the read API. */
@Module({})
export class AnalyticsModule {
  static forApi(): DynamicModule {
    return {
      module: AnalyticsModule,
      imports: [EntitlementsModule.forRoot()],
      controllers: [AnalyticsController],
      providers: [AnalyticsService],
    }
  }

  static forWorker(options: Partial<AnalyticsOptions> = {}): DynamicModule {
    return {
      module: AnalyticsModule,
      imports: [EntitlementsModule.forRoot()],
      providers: [
        { provide: ANALYTICS_OPTIONS, useValue: { ...DEFAULT_ANALYTICS_OPTIONS, ...options } },
        AnalyticsEventsProcessor,
        AnalyticsRollupProcessor,
      ],
      exports: [AnalyticsEventsProcessor, AnalyticsRollupProcessor],
    }
  }
}
