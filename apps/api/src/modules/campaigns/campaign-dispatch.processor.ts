import {
  type Campaign,
  type CampaignAudience,
  type TemplateVariables,
  type VariableMapping,
} from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import { type EventJob, jobId, QUEUES } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { AppError } from '../../core/http/app-error'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { MessagingService } from '../messaging'
import {
  audienceWhere,
  CONTACT_SELECT,
  classify,
  resolveVariables,
  skipReasonFor,
} from './campaigns.core'
import { CAMPAIGNS_OPTIONS, type CampaignsOptions } from './campaigns.options'

export const PREPARE_JOB = 'campaign-prepare'
export const DISPATCH_JOB = 'campaign-dispatch'
export const CHECK_JOB = 'campaign-check'
export const SCHEDULER_JOB = 'campaign-scheduler'
export const RECOVER_JOB = 'campaign-recover'

type Snapshot = NonNullable<Campaign['template']>
type DispatchData = { tenantId: string; campaignId: string; generation: number; batch: number }
type Data =
  | EventJob<'campaign.launched'>
  | EventJob<'campaign.resumed'>
  | { tenantId: string; campaignId: string }
  | DispatchData
  | Record<string, never>

/**
 * campaign.dispatch (docs/CAMPAIGN_ENGINE.md → Launch, Batch processing, Scheduling, Crash
 * recovery). Postgres holds all campaign state; Redis only runs the work:
 *  - prepare: audience → immutable CampaignRecipient snapshot, in keyset pages (bounded memory),
 *    each recipient classified by the MessageEligibilityService rules;
 *  - dispatch: small batches of PENDING recipients → MessagingService (the only send path) with a
 *    deterministic idempotency key per recipient, so any retry or duplicate worker sends once;
 *  - scheduler (30 s): due SCHEDULED campaigns → PREPARING, by a conditional update (one winner);
 *  - recover (60 s): re-drives PREPARING/RUNNING campaigns, reconciles recipients from their
 *    messages, and completes finished campaigns.
 */
