import { type DynamicModule, Module, type ModuleMetadata, type Type } from '@nestjs/common'
import { HEALTH_INDICATORS, type HealthIndicator } from './health-indicator'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'

@Module({})
export class HealthModule {
  /** `indicators` are resolved from this module or from `imports` (which must export them). */
  static forRoot(options: {
    indicators: Type<HealthIndicator>[]
    imports?: ModuleMetadata['imports']
  }): DynamicModule {
    return {
      module: HealthModule,
      imports: options.imports ?? [],
      controllers: [HealthController],
      providers: [
        ...options.indicators,
        {
          provide: HEALTH_INDICATORS,
          useFactory: (...indicators: HealthIndicator[]) => indicators,
          inject: options.indicators,
        },
        HealthService,
      ],
    }
  }
}
