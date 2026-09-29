import { encryptSecret } from '@fenwira/config'
import {
  type CreatedWebhookEndpoint,
  type CreateWebhookEndpointRequest,
  type Page,
  type UpdateWebhookEndpointRequest,
  type WebhookDelivery,
  type WebhookDeliveryDetail,
  type WebhookDeliveriesQuery,
  type WebhookEndpoint,
  type WebhookPayload,
} from '@fenwira/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { uuidv7 } from '@fenwira/config'
import { jobId, QUEUES } from '@fenwira/queue'
import { afterCursor, decodeCursor, toPage } from '../../core/http/cursor'
import { AppError } from '../../core/http/app-error'
import { QueueRegistry } from '../../core/queue/queue-registry'
import { TenantDb } from '../../core/database/tenant-db'
import { validateDestination, SafeFetchError } from '../../core/http/safe-fetch'
import { AuditService } from '../audit'
import { EntitlementsService } from '../entitlements'
import { currentAuth } from '../identity'
import { currentTenant } from '../tenancy'
import { generateWebhookSecret } from './webhook-signing'
import { WEBHOOKS_OPTIONS, type WebhooksOptions } from './webhooks.options'

const toEndpoint = (row: {
  id: string
  name: string
  url: string
  events: string[]
  status: 'ACTIVE' | 'DISABLED'
  failureCount: number
  createdBy: string | null
  creator: { name: string } | null
  createdAt: Date
  updatedAt: Date
}): WebhookEndpoint => ({
  id: row.id,
  name: row.name,
  url: row.url,
  events: row.events as WebhookEndpoint['events'],
  status: row.status,
  failureCount: row.failureCount,
  createdBy: row.createdBy,
  createdByName: row.creator?.name ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const toDelivery = (row: {
  id: string
  eventId: string
  eventType: string
  attempt: number
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED'
  responseStatus: number | null
  durationMs: number | null
  errorCode: string | null
  nextAttemptAt: Date | null
  createdAt: Date
}): WebhookDelivery => ({
  id: row.id,
  eventId: row.eventId,
  eventType: row.eventType,
  attempt: row.attempt,
  status: row.status,
  responseStatus: row.responseStatus,
  durationMs: row.durationMs,
  errorCode: row.errorCode,
  nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
})

/**
 * Outbound webhook endpoints (docs/WEBHOOKS.md, decision P11-D18). Admin CRUD is
 * `integrations.manage` by a signed-in member; delivery itself is a separate worker path
 * (`WebhookEventsProcessor`) that never touches this service.
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly queues: QueueRegistry,
    @Inject(WEBHOOKS_OPTIONS) private readonly options: WebhooksOptions,
  ) {}

  list(): Promise<WebhookEndpoint[]> {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.webhookEndpoint.findMany({
        where: { deletedAt: null },
        include: { creator: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      })
      return rows.map(toEndpoint)
    })
  }

  private async assertUrl(url: string): Promise<void> {
    try {
      // Only ever throws WEBHOOK_URL_INVALID or WEBHOOK_BLOCKED_DESTINATION (no network hop here).
      await validateDestination(url, { devHosts: this.options.devHosts })
    } catch (err) {
      if (err instanceof SafeFetchError)
        throw new AppError(
          err.code === 'WEBHOOK_BLOCKED_DESTINATION' ? err.code : 'WEBHOOK_URL_INVALID',
          422,
          err.message,
        )
      throw err
    }
  }

  async create(input: CreateWebhookEndpointRequest): Promise<CreatedWebhookEndpoint> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    await this.assertUrl(input.url)
    const enabled = await this.tenantDb.run((tx) => this.entitlements.webhooksEnabled(tx, tenantId))
    if (!enabled)
      throw new AppError(
        'ENTITLEMENT_REQUIRED',
        403,
        "Webhooks aren't included in this workspace's plan.",
        { key: 'webhooks_enabled' },
      )
    const secret = generateWebhookSecret()
    const row = await this.tenantDb.run(async (tx) => {
      const created = await tx.webhookEndpoint.create({
        data: {
          tenantId,
          name: input.name,
          url: input.url,
          secretCiphertext: Buffer.from(encryptSecret(this.options.keyRing, secret)),
          events: input.events,
          createdBy: userId,
        },
        include: { creator: { select: { name: true } } },
      })
      await this.audit.write(tx, {
        action: 'webhook_endpoint.created',
        targetType: 'webhook_endpoint',
        targetId: created.id,
        changes: { name: input.name, url: input.url, events: input.events },
      })
      return created
    })
    return { endpoint: toEndpoint(row), secret }
  }

  async update(id: string, input: UpdateWebhookEndpointRequest): Promise<WebhookEndpoint> {
    if (input.url) await this.assertUrl(input.url)
    return this.tenantDb.run(async (tx) => {
      const before = await tx.webhookEndpoint.findFirst({ where: { id, deletedAt: null } })
      if (!before) throw AppError.notFound('Webhook endpoint not found.')
      const row = await tx.webhookEndpoint.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.events !== undefined ? { events: input.events } : {}),
          ...(input.status !== undefined ? { status: input.status, failureCount: 0 } : {}),
        },
        include: { creator: { select: { name: true } } },
      })
      await this.audit.write(tx, {
        action: 'webhook_endpoint.updated',
        targetType: 'webhook_endpoint',
        targetId: id,
        changes: input,
      })
      return toEndpoint(row)
    })
  }

  async remove(id: string): Promise<void> {
    await this.tenantDb.run(async (tx) => {
      const row = await tx.webhookEndpoint.findFirst({ where: { id, deletedAt: null } })
      if (!row) throw AppError.notFound('Webhook endpoint not found.')
      await tx.webhookEndpoint.update({ where: { id }, data: { deletedAt: new Date() } })
      await this.audit.write(tx, {
        action: 'webhook_endpoint.deleted',
        targetType: 'webhook_endpoint',
        targetId: id,
        changes: { name: row.name },
      })
    })
  }

  async rotateSecret(id: string): Promise<{ secret: string }> {
    const secret = generateWebhookSecret()
    await this.tenantDb.run(async (tx) => {
      const row = await tx.webhookEndpoint.findFirst({ where: { id, deletedAt: null } })
      if (!row) throw AppError.notFound('Webhook endpoint not found.')
      await tx.webhookEndpoint.update({
        where: { id },
        data: { secretCiphertext: Buffer.from(encryptSecret(this.options.keyRing, secret)) },
      })
      await this.audit.write(tx, {
        action: 'webhook_endpoint.secret_rotated',
        targetType: 'webhook_endpoint',
        targetId: id,
        changes: {},
      })
    })
    return { secret }
  }

  async deliveries(
    id: string,
    query: WebhookDeliveriesQuery,
  ): Promise<{ data: WebhookDelivery[]; page: Page }> {
    return this.tenantDb.run(async (tx) => {
      const endpoint = await tx.webhookEndpoint.findFirst({ where: { id } })
      if (!endpoint) throw AppError.notFound('Webhook endpoint not found.')
      const rows = await tx.webhookDelivery.findMany({
        where: {
          endpointId: id,
          ...(query.status ? { status: query.status } : {}),
          ...afterCursor(decodeCursor(query.cursor)),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const { items, page } = toPage(rows, query.limit)
      return { data: items.map(toDelivery), page }
    })
  }

  async delivery(id: string, deliveryId: string): Promise<WebhookDeliveryDetail> {
    return this.tenantDb.run(async (tx) => {
      const row = await tx.webhookDelivery.findFirst({
        where: { id: deliveryId, endpointId: id },
      })
      if (!row) throw AppError.notFound('Delivery not found.')
      return {
        ...toDelivery(row),
        payload: row.payload as unknown as WebhookPayload,
        responseBody: row.responseBody,
      }
    })
  }

  /** Re-queues a FAILED delivery immediately (docs/WEBHOOKS.md → Manual retry). */
  async retry(id: string, deliveryId: string): Promise<void> {
    const { tenantId } = currentTenant()
    await this.tenantDb.run(async (tx) => {
      const row = await tx.webhookDelivery.findFirst({
        where: { id: deliveryId, endpointId: id },
      })
      if (!row) throw AppError.notFound('Delivery not found.')
      if (row.status !== 'FAILED')
        throw new AppError('CONFLICT', 409, 'Only a failed delivery can be retried.')
      await tx.webhookDelivery.update({
        where: { id: deliveryId },
        data: { status: 'PENDING', errorCode: null },
      })
      await this.audit.write(tx, {
        action: 'webhook_delivery.retried',
        targetType: 'webhook_delivery',
        targetId: deliveryId,
        changes: {},
      })
    })
    await this.queues
      .get(QUEUES.webhooksDeliver)
      .add(
        'send',
        { tenantId, deliveryId },
        { jobId: jobId('whd', deliveryId, 'retry', uuidv7()), attempts: 1 },
      )
  }

  /** Sends one synthetic delivery so an integrator can verify their receiver end to end. */
  async test(id: string): Promise<{ deliveryId: string }> {
    const { tenantId } = currentTenant()
    const eventId = uuidv7()
    const deliveryId = await this.tenantDb.run(async (tx) => {
      const endpoint = await tx.webhookEndpoint.findFirst({ where: { id, deletedAt: null } })
      if (!endpoint) throw AppError.notFound('Webhook endpoint not found.')
      const created = await tx.webhookDelivery.create({
        data: {
          tenantId,
          endpointId: id,
          eventId,
          eventType: 'webhook.test',
          payload: {
            id: '',
            type: 'webhook.test',
            apiVersion: '2026-09-28',
            createdAt: new Date().toISOString(),
            eventId,
            data: { message: 'This is a test delivery from Fenwira.' },
          },
        },
      })
      await tx.webhookDelivery.update({
        where: { id: created.id },
        data: { payload: { ...(created.payload as object), id: created.id } },
      })
      return created.id
    })
    await this.queues
      .get(QUEUES.webhooksDeliver)
      .add('send', { tenantId, deliveryId }, { jobId: jobId('whd', deliveryId), attempts: 1 })
    return { deliveryId }
  }
}
