import { Database, Prisma } from '@fenwira/database'
import { jobId, QUEUE_JOB_OPTIONS, QUEUES } from '@fenwira/queue'
import {
  normalizeWebhook,
  type NormalizedWebhookEvent,
  verifyWebhookSignature,
} from '@fenwira/whatsapp'
import { Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { requestContext } from '../../core/context/request-context'
import { MetricsService } from '../../core/metrics/metrics.service'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { MESSAGING_OPTIONS, type MessagingOptions } from './messaging.options'

export type IngestResult = { accepted: number; duplicates: number; ignored: number }
/** What whatsapp.inbound / whatsapp.status jobs carry: ids only. */
export type WebhookJob = { webhookEventId: string; tenantId: string; correlationId: string }
/** Stored in webhook_events.payload. */
export type StoredWebhookEvent = NormalizedWebhookEvent & { phoneId: string | null }

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

/**
 * POST /webhooks/whatsapp pipeline (docs/MESSAGING_ENGINE.md → Inbound pipeline): verify the
 * signature on the raw bytes, normalize, resolve the tenant (X2), persist with a dedupe key, and
 * enqueue by webhook event id. Processing happens in the workers; this only makes it durable.
 */
@Injectable()
export class WebhookIngestService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(MESSAGING_OPTIONS) private readonly options: MessagingOptions,
    private readonly queues: QueueRegistry,
    private readonly logger: PinoLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext('WhatsAppWebhook')
  }

  verifyHandshake(mode?: string, token?: string): boolean {
    return mode === 'subscribe' && !!this.options.verifyToken && token === this.options.verifyToken
  }

  verifySignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
    return (
      !!this.options.appSecret &&
      !!rawBody &&
      verifyWebhookSignature(this.options.appSecret, rawBody, header)
    )
  }

  async ingest(payload: unknown): Promise<IngestResult> {
    const result: IngestResult = { accepted: 0, duplicates: 0, ignored: 0 }
    for (const event of normalizeWebhook(payload)) {
      const route = await this.resolve(event)
      if (!route) {
        result.ignored += 1
        this.metrics.webhookReceived.inc({ kind: event.kind, result: 'unknown_number' })
        this.logger.warn(
          { kind: event.kind, phoneNumberId: event.phoneNumberId, wabaId: event.wabaId },
          'webhook for an unknown number or account; ignored',
        )
        continue
      }
      const stored = await this.persist(route.tenantId, { ...event, phoneId: route.phoneId })
      if (stored.duplicate && stored.status !== 'RECEIVED') {
        result.duplicates += 1
        this.metrics.webhookReceived.inc({ kind: event.kind, result: 'duplicate' })
        continue
      }
      // A duplicate still RECEIVED may have missed its enqueue: re-add (same job id = no-op).
      await this.enqueue(event.kind, stored.id, route.tenantId)
      if (stored.duplicate) result.duplicates += 1
      else result.accepted += 1
      this.metrics.webhookReceived.inc({
        kind: event.kind,
        result: stored.duplicate ? 'duplicate' : 'accepted',
      })
    }
    return result
  }

  private async resolve(
    event: NormalizedWebhookEvent,
  ): Promise<{ tenantId: string; phoneId: string | null } | null> {
    if (event.phoneNumberId) return this.db.system.resolveTenantByPhoneNumberId(event.phoneNumberId)
    const tenantId = await this.db.system.resolveTenantByWabaId(event.wabaId)
    return tenantId ? { tenantId, phoneId: null } : null
  }

  private async persist(
    tenantId: string,
    event: StoredWebhookEvent,
  ): Promise<{ id: string; duplicate: boolean; status: string }> {
    try {
      const row = await this.db.withTenant(tenantId, (tx) =>
        tx.webhookEvent.create({
          data: {
            tenantId,
            dedupeKey: event.dedupeKey,
            kind: event.kind,
            phoneNumberId: event.phoneNumberId,
            payload: event as unknown as Prisma.InputJsonValue,
          },
        }),
      )
      return { id: row.id, duplicate: false, status: row.status }
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      const row = await this.db.withTenant(tenantId, (tx) =>
        tx.webhookEvent.findFirstOrThrow({ where: { dedupeKey: event.dedupeKey } }),
      )
      return { id: row.id, duplicate: true, status: row.status }
    }
  }

  private async enqueue(kind: string, webhookEventId: string, tenantId: string): Promise<void> {
    const queue = kind === 'MESSAGE' ? QUEUES.whatsappInbound : QUEUES.whatsappStatus
    const data: WebhookJob = {
      webhookEventId,
      tenantId,
      correlationId: requestContext.correlationId() ?? `whk:${webhookEventId}`,
    }
    await this.queues.get(queue).add(kind, data, {
      ...QUEUE_JOB_OPTIONS[queue],
      jobId: jobId('whk', webhookEventId),
    })
  }
}
