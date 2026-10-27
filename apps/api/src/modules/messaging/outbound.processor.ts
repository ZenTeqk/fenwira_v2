import { type EventJob, jobId, QUEUES } from '@fenwira/queue'
import { type SendableContent } from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import { GraphError } from '@fenwira/whatsapp'
import { buildSendPayload, MessageSender } from '@fenwira/whatsapp/send'
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common'
import { DelayedError, type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { REDIS } from '../../core/redis/redis.provider'
import { StorageService } from '../../core/storage/storage.service'
import { OutboxRelayService } from '../platform'
import { loadLiveToken, markCredentialInvalid } from '../whatsapp-accounts'
import { MARK_READ_JOB } from './constants'
import { TEMPLATES_SYNC_WABA_JOB } from '../templates'
import {
  MessageEligibilityService,
  type MessagePurpose,
  type TemplateCategory,
} from './eligibility'
import { toWaId } from './messaging.mapper'
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options'
import type IORedis from 'ioredis'

type SendJob = EventJob<'message.outbound.requested'>
type MarkReadJob = { tenantId: string; messageId: string }
type OutboundJob = SendJob | MarkReadJob

/** Retryable Meta rate limit; the backoff strategy gives it a long delay. */
export class MetaRateLimited extends Error {
  constructor(readonly code: string) {
    super(`Meta rate limit (${code})`)
    this.name = 'MetaRateLimited'
  }
}

const SENDABLE = ['CREATED', 'QUEUED', 'SENDING'] as const
/** How long a send interrupted mid-call waits for Meta's status webhook before resending. */
const CRASH_GRACE_MS = 60_000
const PHONE_OK = new Set(['CONNECTED', 'FLAGGED'])

/**
 * whatsapp.outbound (docs/MESSAGING_ENGINE.md → whatsapp.outbound processor). The only caller of
 * `@fenwira/whatsapp/send`. Re-checks guards at send time, rate-limits per number, and writes
 * SENT immediately after Meta answers. Retryable errors back off (5 attempts, jitter); permanent
 * errors fail without retries; exhausted jobs are copied to whatsapp.outbound.dlq.
 */
@Injectable()
export class OutboundProcessor implements QueueProcessor<OutboundJob>, OnModuleInit {
  readonly queue = QUEUES.whatsappOutbound
  readonly concurrency = 20
  private readonly sender: MessageSender

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MESSAGING_OPTIONS) private readonly options: MessagingOptions,
    @Inject(REDIS) private readonly redis: IORedis,
    private readonly queues: QueueRegistry,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeEmitter,
    private readonly relay: OutboxRelayService,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
    private readonly eligibility: MessageEligibilityService,
  ) {
    this.logger.setContext('OutboundProcessor')
    this.sender = new MessageSender({
      baseUrl: options.graphBaseUrl,
      version: options.graphVersion,
    })
  }

  /** The relay moves CREATED → QUEUED once the send job is enqueued. */
  onModuleInit(): void {
    this.relay.onDispatched('message.outbound.requested', async (event) => {
      const { messageId } = event.payload as { messageId: string }
      if (!event.tenantId) return
      const changed = await this.db.withTenant(event.tenantId, (tx) =>
        tx.message.updateMany({
          where: { id: messageId, status: 'CREATED' },
          data: { status: 'QUEUED', queuedAt: new Date() },
        }),
      )
      if (changed.count) await this.emitStatus(event.tenantId, messageId)
    })
  }

  /** 2^attempt × base ±20 % (2, 4, 8, 16 s by default); Meta rate limits wait 60× longer. */
  backoffStrategy(attemptsMade: number, err: Error | undefined): number {
    const unit = this.options.outboundBackoffBaseMs ?? 1000
    if (err instanceof MetaRateLimited || err?.name === 'MetaRateLimited')
      return 60 * unit * attemptsMade
    return Math.round(2 ** attemptsMade * unit * (0.8 + Math.random() * 0.4))
  }

  async process(job: Job<OutboundJob>, token?: string): Promise<unknown> {
    if (job.name === MARK_READ_JOB) return this.markRead(job.data as MarkReadJob)
    const data = job.data as SendJob
    const tenantId = data.tenantId!
    try {
      return await this.send(job as Job<SendJob>, tenantId, data.payload.messageId, token)
    } catch (err) {
      if (err instanceof DelayedError) throw err
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.exhausted(job as Job<SendJob>, tenantId, data.payload.messageId, err)
        return 'failed'
      }
      throw err
    }
  }

  private async send(job: Job<SendJob>, tenantId: string, messageId: string, token?: string) {
    const loaded = await this.db.withTenant(tenantId, async (tx) => {
      const message = await tx.message.findFirst({
        where: { id: messageId },
        include: { conversation: { include: { phoneNumber: true } }, contact: true, file: true },
      })
      if (!message || !SENDABLE.includes(message.status as 'CREATED')) return null
      const phone = message.conversation.phoneNumber
      // Send-time re-check: the number, then eligibility (MessageEligibilityService), then takeover.
      const eligibility = this.eligibility.evaluate({
        purpose: (message.purpose ?? 'SERVICE') as MessagePurpose,
        category: (message.content as { category?: TemplateCategory }).category ?? null,
        contentType: message.type,
        contact: message.contact,
        serviceWindowExpiresAt: message.conversation.serviceWindowExpiresAt,
      })
      const guard =
        this.guard(phone.status) ??
        (eligibility.allowed ? null : { code: eligibility.code, detail: eligibility.reason }) ??
        (message.source === 'AUTOMATION' &&
        message.conversation.automationState !== 'AUTOMATION_ACTIVE'
          ? {
              code: 'AUTOMATION_BLOCKED_BY_TAKEOVER',
              detail: 'An agent took over the conversation.',
            }
          : null)
      if (guard) {
        await this.fail(tx, message.id, guard.code, guard.detail)
        return { failed: true as const }
      }
      const credential = await loadLiveToken(tx, this.options.keyRing, phone.wabaId)
      if (!credential) {
        await this.fail(tx, message.id, 'NO_CREDENTIAL', 'The number has no valid Meta token.')
        return { failed: true as const }
      }
      return { failed: false as const, message, phone, credential }
    })
    if (!loaded) return 'skipped'
    if (loaded.failed) {
      await this.emitStatus(tenantId, messageId)
      return 'failed'
    }
    const { message, phone, credential } = loaded

    // SENDING on entry means an earlier attempt died mid-call (retryable errors reset to
    // QUEUED). Meta may have accepted it: wait for the status webhook, which carries our id in
    // biz_opaque_callback_data, before risking a duplicate.
    if (message.status === 'SENDING' && message.sendingAt) {
      const waited = Date.now() - message.sendingAt.getTime()
      if (waited < (this.options.crashGraceMs ?? CRASH_GRACE_MS)) {
        await job.moveToDelayed(Date.now() + 2000, token)
        throw new DelayedError()
      }
      this.logger.warn(
        { messageId: message.id, waitedMs: waited },
        'no status for an interrupted send; resending (Meta may deliver it twice)',
      )
    }

    // Per-number throughput (throughput_mps). Out of tokens → retry shortly, not an attempt.
    if (!(await this.takeToken(phone.id, phone.throughputMps))) {
      await job.moveToDelayed(Date.now() + 250 + Math.floor(Math.random() * 250), token)
      throw new DelayedError()
    }

    await this.db.withTenant(tenantId, (tx) =>
      tx.message.updateMany({
        where: { id: message.id, status: { in: [...SENDABLE] } },
        data: { status: 'SENDING', sendingAt: new Date(), attempts: { increment: 1 } },
      }),
    )
    await this.emitStatus(tenantId, message.id)

    const started = Date.now()
    const timer = this.metrics.metaDuration.startTimer({ endpoint: 'messages' })
    try {
      const content = message.content as SendableContent
      let mediaId: string | undefined
      if (message.file) {
        const bytes = await this.storage.getBytes(message.file.bucket, message.file.objectKey)
        mediaId = await this.sender.uploadMedia(credential.token, phone.phoneNumberId, {
          bytes,
          mimeType: message.file.mimeType,
          filename: message.file.filename ?? `attachment-${message.file.id}`,
        })
      }
      const { providerMessageId } = await this.sender.sendMessage(
        credential.token,
        phone.phoneNumberId,
        buildSendPayload(toWaId(message.contact.phoneE164), content, mediaId, message.id),
      )
      // Written immediately: a crash after this point can no longer cause a duplicate send.
      await this.db.withTenant(
        tenantId,
        (tx) =>
          tx.$executeRaw`
          UPDATE messages SET provider_message_id = ${providerMessageId},
            status = CASE WHEN fenwira_message_status_rank(status) < 3 THEN 'SENT'::message_status ELSE status END,
            sent_at = COALESCE(sent_at, now()), error_code = NULL, error_detail = NULL, updated_at = now()
          WHERE id = ${message.id}::uuid AND status <> 'FAILED'`,
      )
      timer()
      this.metrics.metaRequests.inc({ endpoint: 'messages', result: 'success', error_code: '' })
      this.metrics.messageStatus.inc({ direction: 'OUTBOUND', status: 'SENT' })
      this.logger.info(
        {
          messageId: message.id,
          phoneNumberId: phone.phoneNumberId,
          attempt: job.attemptsMade + 1,
          durationMs: Date.now() - started,
        },
        'message sent',
      )
      await this.emitStatus(tenantId, message.id)
      return 'sent'
    } catch (err) {
      timer()
      if (!(err instanceof GraphError)) throw err
      this.metrics.metaRequests.inc({
        endpoint: 'messages',
        result: err.classification.toLowerCase(),
        error_code: err.fenwiraCode,
      })
      this.logger.warn(
        {
          messageId: message.id,
          phoneNumberId: phone.phoneNumberId,
          attempt: job.attemptsMade + 1,
          durationMs: Date.now() - started,
          metaErrorCode: err.code,
          classification: err.classification,
        },
        'message send failed',
      )
      if (err.retryable) {
        await this.db.withTenant(tenantId, (tx) =>
          tx.message.updateMany({
            where: { id: message.id, status: 'SENDING' },
            data: { status: 'QUEUED', errorCode: err.fenwiraCode, errorDetail: err.title },
          }),
        )
        await this.emitStatus(tenantId, message.id)
        throw err.classification === 'RETRYABLE_RATE' ? new MetaRateLimited(err.fenwiraCode) : err
      }
      await this.db.withTenant(tenantId, async (tx) => {
        // fail() emits message.status.changed: consumers react (131050 revokes consent, billing
        // releases the reservation, the campaign recipient fails).
        await this.fail(tx, message.id, err.fenwiraCode, err.message.slice(0, 500))
        if (err.classification === 'CREDENTIAL')
          await markCredentialInvalid(tx, tenantId, credential.credentialId, phone.id)
      })
      // Meta says the template is missing, paused or disabled: refresh our copy of its status.
      if (err.fenwiraCode === 'META_TEMPLATE_ERROR')
        await this.queues
          .get(QUEUES.templatesSync)
          .add(
            TEMPLATES_SYNC_WABA_JOB,
            { tenantId, wabaId: phone.wabaId },
            { jobId: jobId('tplsync', phone.wabaId, 'send', message.id), attempts: 3 },
          )
          .catch(() => undefined)
      await this.emitStatus(tenantId, message.id)
      return 'failed'
    }
  }

  /** Send-time guards (the state may have changed since MessagingService accepted it). */
  private guard(phoneStatus: string) {
    if (!PHONE_OK.has(phoneStatus))
      return { code: 'NO_CONNECTED_NUMBER', detail: 'The WhatsApp number is not connected.' }
    return null
  }

  /** Redis fixed-window token bucket per number: `mps` sends per second. */
  private async takeToken(phoneId: string, mps: number): Promise<boolean> {
    const key = `rl:wa:${phoneId}:${Math.floor(Date.now() / 1000)}`
    const [[, count]] = (await this.redis.multi().incr(key).expire(key, 2).exec()) as [
      [null, number],
    ]
    return count <= Math.max(1, mps)
  }

  private async exhausted(job: Job<SendJob>, tenantId: string, messageId: string, err: unknown) {
    await this.db.withTenant(tenantId, (tx) =>
      this.fail(
        tx,
        messageId,
        'RETRIES_EXHAUSTED',
        err instanceof Error ? err.message.slice(0, 500) : String(err),
      ),
    )
    await this.queues.get(QUEUES.whatsappOutboundDlq).add('dead', job.data, {
      jobId: jobId('dlq', messageId, Date.now()),
      removeOnComplete: false,
      removeOnFail: false,
    })
    this.logger.error({ messageId, err }, 'outbound retries exhausted; moved to DLQ')
    await this.emitStatus(tenantId, messageId)
  }

  /** FAILED plus `message.status.changed`, so billing releases and campaigns update. */
  private async fail(tx: TenantTx, id: string, code: string, detail: string) {
    const res = await tx.message.updateMany({
      where: { id, status: { in: [...SENDABLE] } },
      data: { status: 'FAILED', failedAt: new Date(), errorCode: code, errorDetail: detail },
    })
    if (res.count) {
      const m = await tx.message.findFirstOrThrow({ where: { id }, select: { tenantId: true } })
      await tx.outboxEvent.create({
        data: {
          tenantId: m.tenantId,
          eventType: 'message.status.changed',
          aggregateType: 'message',
          aggregateId: id,
          payload: { messageId: id, from: 'SENDING', to: 'FAILED', errorCode: code },
        },
      })
    }
    return res
  }

  private async markRead({ tenantId, messageId }: MarkReadJob) {
    const target = await this.db.withTenant(tenantId, async (tx) => {
      const m = await tx.message.findFirst({
        where: { id: messageId, direction: 'INBOUND' },
        include: { conversation: { include: { phoneNumber: true } } },
      })
      if (!m?.providerMessageId) return null
      const credential = await loadLiveToken(
        tx,
        this.options.keyRing,
        m.conversation.phoneNumber.wabaId,
      )
      return credential ? { m, credential } : null
    })
    if (!target) return 'skipped'
    await this.sender.markRead(
      target.credential.token,
      target.m.conversation.phoneNumber.phoneNumberId,
      target.m.providerMessageId!,
    )
    return 'read'
  }

  private async emitStatus(tenantId: string, messageId: string): Promise<void> {
    const m = await this.db.withTenant(tenantId, (tx) =>
      tx.message.findFirst({
        where: { id: messageId },
        select: {
          id: true,
          conversationId: true,
          status: true,
          errorCode: true,
          errorDetail: true,
        },
      }),
    )
    if (m)
      this.realtime.toConversation(tenantId, m.conversationId, 'message.status', {
        messageId: m.id,
        conversationId: m.conversationId,
        status: m.status,
        ...(m.errorCode ? { errorCode: m.errorCode } : {}),
        ...(m.errorDetail ? { errorDetail: m.errorDetail } : {}),
      })
  }
}
