import { decryptSecret } from '@fenwira/config'
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
/** A webhook route plus the secret that must have signed it (null = the platform app secret). */
type Route = { tenantId: string; phoneId: string | null; secret: string | null }
/** Distinct WABAs looked up per request before the signature is known (DoS bound). */
const MAX_WABAS_PER_PAYLOAD = 100
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

  /**
   * ML-D1 (ADR-0027): a payload is signed by the app that owns its WABAs: either the WABA's own
   * app secret (operator-managed connections) or the platform app secret. Returns the secret that
   * verified the raw bytes, or undefined (→ 401, nothing stored). Candidates come only from WABAs
   * live in some workspace plus the platform secret, so unknown senders can't choose the key.
   */
  async verifiedSecret(
    rawBody: Buffer | undefined,
    header: string | undefined,
    payload: unknown,
  ): Promise<{ secret: string | null } | undefined> {
    if (!rawBody || !header) return undefined
    const candidates = new Map<string, string | null>()
    for (const wabaId of entryWabaIds(payload)) {
      const route = await this.db.system.resolveWebhookRoute(wabaId, null)
      const own = route?.appSecretCiphertext
        ? decryptSecret(this.options.keyRing, route.appSecretCiphertext)
        : null
      if (own) candidates.set(own, own)
    }
    if (this.options.appSecret) candidates.set(this.options.appSecret, null)
    for (const [secret, identity] of candidates)
      if (verifyWebhookSignature(secret, rawBody, header)) return { secret: identity }
    return undefined
  }

  /** `signedWith` comes from verifiedSecret: each event must belong to a WABA that secret speaks for. */
  async ingest(payload: unknown, signedWith: { secret: string | null }): Promise<IngestResult> {
    const result: IngestResult = { accepted: 0, duplicates: 0, ignored: 0 }
    for (const event of normalizeWebhook(payload)) {
      const route = await this.resolve(event)
      if (route && route.secret !== signedWith.secret) {
        result.ignored += 1
        this.metrics.webhookReceived.inc({ kind: event.kind, result: 'wrong_app' })
        this.logger.warn(
          { kind: event.kind, phoneNumberId: event.phoneNumberId, wabaId: event.wabaId },
          'webhook signed by another app than the one this WABA uses; ignored',
        )
        continue
      }
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

  /** Unknown WABAs, and numbers that aren't live under the WABA the entry names, resolve to null. */
  private async resolve(event: NormalizedWebhookEvent): Promise<Route | null> {
    const route = await this.db.system.resolveWebhookRoute(event.wabaId, event.phoneNumberId)
    if (!route) return null
    return {
      tenantId: route.tenantId,
      phoneId: route.phoneId,
      secret: route.appSecretCiphertext
        ? decryptSecret(this.options.keyRing, route.appSecretCiphertext)
        : null,
    }
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

/** The distinct `entry[].id` values (WABA IDs) of a whatsapp_business_account payload. */
function entryWabaIds(payload: unknown): string[] {
  const root = (payload ?? {}) as { object?: unknown; entry?: unknown }
  if (root.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return []
  const ids = new Set<string>()
  for (const entry of root.entry) {
    const id = (entry as { id?: unknown } | null)?.id
    if (typeof id === 'string' && id) ids.add(id)
    if (ids.size >= MAX_WABAS_PER_PAYLOAD) break
  }
  return [...ids]
}
