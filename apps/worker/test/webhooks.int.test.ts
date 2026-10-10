import { verifyWebhookSignature, WebhookEventsProcessor } from '@fenwira/api/modules/webhooks'
import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookPayload,
} from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { uuidv7 } from '@fenwira/config'
import { type INestApplication } from '@nestjs/common'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'

/**
 * Phase 11 Step 3: outbound webhooks (docs/WEBHOOKS.md, decision P11-D18) against a real local
 * receiver — the AUTOMATION_WEBHOOK_DEV_HOSTS exception (127.0.0.1 only) that safeFetch already
 * offers automation's webhook action, reused here rather than a second HTTP client.
 */
let api: INestApplication
let worker: INestApplication
let db: Database
let receiver: Server
let receiverUrl: string
let owner: Member
type Received = { headers: Record<string, string | string[] | undefined>; body: string }
let received: Received[] = []
let failNext = 0

beforeAll(async () => {
  api = await bootApi({ AUTOMATION_WEBHOOK_DEV_HOSTS: '127.0.0.1' })
  worker = await bootWorker({
    AUTOMATION_WEBHOOK_DEV_HOSTS: '127.0.0.1',
    WEBHOOK_BACKOFF_MS: '100',
    WEBHOOK_MAX_RETRY_HOURS: '24',
    WEBHOOK_DISABLE_AFTER_FAILURES: '3',
  })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
  receiver = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push({ headers: req.headers, body })
      if (failNext > 0) {
        failNext--
        res.writeHead(500).end('nope')
      } else {
        res.writeHead(200).end('ok')
      }
    })
  })
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r))
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`
  owner = await createOwner(api, 'webhooks')
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => receiver?.close(() => r()))
})

// Every test shares one local receiver; leaving a previous test's endpoint ACTIVE would make it
// fan out to that receiver alongside the current test's endpoint for the same event, contaminating
// signature checks, delivery counts and the shared `failNext` counter. Deleting after each test
// isolates them the way independent tenants would isolate two real integrators automatically.
afterEach(async () => {
  const endpoints = await owner.client.get('/webhook-endpoints')
  for (const ep of endpoints.body.data as Array<{ id: string }>)
    await owner.client.delete(`/webhook-endpoints/${ep.id}`)
})

const customer = () => `9197${String(Math.random()).slice(2, 10)}`

const waitFor = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await get()
    if (ok(v)) return v
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 100))
  }
}

describe('creating endpoints', () => {
  it('blocks a private/reserved destination even with a valid https URL', async () => {
    const res = await owner.client.post('/webhook-endpoints', {
      name: 'ssrf',
      url: 'https://169.254.169.254/',
      events: ['contact.created'],
    })
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('WEBHOOK_BLOCKED_DESTINATION')
  })

  it('rejects garbage as WEBHOOK_URL_INVALID, and http outside the dev-host allowance', async () => {
    const garbage = await owner.client.post('/webhook-endpoints', {
      name: 'bad',
      url: 'not a url',
      events: ['contact.created'],
    })
    expect(garbage.status).toBe(422)
    expect(garbage.body.error.code).toBe('WEBHOOK_URL_INVALID')

    const httpElsewhere = await owner.client.post('/webhook-endpoints', {
      name: 'http',
      url: 'http://example.com/',
      events: ['contact.created'],
    })
    expect(httpElsewhere.status).toBe(422)
    expect(httpElsewhere.body.error.code).toBe('WEBHOOK_URL_INVALID')
  })

  it('creates an endpoint against the local receiver and returns the secret once', async () => {
    const res = await owner.client.post('/webhook-endpoints', {
      name: 'local receiver',
      url: receiverUrl,
      events: ['contact.created', 'contact.updated'],
    })
    expect(res.status, res.text).toBe(201)
    expect(res.body.data.endpoint).toMatchObject({ status: 'ACTIVE', failureCount: 0 })
    expect(res.body.data.secret).toMatch(/^whsec_/)
    const list = await owner.client.get('/webhook-endpoints')
    for (const ep of list.body.data) {
      expect(ep).not.toHaveProperty('secret')
      expect(ep).not.toHaveProperty('secretCiphertext')
    }
  })
})

describe('end-to-end delivery', () => {
  it('a real contact.created event is signed, delivered, and shows SUCCEEDED with a response', async () => {
    const created = await owner.client.post('/webhook-endpoints', {
      name: 'e2e',
      url: receiverUrl,
      events: ['contact.created'],
    })
    const endpointId = created.body.data.endpoint.id as string
    const secret = created.body.data.secret as string
    received = []

    const contact = await owner.client.post('/contacts', {
      phone: `+${customer()}`,
      name: 'Webhook Target',
    })
    expect(contact.status, contact.text).toBe(201)

    const hit = await waitFor(
      async () => received.find((r) => JSON.parse(r.body).eventId !== undefined),
      (v) => v !== undefined,
    )
    const payload = JSON.parse(hit!.body) as WebhookPayload
    expect(payload.type).toBe('contact.created')
    expect(payload.apiVersion).toBe('2026-09-28')
    expect((payload.data as { contactId: string }).contactId).toBe(contact.body.data.id)

    const ts = hit!.headers[WEBHOOK_TIMESTAMP_HEADER.toLowerCase()] as string
    const sig = hit!.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()] as string
    expect(verifyWebhookSignature(secret, ts, hit!.body, sig)).toBe(true)
    expect(hit!.headers[WEBHOOK_EVENT_HEADER.toLowerCase()]).toBe('contact.created')
    expect(hit!.headers[WEBHOOK_DELIVERY_HEADER.toLowerCase()]).toBe(payload.id)

    const delivery = await waitFor(
      async () =>
        (await owner.client.get(`/webhook-endpoints/${endpointId}/deliveries/${payload.id}`)).body
          .data,
      (d) => d.status === 'SUCCEEDED',
    )
    expect(delivery.responseStatus).toBe(200)
    expect(delivery.eventType).toBe('contact.created')
  })

  it('is signed with a timestamp that fails verification once tampered', async () => {
    const created = await owner.client.post('/webhook-endpoints', {
      name: 'tamper check',
      url: receiverUrl,
      events: ['contact.created'],
    })
    const secret = created.body.data.secret as string
    received = []
    await owner.client.post('/contacts', {
      phone: `+${customer()}`,
      name: 'Tamper Check',
    })
    const hit = await waitFor(
      async () => received[received.length - 1],
      (v) => v !== undefined,
    )
    const ts = hit!.headers[WEBHOOK_TIMESTAMP_HEADER.toLowerCase()] as string
    const sig = hit!.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()] as string
    expect(verifyWebhookSignature(secret, ts, `${hit!.body}x`, sig)).toBe(false)
    expect(verifyWebhookSignature(secret, String(Number(ts) + 1), hit!.body, sig)).toBe(false)
  })

  it('only fans out to endpoints subscribed to that event (the allowlist is per-endpoint, opt-in)', async () => {
    const notSubscribed = await owner.client.post('/webhook-endpoints', {
      name: 'campaigns only',
      url: receiverUrl,
      events: ['campaign.completed'],
    })
    received = []
    await owner.client.post('/contacts', {
      phone: `+${customer()}`,
      name: 'Not Subscribed',
    })
    await new Promise((r) => setTimeout(r, 500))
    for (const r of received) {
      const p = JSON.parse(r.body) as WebhookPayload
      // Only endpoints subscribed to contact.created should ever receive this delivery.
      expect(p.type).not.toBe('campaign.completed')
    }
    await owner.client.delete(`/webhook-endpoints/${notSubscribed.body.data.endpoint.id}`)
  })
})

describe('idempotent fan-out', () => {
  it('redelivering the same domain event creates exactly one delivery row, not two', async () => {
    const created = await owner.client.post('/webhook-endpoints', {
      name: 'idempotency',
      url: receiverUrl,
      events: ['contact.updated'],
    })
    const endpointId = created.body.data.endpoint.id as string
    const contact = await owner.client.post('/contacts', {
      phone: `+${customer()}`,
      name: 'Dup Event',
    })
    const processor = worker.get(WebhookEventsProcessor)
    const event = {
      eventId: uuidv7(),
      eventType: 'contact.updated' as const,
      tenantId: owner.tenantId,
      correlationId: null,
      occurredAt: new Date().toISOString(),
      payload: { contactId: contact.body.data.id, changedFields: ['name'] },
    }
    // Calls fanOut twice with the identical event id, exactly as a redelivered outbox event would
    // (the `(endpoint_id, event_id)` unique constraint makes the second call a no-op create).
    await processor.fanOut(event)
    await processor.fanOut(event)
    const rows = await db.withTenant(owner.tenantId, (tx) =>
      tx.webhookDelivery.findMany({ where: { endpointId, eventId: event.eventId } }),
    )
    expect(rows).toHaveLength(1)
  })
})

describe('retry, backoff and auto-disable', () => {
  it('retries a failing endpoint, then goes FAILED after the retry window, and manual retry works', async () => {
    const created = await owner.client.post('/webhook-endpoints', {
      name: 'retry me',
      url: receiverUrl,
      events: ['contact.created'],
    })
    const endpointId = created.body.data.endpoint.id as string
    failNext = 1
    received = []
    const contact = await owner.client.post('/contacts', {
      phone: `+${customer()}`,
      name: 'Retry Once',
    })
    void contact
    const succeeded = await waitFor(
      async () =>
        (await owner.client.get(`/webhook-endpoints/${endpointId}/deliveries`)).body.data[0],
      (d) => d?.status === 'SUCCEEDED' && d.attempt >= 2,
      15_000,
    )
    expect(succeeded.attempt).toBeGreaterThanOrEqual(2)
  })

  // A delivery only reaches the terminal FAILED state once it's older than WEBHOOK_MAX_RETRY_HOURS
  // (minimum 0.1h = 6 minutes) — too long to wait for in real time. These two tests instead insert
  // a delivery row whose embedded `payload.createdAt` is already far outside that window, so the
  // very first `processor.send()` call goes straight to terminal FAILED, deterministically and
  // fast — the same code path a delivery genuinely outliving the retry window would take.
  const insertStaleFailingDelivery = (endpointId: string) =>
    db.withTenant(owner.tenantId, async (tx) => {
      const eventId = uuidv7()
      const row = await tx.webhookDelivery.create({
        data: {
          tenantId: owner.tenantId,
          endpointId,
          eventId,
          eventType: 'contact.created',
          payload: {
            id: '',
            type: 'contact.created',
            apiVersion: '2026-09-28',
            createdAt: new Date(Date.now() - 48 * 3_600_000).toISOString(),
            eventId,
            data: { contactId: uuidv7(), source: 'MANUAL' },
          },
        },
      })
      await tx.webhookDelivery.update({
        where: { id: row.id },
        data: { payload: { ...(row.payload as object), id: row.id } },
      })
      return row.id
    })

  it('disables the endpoint after enough consecutive terminal failures, and notifies OWNER/ADMIN', async () => {
    const created = await owner.client.post('/webhook-endpoints', {
      name: 'always fails',
      url: receiverUrl,
      events: ['contact.created'],
    })
    const endpointId = created.body.data.endpoint.id as string
    failNext = 1000
    const processor = worker.get(WebhookEventsProcessor)
    // WEBHOOK_DISABLE_AFTER_FAILURES is 3 in this file's worker boot options (top of file).
    for (let i = 0; i < 3; i++) {
      const deliveryId = await insertStaleFailingDelivery(endpointId)
      const outcome = await processor.send({ tenantId: owner.tenantId, deliveryId })
      expect(outcome).toBe('failed')
    }
    const endpoints = await owner.client.get('/webhook-endpoints')
    expect(endpoints.body.data.find((e: { id: string }) => e.id === endpointId).status).toBe(
      'DISABLED',
    )

    const notifications = await owner.client.get('/notifications')
    expect(
      (notifications.body.data as Array<{ type: string; link: string | null }>).some(
        (n) =>
          n.type === 'webhook.endpoint_disabled' &&
          n.link === `/integrations/webhooks/${endpointId}`,
      ),
    ).toBe(true)
    failNext = 0
  })

  it('a manual retry on a FAILED delivery re-queues it and it can then succeed', async () => {
    const created = await owner.client.post('/webhook-endpoints', {
      name: 'manual retry target',
      url: receiverUrl,
      events: ['contact.created'],
    })
    const endpointId = created.body.data.endpoint.id as string
    failNext = 1
    const processor = worker.get(WebhookEventsProcessor)
    const deliveryId = await insertStaleFailingDelivery(endpointId)
    expect(await processor.send({ tenantId: owner.tenantId, deliveryId })).toBe('failed')

    const retry = await owner.client.post(
      `/webhook-endpoints/${endpointId}/deliveries/${deliveryId}/retry`,
    )
    expect(retry.status).toBe(204)
    await waitFor(
      async () =>
        (await owner.client.get(`/webhook-endpoints/${endpointId}/deliveries/${deliveryId}`)).body
          .data,
      (d) => d.status === 'SUCCEEDED',
      15_000,
    )
  })
})

describe('secret rotation and the test-delivery action', () => {
  it('rotating the secret invalidates the old one for new signatures', async () => {
    const created = await owner.client.post('/webhook-endpoints', {
      name: 'rotate me',
      url: receiverUrl,
      events: ['contact.created'],
    })
    const endpointId = created.body.data.endpoint.id as string
    const rotated = await owner.client.post(`/webhook-endpoints/${endpointId}/rotate-secret`)
    expect(rotated.status, rotated.text).toBe(201)
    expect(rotated.body.data.secret).toMatch(/^whsec_/)
    expect(rotated.body.data.secret).not.toBe(created.body.data.secret)
  })

  it('the test action sends one synthetic delivery an integrator can use to verify their receiver', async () => {
    const created = await owner.client.post('/webhook-endpoints', {
      name: 'test delivery',
      url: receiverUrl,
      events: ['contact.created'],
    })
    const endpointId = created.body.data.endpoint.id as string
    received = []
    const test = await owner.client.post(`/webhook-endpoints/${endpointId}/test`)
    expect(test.status, test.text).toBe(201)
    const delivered = await waitFor(
      async () => received.find((r) => JSON.parse(r.body).type === 'webhook.test'),
      (v) => v !== undefined,
    )
    const payload = JSON.parse(delivered!.body) as { id: string; type: string }
    expect(payload.id).toBe(test.body.data.deliveryId)
  })
})
