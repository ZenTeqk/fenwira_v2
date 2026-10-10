import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import { applyStatusPricing, type StatusPricing } from './usage.core'

type StatusJob = EventJob<'message.status.changed'>

/**
 * billing.usage (docs/BILLING.md → Reservations): Meta's pricing on a status webhook settles the
 * message's reservation into the ledger; a final non-billable outcome (failure, or Meta says it
 * isn't billable) releases it. A retry keeps the reservation until one of those happens.
 */
@Injectable()
export class BillingUsageProcessor implements QueueProcessor<StatusJob> {
  readonly queue = QUEUES.billingUsage
  readonly concurrency = 5

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(BILLING_OPTIONS) private readonly options: BillingOptions,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('BillingUsage')
  }

  async process(job: Job<StatusJob>): Promise<unknown> {
    const e = job.data
    if (e.eventType !== 'message.status.changed' || !e.tenantId) return 'ignored'
    const { messageId, to } = e.payload
    const pricing = (e.payload.pricing ?? null) as StatusPricing | null
    return this.db.withTenant(e.tenantId, (tx) =>
      applyStatusPricing(tx, e.tenantId!, { messageId, to, pricing }, this.options),
    )
  }
}
