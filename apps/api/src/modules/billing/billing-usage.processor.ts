import { Database } from '@fenwira/database'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { countryOf } from '../../core/phone'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { releaseReservation, settleReservation } from './wallet.core'

type StatusJob = EventJob<'message.status.changed'>
type Pricing = { billable?: boolean; category?: string }

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
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('BillingUsage')
  }

  async process(job: Job<StatusJob>): Promise<unknown> {
    const e = job.data
    if (e.eventType !== 'message.status.changed' || !e.tenantId) return 'ignored'
    const { messageId, to } = e.payload
    const pricing = (e.payload.pricing ?? null) as Pricing | null
    return this.db.withTenant(e.tenantId, async (tx) => {
      if (to === 'FAILED') {
        return (await releaseReservation(tx, e.tenantId!, messageId, 'failed'))
          ? 'released'
          : 'none'
      }
      if (!pricing) return 'no-pricing'
      if (pricing.billable === false) {
        return (await releaseReservation(tx, e.tenantId!, messageId, 'not billable'))
          ? 'released'
          : 'none'
      }
      const message = await tx.message.findFirst({
        where: { id: messageId },
        select: { contact: { select: { phoneE164: true, country: true } } },
      })
      if (!message) return 'unknown-message'
      return settleReservation(tx, e.tenantId!, {
        messageId,
        category: (pricing.category ?? 'UTILITY').toUpperCase(),
        country: message.contact.country ?? countryOf(message.contact.phoneE164),
        pricing,
      })
    })
  }
}