@Injectable()
export class CampaignDispatchProcessor implements QueueProcessor<Data>, OnApplicationBootstrap {
  readonly queue = QUEUES.campaignDispatch
  readonly concurrency = 4
  private retryTimer?: NodeJS.Timeout

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(CAMPAIGNS_OPTIONS) private readonly options: CampaignsOptions,
    private readonly queues: QueueRegistry,
    private readonly messaging: MessagingService,
    private readonly realtime: RealtimeEmitter,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('CampaignDispatch')
  }

  onApplicationBootstrap(): void {
    void this.schedule(0)
  }

  onApplicationShutdown(): void {
    clearTimeout(this.retryTimer)
  }

  private async schedule(attempt: number): Promise<void> {
    try {
      const q = this.queues.get(this.queue)
      const opts = { removeOnComplete: 50, removeOnFail: 50 }
      await q.upsertJobScheduler(
        'campaign-scheduler',
        { every: 30_000 },
        { name: SCHEDULER_JOB, data: {}, opts },
      )
      await q.upsertJobScheduler(
        'campaign-recover',
        { every: 60_000 },
        { name: RECOVER_JOB, data: {}, opts },
      )
    } catch {
      this.retryTimer = setTimeout(
        () => void this.schedule(attempt + 1),
        Math.min(30_000, 1000 * 2 ** attempt),
      )
    }
  }

  async process(job: Job<Data>): Promise<unknown> {
    if (job.attemptsMade > 0) this.metrics.campaignRetries.inc()
    switch (job.name) {
      case SCHEDULER_JOB:
        return this.scheduleDue()
      case RECOVER_JOB:
        return this.recover()
      case PREPARE_JOB: {
        const d = job.data as { tenantId: string; campaignId: string }
        return this.prepare(d.tenantId, d.campaignId)
      }
      case DISPATCH_JOB:
        return this.dispatch(job.data as DispatchData)
      case CHECK_JOB: {
        const d = job.data as { tenantId: string; campaignId: string }
        return this.complete(d.tenantId, d.campaignId)
      }
    }
    const e = job.data as EventJob<'campaign.launched'>
    if (!e.tenantId) return 'ignored'
    if (e.eventType === 'campaign.launched') return this.prepare(e.tenantId, e.payload.campaignId)
    if (e.eventType === 'campaign.resumed') {
      const gen = await this.db.withTenant(e.tenantId, (tx) =>
        tx.campaign.findFirst({
          where: { id: e.payload.campaignId },
          select: { dispatchGeneration: true },
        }),
      )
      if (gen)
        await this.enqueueDispatch(e.tenantId, e.payload.campaignId, gen.dispatchGeneration, 0)
      return 'resumed'
    }
    return 'ignored'
  }

  // --------------------------------------------------------------------------- snapshot

  /** Resumable, deterministic snapshot: contacts created up to the cutoff, by id, in pages. */
  async prepare(tenantId: string, campaignId: string): Promise<string> {
    const start = await this.db.withTenant(tenantId, async (tx) => {
      const c = await tx.campaign.findFirst({ where: { id: campaignId, deletedAt: null } })
      if (!c || c.status !== 'PREPARING') return null
      const cutoff = c.audienceSnapshotAt ?? new Date()
      if (!c.audienceSnapshotAt)
        await tx.campaign.update({ where: { id: c.id }, data: { audienceSnapshotAt: cutoff } })
      const last = await tx.campaignRecipient.findFirst({
        where: { campaignId },
        orderBy: { contactId: 'desc' },
        select: { contactId: true },
      })
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { defaultCountry: true },
      })
      return { c, cutoff, after: last?.contactId, country: tenant.defaultCountry }
    })
    if (!start) return 'skipped'
    const template = start.c.templateSnapshot as Snapshot | null
    if (!template) return this.fail(tenantId, campaignId, 'The campaign has no template.')
    const mapping = start.c.variableMapping as VariableMapping
    const pageSize = this.options.snapshotPageSize ?? 1000
    let after = start.after
    for (;;) {
      const done = await this.db.withTenant(tenantId, async (tx) => {
        const status = await this.status(tx, campaignId)
        if (status !== 'PREPARING' && status !== 'PAUSED') return true
        const where = await audienceWhere(tx, start.c.audience as CampaignAudience, start.cutoff)
        const page = await tx.contact.findMany({
          where: after ? { AND: [where, { id: { gt: after } }] } : where,
          select: CONTACT_SELECT,
          orderBy: { id: 'asc' },
          take: pageSize,
        })
        if (!page.length) return true
        await tx.campaignRecipient.createMany({
          data: page.map((contact) => {
            const variables = resolveVariables(mapping, contact)
            const reason = classify(contact, template, variables, start.country)
            return {
              tenantId,
              campaignId,
              contactId: contact.id,
              phoneE164: contact.phoneE164,
              contactName: contact.name,
              variables: variables as object,
              status: reason ? ('SKIPPED' as const) : ('PENDING' as const),
              skipReason: reason,
            }
          }),
          skipDuplicates: true,
        })
        after = page.at(-1)!.id
        return page.length < pageSize
      })
      if (done) break
    }
    const next = await this.db.withTenant(tenantId, async (tx) => {
      const total = await tx.campaignRecipient.count({ where: { campaignId } })
      const moved = await tx.campaign.updateMany({
        where: { id: campaignId, status: 'PREPARING' },
        data: { status: 'RUNNING', totalRecipients: total, startedAt: new Date() },
      })
      if (!moved.count) {
        await tx.campaign.update({ where: { id: campaignId }, data: { totalRecipients: total } })
        return null
      }
      return (await tx.campaign.findFirstOrThrow({ where: { id: campaignId } })).dispatchGeneration
    })
    this.progress(tenantId, campaignId)
    if (next !== null) await this.enqueueDispatch(tenantId, campaignId, next, 0)
    return 'prepared'
  }

  // --------------------------------------------------------------------------- dispatch

  async dispatch(d: DispatchData): Promise<string> {
    const started = Date.now()
    const setup = await this.db.withTenant(d.tenantId, async (tx) => {
      const c = await tx.campaign.findFirst({ where: { id: d.campaignId } })
      if (!c || c.status !== 'RUNNING' || c.dispatchGeneration !== d.generation) return null
      const batch = await tx.campaignRecipient.findMany({
        where: { campaignId: d.campaignId, status: 'PENDING' },
        orderBy: { id: 'asc' },
        take: this.options.batchSize ?? 50,
      })
      return { c, batch }
    })
    if (!setup) {
      this.metrics.campaignBatches.inc({ result: 'stale' })
      return 'stale'
    }
    const { c, batch } = setup
    if (!batch.length) {
      this.metrics.campaignBatches.inc({ result: 'empty' })
      await this.complete(d.tenantId, d.campaignId)
      return 'drained'
    }
    const template = c.templateSnapshot as Snapshot
    // Recipients go out in small parallel chunks; the campaign's status is re-checked before each
    // chunk, so a pause or cancel stops at most one chunk's in-flight sends.
    const parallel = Math.max(1, Math.min(this.options.parallelSends ?? 10, batch.length))
    for (let i = 0; i < batch.length; i += parallel) {
      const status = await this.db.withTenant(d.tenantId, (tx) => this.status(tx, d.campaignId))
      if (status !== 'RUNNING') {
        this.metrics.campaignBatches.inc({ result: 'interrupted' })
        return 'interrupted'
      }
      const outcomes = await Promise.allSettled(
        batch.slice(i, i + parallel).map((r) => this.sendOne(d, c.phoneNumberId!, template, r)),
      )
      const transient = outcomes.find((o) => o.status === 'rejected')
      if (transient) throw (transient as PromiseRejectedResult).reason // retried; keys prevent duplicates
      const stop = outcomes
        .map((o) => (o as PromiseFulfilledResult<string | null>).value)
        .find((v) => v !== null)
      if (stop) return stop
    }
    this.metrics.campaignBatches.inc({ result: 'ok' })
    // Campaign pacing (optional): keep to rate_limit_per_minute across batches.
    const perMinute = c.rateLimitPerMinute
    const delay = perMinute
      ? Math.max(0, (batch.length / perMinute) * 60_000 - (Date.now() - started))
      : 0
    await this.enqueueDispatch(d.tenantId, d.campaignId, d.generation, d.batch + 1, delay)
    return `batch ${d.batch}: ${batch.length}`
  }

  /** One recipient → MessagingService. Returns a stop reason for campaign-level refusals. */
  private async sendOne(
    d: DispatchData,
    phoneNumberId: string,
    template: Snapshot,
    r: { id: string; contactId: string; phoneE164: string; variables: unknown },
  ): Promise<string | null> {
    try {
      const message = await this.messaging.send({
        tenantId: d.tenantId,
        target: { phoneE164: r.phoneE164, phoneNumberId },
        content: {
          type: 'TEMPLATE',
          templateVersionId: template.versionId,
          variables: r.variables as TemplateVariables,
        },
        source: 'CAMPAIGN',
        idempotencyKey: `campaign:${d.campaignId}:${r.id}`,
        campaignId: d.campaignId,
      })
      await this.db.withTenant(d.tenantId, (tx) =>
        tx.campaignRecipient.updateMany({
          where: { id: r.id, status: 'PENDING' },
          data: {
            status: 'QUEUED',
            messageId: message.id,
            queuedAt: new Date(),
            attempts: { increment: 1 },
          },
        }),
      )
      this.metrics.campaignRecipients.inc({ outcome: 'queued' })
      return null
    } catch (err) {
      if (!(err instanceof AppError)) throw err
      return this.handleRefusal(d, r, err)
    }
  }

  /** A MessagingService refusal: recipient-level (skip) or campaign-level (pause/fail). */
  private async handleRefusal(
    d: DispatchData,
    r: { id: string; contactId: string },
    err: AppError,
  ): Promise<string | null> {
    const { tenantId, campaignId } = d
    switch (err.code) {
      case 'INSUFFICIENT_BALANCE':
        await this.pause(tenantId, campaignId, 'PAUSED_INSUFFICIENT_FUNDS', null)
        this.metrics.campaignRecipients.inc({ outcome: 'unfunded' })
        return 'insufficient-funds'
      case 'NO_CONNECTED_NUMBER':
        await this.pause(tenantId, campaignId, 'PAUSED', 'NUMBER_UNAVAILABLE')
        return 'number-unavailable'
      case 'TEMPLATE_NOT_APPROVED': {
        const paused = await this.db.withTenant(tenantId, async (tx) => {
          const c = await tx.campaign.findFirstOrThrow({ where: { id: campaignId } })
          const t = await tx.template.findFirst({
            where: { id: (c.templateSnapshot as Snapshot).templateId },
            select: { status: true, deletedAt: true },
          })
          return t && !t.deletedAt && t.status === 'PAUSED'
        })
        if (paused) {
          await this.pause(tenantId, campaignId, 'PAUSED', 'TEMPLATE_PAUSED')
          return 'template-paused'
        }
        await this.fail(
          tenantId,
          campaignId,
          'The template is no longer available (disabled, deleted or not approved).',
          true,
        )
        return 'template-unavailable'
      }
      default: {
        // Recipient-level: the send was refused for this contact (e.g. consent changed since the
        // snapshot). Skipped with the machine-readable reason; the campaign continues.
        const optedOut = (err.details as { optedOut?: boolean } | undefined)?.optedOut
        const reason = skipReasonFor(err.code, optedOut)
        await this.db.withTenant(tenantId, (tx) =>
          tx.campaignRecipient.updateMany({
            where: { id: r.id, status: 'PENDING' },
            data: { status: 'SKIPPED', skipReason: reason, errorCode: err.code },
          }),
        )
        this.metrics.campaignRecipients.inc({ outcome: `skipped_${reason.toLowerCase()}` })
        return null
      }
    }
  }

  // --------------------------------------------------------------------------- scheduling

  /** Due SCHEDULED campaigns → PREPARING. The conditional update makes one scheduler win. */
  async scheduleDue(now = new Date()): Promise<number> {
    const due = await this.db.system.dueScheduledCampaigns(now, 100)
    let started = 0
    for (const d of due) {
      const moved = await this.db.withTenant(d.tenantId, async (tx) => {
        const res = await tx.campaign.updateMany({
          where: { id: d.campaignId, status: 'SCHEDULED', scheduleAt: { lte: now } },
          data: { status: 'PREPARING' },
        })
        if (res.count)
          await tx.outboxEvent.create({
            data: {
              tenantId: d.tenantId,
              eventType: 'campaign.launched',
              aggregateType: 'campaign',
              aggregateId: d.campaignId,
              payload: { campaignId: d.campaignId },
            },
          })
        return res.count
      })
      if (moved) {
        started += 1
        this.progress(d.tenantId, d.campaignId)
      }
    }
    return started
  }

  /** Crash recovery: re-drive in-flight campaigns; reconcile recipients from their messages. */
  async recover(): Promise<number> {
    const active = await this.db.system.activeCampaigns(500)
    const bucket = String(Math.floor(Date.now() / 60_000))
    for (const a of active) {
      if (a.status === 'PREPARING') {
        await this.queues.get(this.queue).add(
          PREPARE_JOB,
          { tenantId: a.tenantId, campaignId: a.campaignId },
          {
            jobId: jobId('cprep', a.campaignId, bucket),
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        )
        continue
      }
      const gen = await this.db.withTenant(a.tenantId, async (tx) => {
        await this.reconcile(tx, a.campaignId)
        const pending = await tx.campaignRecipient.count({
          where: { campaignId: a.campaignId, status: 'PENDING' },
        })
        const c = await tx.campaign.findFirst({
          where: { id: a.campaignId },
          select: { dispatchGeneration: true },
        })
        return pending && c ? c.dispatchGeneration : null
      })
      if (gen !== null)
        await this.queues.get(this.queue).add(
          DISPATCH_JOB,
          { tenantId: a.tenantId, campaignId: a.campaignId, generation: gen, batch: 0 },
          {
            jobId: jobId('cdisp', a.campaignId, String(gen), 'recover', bucket),
            attempts: 5,
            removeOnComplete: 100,
            removeOnFail: 100,
          },
        )
      else await this.complete(a.tenantId, a.campaignId)
    }
    return active.length
  }

  /** Recipients whose status webhook was missed catch up with their message's status. */
  private async reconcile(tx: TenantTx, campaignId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE campaign_recipients r SET
        status = CASE m.status WHEN 'FAILED' THEN 'FAILED'::recipient_status
                               WHEN 'READ' THEN 'READ'::recipient_status
                               WHEN 'DELIVERED' THEN 'DELIVERED'::recipient_status
                               ELSE 'SENT'::recipient_status END,
        error_code = CASE m.status WHEN 'FAILED' THEN m.error_code ELSE r.error_code END,
        sent_at = coalesce(r.sent_at, m.sent_at),
        delivered_at = coalesce(r.delivered_at, m.delivered_at),
        read_at = coalesce(r.read_at, m.read_at),
        failed_at = coalesce(r.failed_at, m.failed_at),
        updated_at = now()
      FROM messages m
      WHERE r.campaign_id = ${campaignId}::uuid AND r.message_id = m.id
        AND r.status IN ('QUEUED', 'SENDING')
        AND m.status IN ('SENT', 'DELIVERED', 'READ', 'FAILED')`
  }

  /** RUNNING with nothing PENDING and nothing awaiting Meta → COMPLETED (once). */
  async complete(tenantId: string, campaignId: string): Promise<string> {
    const done = await this.db.withTenant(tenantId, async (tx) => {
      const open = await tx.campaignRecipient.count({
        where: { campaignId, status: { in: ['PENDING', 'QUEUED', 'SENDING'] } },
      })
      if (open) return null
      const now = new Date()
      const res = await tx.campaign.updateMany({
        where: { id: campaignId, status: 'RUNNING' },
        data: { status: 'COMPLETED', completedAt: now },
      })
      if (!res.count) return null
      await tx.outboxEvent.create({
        data: {
          tenantId,
          eventType: 'campaign.completed',
          aggregateType: 'campaign',
          aggregateId: campaignId,
          payload: { campaignId },
        },
      })
      const c = await tx.campaign.findFirstOrThrow({
        where: { id: campaignId },
        select: { startedAt: true },
      })
      return c.startedAt ? (now.getTime() - c.startedAt.getTime()) / 1000 : 0
    })
    if (done === null) return 'open'
    this.metrics.campaignDuration.observe(done)
    this.progress(tenantId, campaignId)
    return 'completed'
  }

  // --------------------------------------------------------------------------- helpers

  private async status(tx: TenantTx, campaignId: string): Promise<string | null> {
    const c = await tx.campaign.findFirst({ where: { id: campaignId }, select: { status: true } })
    return c?.status ?? null
  }

  private async pause(
    tenantId: string,
    campaignId: string,
    status: 'PAUSED' | 'PAUSED_INSUFFICIENT_FUNDS',
    reason: string | null,
  ) {
    const moved = await this.db.withTenant(tenantId, (tx) =>
      tx.campaign.updateMany({
        where: { id: campaignId, status: 'RUNNING' },
        data: { status, pauseReason: reason, pausedAt: new Date() },
      }),
    )
    if (moved.count) {
      this.logger.info({ campaignId, status, reason }, 'campaign paused by the dispatcher')
      this.progress(tenantId, campaignId)
    }
  }

  private async fail(
    tenantId: string,
    campaignId: string,
    reason: string,
    skipRest = false,
  ): Promise<string> {
    await this.db.withTenant(tenantId, async (tx) => {
      const res = await tx.campaign.updateMany({
        where: { id: campaignId, status: { in: ['PREPARING', 'RUNNING'] } },
        data: { status: 'FAILED', failureReason: reason, failedAt: new Date() },
      })
      if (res.count && skipRest)
        await tx.campaignRecipient.updateMany({
          where: { campaignId, status: 'PENDING' },
          data: { status: 'SKIPPED', skipReason: 'TEMPLATE_UNAVAILABLE' },
        })
    })
    this.progress(tenantId, campaignId)
    return 'failed'
  }

  private enqueueDispatch(
    tenantId: string,
    campaignId: string,
    generation: number,
    batch: number,
    delay = 0,
  ) {
    return this.queues.get(this.queue).add(
      DISPATCH_JOB,
      { tenantId, campaignId, generation, batch },
      {
        jobId: jobId('cdisp', campaignId, String(generation), String(batch)),
        delay,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    )
  }

  private progress(tenantId: string, campaignId: string) {
    this.realtime.toTenant(tenantId, 'campaign.progress', { campaignId })
  }
}
