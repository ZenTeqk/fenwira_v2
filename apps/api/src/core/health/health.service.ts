import { type HealthCheckResult, type HealthResponse } from '@fenwira/contracts'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { CORE_CONFIG, type CoreConfig } from '../config/core-config'
import { HEALTH_INDICATORS, type HealthIndicator } from './health-indicator'

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name)

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    @Inject(HEALTH_INDICATORS) private readonly indicators: HealthIndicator[],
  ) {}

  async readiness(): Promise<HealthResponse> {
    const entries = await Promise.all(
      this.indicators.map(async (indicator): Promise<[string, HealthCheckResult]> => {
        const started = performance.now()
        try {
          await indicator.check()
          return [
            indicator.name,
            { status: 'up', latencyMs: Math.round(performance.now() - started) },
          ]
        } catch (err) {
          // Probes are public: driver messages can name hosts and ports, so the cause stays in
          // the service log and the response only says the dependency is unavailable.
          this.logger.warn(
            `${indicator.name} check failed: ${err instanceof Error ? err.message : String(err)}`,
          )
          return [indicator.name, { status: 'down', error: 'unavailable' }]
        }
      }),
    )
    const checks = Object.fromEntries(entries)
    const ok = entries.every(([, r]) => r.status === 'up')
    return {
      status: ok ? 'ok' : 'error',
      service: this.config.service,
      version: this.config.version,
      checks,
    }
  }
}
