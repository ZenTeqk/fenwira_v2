import { decryptSecret } from '@fenwira/config'
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from '@fenwira/contracts'
import { Database, Prisma, type TenantTx } from '@fenwira/database'
import { type EventJob, jobId, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { PinoLogger } from 'nestjs-pino'
import { safeFetch, SafeFetchError } from '../../core/http/safe-fetch'
import { MetricsService } from '../../core/metrics/metrics.service'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { OpsAlerts } from '../platform'
import { createNotificationOnce } from '../notifications'
import { buildWebhookPayload, isWebhookEvent } from './webhooks.core'
import { signWebhookBody } from './webhook-signing'
import { WEBHOOKS_OPTIONS, type WebhooksOptions } from './webhooks.options'
import { EntitlementsService } from '../entitlements'

const SEND_JOB = 'send'

type SendData = { tenantId: string; deliveryId: string }

/**
 * webhooks.deliver (docs/WEBHOOKS.md): two job kinds share this queue.
 * - A domain-event job (named after the event type, from the outbox relay's fan-out) creates one
 *   PENDING delivery row per ACTIVE endpoint subscribed to it — idempotent on the
 *   `(endpoint_id, event_id)` unique constraint, so a redelivered event never double-delivers.
 * - A `send` job makes one HTTP attempt for one delivery row and, on failure within the retry
 *   window, schedules the next attempt itself (a BullMQ delayed job) rather than relying on
 *   BullMQ's own retry, so backoff and the endpoint's failure count stay driven by our own rules.
 */
@Injectable()
export class WebhookEventsProcessor implements QueueProcessor<EventJob | SendData> {
  readonly queue = QUEUES.webhooksDeliver
  readonly concurrency = 10

  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(WEBHOOKS_OPTIONS) private readonly options: WebhooksOptions,
    private readonly queues: QueueRegistry,
    private readonly alerts: OpsAlerts,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    private readonly entitlements: EntitlementsService,
  ) {
    this.logger.setContext('WebhookEvents')
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === SEND_JOB) return this.send(job.data as SendData)
    return this.fanOut(job.data as EventJob)
  }

  async fanOut(e: EventJob): Promise<string> {
    if (!e.tenantId || !isWebhookEvent(e.eventType)) return 'ignored'
    const created = await this.db.withTenant(e.tenantId, async (tx) => {
      // Suspended by plan (Phase 11 Step 4): endpoints are kept, but no delivery is created for
      // events while the workspace lacks webhooks_enabled — they aren't queued for later either.
      if (!(await this.entitlements.webhooksEnabled(tx, e.tenantId!))) return null
      const endpoints = await tx.webhookEndpoint.findMany({
        where: { status: 'ACTIVE', deletedAt: null, events: { has: e.eventType } },
        select: { id: true },
      })
      const ids: string[] = []
      for (const ep of endpoints) {
        const deliveryId = await this.createDelivery(tx, e, ep.id)
        ids.push(deliveryId)
      }
      return ids
    })
    if (!created) return 'suspended-by-plan'
    for (const deliveryId of created) await this.enqueueSend(e.tenantId!, deliveryId)
    return `fanned-out:${created.length}`
  }

  /**
   * Creates the PENDING row, or returns the existing one for a redelivered event (idempotent).
   * Deliberately an `upsert` on the `(endpoint_id, event_id)` unique constraint rather than a
   * create-then-catch-P2002 pattern: once any statement inside a Postgres transaction fails, the
   * whole transaction is aborted and every later statement fails with 25P02, even ones inside the
   * same `catch` block — so recovering from the conflict *inside this transaction* requires never
   * raising it as a Postgres error in the first place.
   */
  private async createDelivery(tx: TenantTx, e: EventJob, endpointId: string): Promise<string> {
    const row = await tx.webhookDelivery.upsert({
      where: { endpointId_eventId: { endpointId, eventId: e.eventId } },
      create: {
        tenantId: e.tenantId!,
        endpointId,
        eventId: e.eventId,
        eventType: e.eventType,
        payload: {},
      },
      update: {},
      select: { id: true, payload: true },
    })
    // The payload embeds the delivery's own id, so it's written in a second step — but only the
    // first time: an existing row (this was a redelivered event) already has its real payload.
    if (!(row.payload as { type?: string }).type)
      await tx.webhookDelivery.update({
        where: { id: row.id },
        data: { payload: buildWebhookPayload(row.id, e) as unknown as Prisma.InputJsonValue },
      })
    return row.id
  }

  private async enqueueSend(tenantId: string, deliveryId: string) {
    const row = await this.db.withTenant(tenantId, (tx) =>
      tx.webhookDelivery.findFirst({
        where: { id: deliveryId, status: 'PENDING' },
        select: { attempt: true, nextAttemptAt: true },
      }),
    )
    if (!row) return
    return this.queues.get(this.queue).add(SEND_JOB, { tenantId, deliveryId } satisfies SendData, {
      delay: Math.max(0, (row.nextAttemptAt?.getTime() ?? 0) - Date.now()),
      // The same persisted attempt is one Redis job, even across concurrent recovery passes.
      jobId: jobId(
        'whd',
        deliveryId,
        String(row.attempt),
        String(row.nextAttemptAt?.getTime() ?? 0),
      ),
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true, // Postgres PENDING state owns infrastructure-failure recovery.
    })
  }

  /** Rebuild lost execution jobs from durable, due delivery state (X19; IDs only). */
  async recoverPending(now = new Date()): Promise<number> {
    let after: string | null = null
    let scheduled = 0
    for (;;) {
      const due = await this.db.system.webhookDeliveriesDue(now, 500, after)
      if (!due.length) break
      for (const row of due) {
        const active = await this.db.withTenant(row.tenantId, async (tx) => {
          const d = await tx.webhookDelivery.findFirst({
            where: { id: row.deliveryId, status: 'PENDING' },
          })
          if (!d || (d.nextAttemptAt && d.nextAttemptAt > now)) return false
          return Boolean(
            await tx.webhookEndpoint.findFirst({
              where: { id: d.endpointId, status: 'ACTIVE', deletedAt: null },
            }),
          )
        })
        if (active) {
          await this.enqueueSend(row.tenantId, row.deliveryId)
          scheduled++
        }
      }
      after = due[due.length - 1]!.deliveryId
    }
    return scheduled
  }

  /** One claimed HTTP attempt. HTTP failures persist; infrastructure failures remain recoverable. */
  async send(data: SendData): Promise<string> {
    let disabledAlert: { id: string; failures: number } | undefined
    const result = await this.db.withTenant(
      data.tenantId,
      async (tx) => {
        // PostgreSQL owns the in-flight claim. Crash/rollback automatically releases it; no Redis
        // lock or immortal SENDING row can strand a delivery. Contenders do not wait on HTTP.
        const [claim] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`webhook-delivery:${data.deliveryId}`}, 0)) AS acquired`
        if (!claim?.acquired) return 'in-flight'

        const delivery = await tx.webhookDelivery.findFirst({ where: { id: data.deliveryId } })
        if (!delivery || delivery.status !== 'PENDING') return 'skipped'
        if (delivery.nextAttemptAt && delivery.nextAttemptAt > new Date()) return 'not-due'
        const endpoint = await tx.webhookEndpoint.findFirst({ where: { id: delivery.endpointId } })
        if (!endpoint || endpoint.status !== 'ACTIVE' || endpoint.deletedAt) return 'skipped'
        // Lost the entitlement while a retry was pending: close it out without counting toward the
        // endpoint's failure count or auto-disable — the receiver did nothing wrong.
        if (!(await this.entitlements.webhooksEnabled(tx, data.tenantId))) {
          await tx.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: 'FAILED', errorCode: 'SUSPENDED_BY_PLAN', nextAttemptAt: null },
          })
          return 'suspended'
        }

        const payload = delivery.payload as { createdAt: string }
        const secret = decryptSecret(this.options.keyRing, endpoint.secretCiphertext)
        const raw = JSON.stringify(delivery.payload)
        const timestamp = String(Date.now())
        const attempt = delivery.attempt

        let outcome: { ok: true; status: number; ms: number } | { ok: false; error: string }
        try {
          const res = await safeFetch(
            {
              method: 'POST',
              url: endpoint.url,
              body: raw,
              headers: {
                [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(secret, timestamp, raw),
                [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
                [WEBHOOK_EVENT_HEADER]: delivery.eventType,
                [WEBHOOK_DELIVERY_HEADER]: delivery.id,
                'User-Agent': 'Fenwira-Webhooks/1',
              },
            },
            { devHosts: this.options.devHosts },
          )
          outcome =
            res.status >= 200 && res.status < 300
              ? { ok: true, status: res.status, ms: res.durationMs }
              : { ok: false, error: `HTTP_${res.status}` }
          await tx.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              responseStatus: res.status,
              responseBody: res.body.slice(0, 4000),
              durationMs: res.durationMs,
            },
          })
        } catch (err) {
          const code = err instanceof SafeFetchError ? err.code : 'WEBHOOK_NETWORK_ERROR'
          outcome = { ok: false, error: code }
        }

        if (outcome.ok) {
          await tx.webhookDelivery.update({
            where: { id: delivery.id },
            data: { status: 'SUCCEEDED', nextAttemptAt: null, errorCode: null },
          })
          await tx.webhookEndpoint.update({
            where: { id: endpoint.id },
            data: { failureCount: 0 },
          })
          this.metrics.webhookDeliveries.inc({ result: 'succeeded' })
          return 'succeeded'
        }

        const ageMs = Date.now() - new Date(payload.createdAt).getTime()
        const withinWindow = ageMs < this.options.maxRetryHours * 3_600_000
        if (withinWindow) {
          const backoff = Math.min(this.options.backoffMs * 2 ** (attempt - 1), 3_600_000)
          await tx.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              attempt: attempt + 1,
              errorCode: outcome.error,
              nextAttemptAt: new Date(Date.now() + backoff),
            },
          })
          this.metrics.webhookDeliveries.inc({ result: 'retrying' })
          return 'retrying'
        }

        await tx.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'FAILED', errorCode: outcome.error, nextAttemptAt: null },
        })
        this.metrics.webhookDeliveries.inc({ result: 'failed' })
        const updated = await tx.webhookEndpoint.update({
          where: { id: endpoint.id },
          data: { failureCount: { increment: 1 } },
        })
        const failures = updated.failureCount
        if (failures >= this.options.disableAfterFailures) {
          const disabled = await tx.webhookEndpoint.updateMany({
            where: { id: endpoint.id, status: 'ACTIVE' },
            data: { status: 'DISABLED' },
          })
          if (disabled.count) {
            await this.notifyDisabled(tx, data.tenantId, endpoint.id, endpoint.name)
            disabledAlert = { id: endpoint.id, failures }
          }
        }
        return 'failed'
      },
      { timeoutMs: 30_000 },
    ) // safeFetch's hard 10s ceiling plus bounded DB work.
    // Never queue from a transaction that can roll back. Recovery repairs a crash here.
    if (disabledAlert)
      await this.alerts.raise(
        'webhooks.endpoint_disabled',
        `A webhook endpoint was disabled after ${disabledAlert.failures} failed deliveries`,
        [`tenant ${data.tenantId}`, `endpoint ${disabledAlert.id}`],
      )
    if (result === 'retrying') await this.enqueueSend(data.tenantId, data.deliveryId)
    return result
  }

  private async notifyDisabled(tx: TenantTx, tenantId: string, endpointId: string, name: string) {
    const admins = await tx.membership.findMany({
      where: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
      select: { userId: true },
    })
    for (const { userId } of admins)
      await createNotificationOnce(tx, {
        tenantId,
        userId,
        type: 'webhook.endpoint_disabled',
        title: 'A webhook endpoint was disabled',
        body: `"${name}" was disabled after repeated delivery failures. Fix the endpoint and re-enable it in Integrations → Webhooks.`,
        severity: 'WARNING',
        link: `/integrations/webhooks/${endpointId}`,
        dedupeKey: `webhook-disabled:${endpointId}`,
      })
  }
}
