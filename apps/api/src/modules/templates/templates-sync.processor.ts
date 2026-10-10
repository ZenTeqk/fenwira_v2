import { Database } from '@fenwira/database'
import { type EventJob, jobId, QUEUES } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { TemplateSyncService } from './template-sync.service'
import { TEMPLATES_OPTIONS, type TemplatesOptions } from './templates.options'

export const TEMPLATES_SYNC_DUE_JOB = 'templates-sync-due'
export const TEMPLATES_SYNC_WABA_JOB = 'templates-sync-waba'
const FAN_OUT_EVERY_MS = 15 * 60_000

type SyncJob =
  | { tenantId: string; wabaId: string }
  | EventJob<'whatsapp.connection.changed'>
  | Record<string, never>

/**
 * templates.sync (docs/TEMPLATE_ENGINE.md → Lifecycle): every WABA's templates are reconciled
 * with Meta every `syncIntervalHours` (default 6; X14 lists due WABAs, IDs only), and a newly
 * connected number's WABA is synced right away so its approved templates (e.g. hello_world) exist.
 */
@Injectable()
export class TemplatesSyncProcessor implements QueueProcessor<SyncJob>, OnApplicationBootstrap {
  readonly queue = QUEUES.templatesSync
  readonly concurrency = 2
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(TEMPLATES_OPTIONS) private readonly options: TemplatesOptions,
    private readonly queues: QueueRegistry,
    private readonly syncer: TemplateSyncService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('TemplatesSync')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  /** Registers the repeatable fan-out, retrying in the background while Redis is down. */
  private async schedule(attempt: number): Promise<void> {
    try {
      await this.queues.get(this.queue).upsertJobScheduler(
        'templates-sync',
        { every: FAN_OUT_EVERY_MS },
        {
          name: TEMPLATES_SYNC_DUE_JOB,
          data: {},
          opts: { removeOnComplete: 50, removeOnFail: 50 },
        },
      )
    } catch {
      this.retryTimer = setTimeout(
        () => void this.schedule(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  async process(job: Job<SyncJob>): Promise<unknown> {
    if (job.name === TEMPLATES_SYNC_DUE_JOB) return this.fanOut()
    if (job.name === TEMPLATES_SYNC_WABA_JOB) {
      const { tenantId, wabaId } = job.data as { tenantId: string; wabaId: string }
      return (await this.syncer.syncWaba(tenantId, wabaId)) ?? 'no-credential'
    }
    const e = job.data as EventJob<'whatsapp.connection.changed'>
    if (
      e.eventType === 'whatsapp.connection.changed' &&
      e.tenantId &&
      e.payload.change === 'CONNECTED'
    ) {
      const phone = await this.db.withTenant(e.tenantId, (tx) =>
        tx.whatsAppPhoneNumber.findFirst({
          where: { id: e.payload.phoneId },
          select: { wabaId: true },
        }),
      )
      if (!phone) return 'unknown-phone'
      return (await this.syncer.syncWaba(e.tenantId, phone.wabaId)) ?? 'no-credential'
    }
    return 'ignored'
  }

  /** Public for tests: enqueue every WABA not synced within the interval. */
  async fanOut(now = new Date()): Promise<number> {
    const hours = this.options.syncIntervalHours ?? 6
    const due = await this.db.system.wabasDueForTemplateSync(
      new Date(now.getTime() - hours * 3600_000),
      500,
    )
    await this.queues.get(this.queue).addBulk(
      due.map((d) => ({
        name: TEMPLATES_SYNC_WABA_JOB,
        data: d,
        opts: {
          jobId: jobId('tplsync', d.wabaId, String(Math.floor(now.getTime() / FAN_OUT_EVERY_MS))),
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      })),
    )
    return due.length
  }
}
