import { Database } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { WebhookEventsProcessor } from './webhook-events.processor'

const RETENTION_JOB = 'retention'
const RECOVERY_JOB = 'recover-pending'
const RETENTION_DAYS = 30

/** webhooks.maintenance (docs/WEBHOOKS.md → Retention): nightly delivery history purge, 30 days. */
@Injectable()
export class WebhooksMaintenanceProcessor
  implements QueueProcessor, OnApplicationBootstrap, OnApplicationShutdown
{
  readonly queue = QUEUES.webhooksMaintenance
  readonly concurrency = 1
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    private readonly deliveries: WebhookEventsProcessor,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('WebhooksMaintenance')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  private async schedule(attempt: number): Promise<void> {
    try {
      await this.queues
        .get(this.queue)
        .upsertJobScheduler(
          'webhooks-recover-pending',
          { every: 30_000 },
          { name: RECOVERY_JOB, data: {}, opts: { removeOnComplete: 50, removeOnFail: 50 } },
        )
      await this.queues
        .get(this.queue)
        .upsertJobScheduler(
          'webhooks-retention',
          { pattern: '30 3 * * *', tz: 'UTC' },
          { name: RETENTION_JOB, data: {}, opts: { removeOnComplete: 50, removeOnFail: 50 } },
        )
      // Re-register even after success: a Redis restart/loss must not lose the scheduler.
      this.retryTimer = setTimeout(() => void this.schedule(0), 30_000)
    } catch {
      this.retryTimer = setTimeout(
        () => void this.schedule(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === RECOVERY_JOB) return this.deliveries.recoverPending()
    if (job.name === RETENTION_JOB) return this.retention()
    return 'ignored'
  }

  async retention(now = new Date()): Promise<number> {
    const before = new Date(now.getTime() - RETENTION_DAYS * 86_400_000)
    const tenants = await this.db.system.tenantsWithStaleWebhookDeliveries(before, 100_000)
    let purged = 0
    for (const tenantId of tenants) {
      try {
        purged += await this.db.system.purgeWebhookDeliveries(tenantId, before)
      } catch (err) {
        this.logger.error({ err, tenantId }, 'webhook delivery retention failed')
      }
    }
    return purged
  }
}
