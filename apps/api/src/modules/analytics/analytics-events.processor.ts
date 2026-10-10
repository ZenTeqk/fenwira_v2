import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { type ConsumedEvent, recordEvent } from './projection'

/**
 * analytics.events (docs/ANALYTICS.md → Event pipeline): records each consumed domain event once
 * (keyed by its source event id) and marks what must be recomputed. It never touches source data
 * or money, and a failure here never affects ingestion or sending (separate queue, retried).
 */
@Injectable()
export class AnalyticsEventsProcessor implements QueueProcessor<EventJob> {
  readonly queue = QUEUES.analyticsEvents
  readonly concurrency = 5

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AnalyticsEvents')
  }

  async process(job: Job<EventJob>): Promise<string> {
    const e = job.data as ConsumedEvent
    if (!e.tenantId) return 'ignored'
    try {
      const result = await this.db.withTenant(e.tenantId, (tx) => recordEvent(tx, e.tenantId!, e))
      this.metrics.analyticsEvents.inc({ type: e.eventType, result })
      return result
    } catch (err) {
      this.metrics.analyticsProjectionFailures.inc()
      throw err
    }
  }
}
