import { Database } from '@fenwira/database'
import { jobId, QUEUES } from '@fenwira/queue'
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
import { WhatsAppSyncService } from './sync.service'
import { WHATSAPP_OPTIONS, type WhatsAppOptions } from './whatsapp.options'

export const SYNC_DUE_JOB = 'sync-due'
export const SYNC_PHONE_JOB = 'sync-phone'
const FAN_OUT_EVERY_MS = 15 * 60 * 1000
const BATCH = 500

type SyncJob = { tenantId?: string | null; phoneId?: string; correlationId?: string }

/**
 * whatsapp.sync: a job scheduler fires `sync-due` every 15 minutes; it lists numbers not synced
 * within WHATSAPP_SYNC_INTERVAL_HOURS (system.phone_numbers_due_for_sync, IDs only) and enqueues
 * one `sync-phone` job per number. Job ids are bucketed by interval so a slow run can't duplicate.
 */
@Injectable()
export class WhatsAppSyncProcessor
  implements QueueProcessor<SyncJob>, OnApplicationBootstrap, OnApplicationShutdown
{
  private retryTimer?: NodeJS.Timeout
  readonly queue = QUEUES.whatsappSync
  readonly concurrency = 5

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WHATSAPP_OPTIONS) private readonly options: WhatsAppOptions,
    private readonly queues: QueueRegistry,
    private readonly sync: WhatsAppSyncService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('WhatsAppSync')
  }

  private get intervalMs(): number {
    return (this.options.syncIntervalHours ?? 6) * 3600 * 1000
  }

  /** Registers the repeatable fan-out. Retries in the background so a Redis outage at boot
   * doesn't stop the worker from starting (the relay and processors recover on their own). */
  onApplicationBootstrap(): void {
    void this.registerScheduler(0)
  }

  private async registerScheduler(attempt: number): Promise<void> {
    try {
      await this.queues
        .get(this.queue)
        .upsertJobScheduler(
          'whatsapp-sync-due',
          { every: FAN_OUT_EVERY_MS },
          { name: SYNC_DUE_JOB, data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
        )
    } catch (err) {
      this.logger.warn({ err, attempt }, 'could not register the sync scheduler; retrying')
      this.retryTimer = setTimeout(
        () => void this.registerScheduler(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  async process(job: Job<SyncJob>): Promise<unknown> {
    if (job.name === SYNC_DUE_JOB) return this.fanOut()
    const { tenantId, phoneId } = job.data
    if (!tenantId || !phoneId) throw new Error('sync-phone job without tenantId/phoneId')
    return this.sync.syncPhone(tenantId, phoneId)
  }

  /** Public for tests: enqueue every due number now. Returns how many were enqueued. */
  async fanOut(now = Date.now()): Promise<number> {
    const due = await this.db.system.phoneNumbersDueForSync(new Date(now - this.intervalMs), BATCH)
    const bucket = Math.floor(now / this.intervalMs)
    await this.queues.get(this.queue).addBulk(
      due.map((d) => ({
        name: SYNC_PHONE_JOB,
        data: {
          tenantId: d.tenantId,
          phoneId: d.phoneId,
          correlationId: `whatsapp-sync-${bucket}`,
        },
        opts: {
          jobId: jobId('sync', d.phoneId, bucket),
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      })),
    )
    if (due.length) this.logger.info({ count: due.length }, 'whatsapp numbers queued for sync')
    return due.length
  }
}
