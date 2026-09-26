import { Database, type TenantTx } from '@fenwira/database'
import { jobId, QUEUES } from '@fenwira/queue'
import { type StatusUpdate } from '@fenwira/whatsapp'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { applyTemplateEvent, type TemplateEvent } from '../templates'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { SYNC_PHONE_JOB } from '../whatsapp-accounts'
import { markWebhookFailedIfFinal } from './inbound.processor'
import { type StoredWebhookEvent, type WebhookJob } from './webhook-ingest.service'

/** A status for a wamid we haven't stored yet (the webhook beat our SENT write). */
export class MessageNotYetKnown extends Error {
  constructor() {
    super('status for a message not stored yet')
    this.name = 'MessageNotYetKnown'
  }
}

const MAX_UNKNOWN_ATTEMPTS = 5
const TO_STATUS = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ' } as const

type Applied = { messageId: string; conversationId: string; from: string; to: string } | null

/**
 * whatsapp.status: message status under the ordering rule (SENT < DELIVERED < READ, never
 * regress, FAILED terminal), and WABA-level events (quality/account → a sync of the numbers;
 * template events go to the templates module).
 */
@Injectable()
export class StatusProcessor implements QueueProcessor<WebhookJob> {
  readonly queue = QUEUES.whatsappStatus
  readonly concurrency = 10

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    private readonly realtime: RealtimeEmitter,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext('StatusProcessor')
  }

  async process(job: Job<WebhookJob>): Promise<unknown> {
    try {
      return await this.handle(job)
    } catch (err) {
      if (err instanceof MessageNotYetKnown && job.attemptsMade + 1 >= MAX_UNKNOWN_ATTEMPTS) {
        await this.finish(job.data, 'IGNORED', 'no message with this wamid')
        return 'ignored'
      }
      await markWebhookFailedIfFinal(this.db, job, err)
      throw err
    }
  }

  private async handle(job: Job<WebhookJob>): Promise<string> {
    const { tenantId, webhookEventId } = job.data
    const row = await this.db.withTenant(tenantId, (tx) =>
      tx.webhookEvent.findFirst({ where: { id: webhookEventId } }),
    )
    if (!row || row.status !== 'RECEIVED') return 'skipped'
    const event = row.payload as unknown as StoredWebhookEvent

    if (event.kind === 'STATUS') {
      const applied = await this.db.withTenant(tenantId, async (tx) => {
        const result = await this.applyStatus(tx, tenantId, webhookEventId, event.status)
        await this.markDone(tx, webhookEventId, 'PROCESSED')
        return result
      })
      if (applied) this.metrics.messageStatus.inc({ direction: 'OUTBOUND', status: applied.to })
      if (applied)
        this.realtime.toConversation(tenantId, applied.conversationId, 'message.status', {
          messageId: applied.messageId,
          conversationId: applied.conversationId,
          status: applied.to,
          ...(event.status.error ? { errorCode: `META_${event.status.error.code}` } : {}),
        })
      return applied ? 'applied' : 'unchanged'
    }

    if (event.kind === 'PHONE_QUALITY' || event.kind === 'ACCOUNT_UPDATE') {
      // Refresh every live number of this WABA from Meta rather than parsing each event shape.
      const phones = await this.db.withTenant(tenantId, (tx) =>
        tx.whatsAppPhoneNumber.findMany({
          where: { status: { notIn: ['DISCONNECTED', 'PENDING'] }, waba: { wabaId: event.wabaId } },
          select: { id: true },
        }),
      )
      await this.queues.get(QUEUES.whatsappSync).addBulk(
        phones.map((p) => ({
          name: SYNC_PHONE_JOB,
          data: { tenantId, phoneId: p.id, correlationId: `whk:${webhookEventId}` },
          opts: { jobId: jobId('sync', p.id, 'whk', webhookEventId), attempts: 3 },
        })),
      )
      await this.finish(job.data, 'PROCESSED')
      return 'sync-queued'
    }

    // Template status/quality/category (docs/TEMPLATE_ENGINE.md → Lifecycle).
    if (event.kind === 'MESSAGE') {
      await this.finish(job.data, 'IGNORED', 'not a status event')
      return 'ignored'
    }
    const outcome = await this.db.withTenant(tenantId, async (tx) => {
      const result = await applyTemplateEvent(tx, tenantId, {
        kind: event.kind as TemplateEvent['kind'],
        data: event.data,
      })
      await this.markDone(
        tx,
        webhookEventId,
        result.applied ? 'PROCESSED' : 'IGNORED',
        result.applied ? undefined : 'unknown template (a sync imports it)',
      )
      return result
    })
    for (const p of outcome.pushes)
      this.realtime.toUser(p.userId, 'notification.created', p.notification)
    return outcome.applied ? 'template-applied' : 'ignored'
  }

  private async applyStatus(
    tx: TenantTx,
    tenantId: string,
    webhookEventId: string,
    s: StatusUpdate,
  ): Promise<Applied> {
    let message = await tx.message.findFirst({
      where: { providerMessageId: s.providerMessageId, direction: 'OUTBOUND' },
      select: { id: true, conversationId: true, status: true },
    })
    // Our send's response was lost (e.g. the worker died mid-call): Meta echoes our message id
    // in biz_opaque_callback_data, so the wamid can still be attached and no resend is needed.
    if (!message && s.callbackData && /^[0-9a-f-]{36}$/i.test(s.callbackData)) {
      const claimed = await tx.message.updateMany({
        where: { id: s.callbackData, direction: 'OUTBOUND', providerMessageId: null },
        data: { providerMessageId: s.providerMessageId },
      })
      if (claimed.count)
        message = await tx.message.findFirst({
          where: { id: s.callbackData },
          select: { id: true, conversationId: true, status: true },
        })
    }
    if (!message) throw new MessageNotYetKnown()
    const at = new Date(s.timestamp)
    let updated: number
    let to: string
    if (s.status === 'failed') {
      const code = s.error ? `META_${s.error.code}` : 'META_FAILED'
      const detail = s.error?.detail ?? s.error?.title ?? null
      // A failure after DELIVERED is recorded but never un-delivers the message.
      updated = await tx.$executeRaw`
        UPDATE messages SET status = 'FAILED', failed_at = ${at}, error_code = ${code},
          error_detail = ${detail}, updated_at = now()
        WHERE id = ${message.id}::uuid AND status <> 'FAILED'
          AND fenwira_message_status_rank(status) < 4`
      if (!updated)
        await tx.$executeRaw`
          UPDATE messages SET error_code = ${code}, error_detail = ${detail}, updated_at = now()
          WHERE id = ${message.id}::uuid AND status <> 'FAILED'`
      to = 'FAILED'
    } else {
      to = TO_STATUS[s.status]
      // Forward only; READ without DELIVERED backfills delivered_at; sent_at is kept if set.
      updated = await tx.$executeRaw`
        UPDATE messages SET
          status = ${to}::message_status,
          sent_at = COALESCE(sent_at, ${at}),
          delivered_at = CASE WHEN ${to} IN ('DELIVERED', 'READ') THEN COALESCE(delivered_at, ${at}) ELSE delivered_at END,
          read_at = CASE WHEN ${to} = 'READ' THEN COALESCE(read_at, ${at}) ELSE read_at END,
          updated_at = now()
        WHERE id = ${message.id}::uuid AND status <> 'FAILED'
          AND fenwira_message_status_rank(status) < fenwira_message_status_rank(${to}::message_status)`
    }
    if (!updated) return null
    await tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: 'message.status.changed',
        aggregateType: 'message',
        aggregateId: message.id,
        payload: {
          messageId: message.id,
          from: message.status,
          to,
          ...(s.error ? { errorCode: `META_${s.error.code}` } : {}),
          ...(s.pricing ? { pricing: s.pricing } : {}),
        } as object,
        correlationId: `whk:${webhookEventId}`,
      },
    })
    return {
      messageId: message.id,
      conversationId: message.conversationId,
      from: message.status,
      to,
    }
  }

  private markDone(tx: TenantTx, id: string, status: 'PROCESSED' | 'IGNORED', reason?: string) {
    return tx.webhookEvent.update({
      where: { id },
      data: {
        status,
        processedAt: new Date(),
        attempts: { increment: 1 },
        lastError: reason ?? null,
      },
    })
  }

  private finish(job: WebhookJob, status: 'PROCESSED' | 'IGNORED', reason?: string) {
    return this.db.withTenant(job.tenantId, (tx) =>
      this.markDone(tx, job.webhookEventId, status, reason),
    )
  }
}
