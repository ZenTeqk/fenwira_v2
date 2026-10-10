import { Database } from '@fenwira/database'
import { type EventJob, jobId, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { CHECK_JOB } from './campaign-dispatch.processor'

type StatusJob = EventJob<'message.status.changed'>

/** Which recipient states a message status may move from: forward only, FAILED terminal. */
const FROM: Record<string, string[]> = {
  SENT: ['PENDING', 'QUEUED', 'SENDING'],
  DELIVERED: ['PENDING', 'QUEUED', 'SENDING', 'SENT'],
  READ: ['PENDING', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED'],
  FAILED: ['PENDING', 'QUEUED', 'SENDING', 'SENT'],
}
const STAMP: Record<string, string> = {
  SENT: 'sentAt',
  DELIVERED: 'deliveredAt',
  READ: 'readAt',
  FAILED: 'failedAt',
}

/**
 * campaign.events (docs/CAMPAIGN_ENGINE.md → Recipient status): a campaign message's status change
 * moves its recipient forward only (duplicate or out-of-order webhooks are no-ops), then a
 * debounced completion check runs on campaign.dispatch.
 */
@Injectable()
export class CampaignEventsProcessor implements QueueProcessor<StatusJob> {
  readonly queue = QUEUES.campaignEvents
  readonly concurrency = 10

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    private readonly metrics: MetricsService,
  ) {}

  async process(job: Job<StatusJob>): Promise<unknown> {
    const e = job.data
    if (e.eventType !== 'message.status.changed' || !e.tenantId) return 'ignored'
    const to = e.payload.to
    if (!FROM[to]) return 'ignored'
    const updated = await this.db.withTenant(e.tenantId, async (tx) => {
      const r = await tx.campaignRecipient.findFirst({
        where: { messageId: e.payload.messageId },
        select: { id: true, campaignId: true },
      })
      if (!r) return null
      const res = await tx.campaignRecipient.updateMany({
        where: { id: r.id, status: { in: FROM[to] as never } },
        data: {
          status: to as never,
          [STAMP[to]!]: new Date(),
          ...(to === 'FAILED' ? { errorCode: e.payload.errorCode ?? 'META_FAILED' } : {}),
        },
      })
      return res.count ? r.campaignId : null
    })
    if (!updated) return 'unchanged'
    if (to === 'FAILED') this.metrics.campaignRecipients.inc({ outcome: 'failed' })
    const bucket = String(Math.floor(Date.now() / 3000))
    await this.queues.get(QUEUES.campaignDispatch).add(
      CHECK_JOB,
      { tenantId: e.tenantId, campaignId: updated },
      {
        jobId: jobId('ccheck', updated, bucket),
        delay: 1000,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    )
    return 'applied'
  }
}
