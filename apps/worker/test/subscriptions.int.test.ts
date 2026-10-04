import { Database } from '@fenwira/database'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
} from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFlow, chain, keyword, text } from './support/automation'
import { campaignWorld, metaId } from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'

/**
 * Phase 11 Step 4 (docs/BILLING.md → Plans): entitlements come from plans and subscriptions.
 * Limits are set per workspace with tenant_entitlement_overrides (the top of the precedence), so
 * each test controls its own numbers without depending on seeded plan values.
 */
const SECRET = 'subscriptions-test-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string

const ENFORCED = { BILLING_SUBSCRIPTIONS_ENFORCED: 'true' }
const phone = () => `+9196${String(Math.random()).slice(2, 10)}`

const override = (tenantId: string, key: string, value: unknown) =>
  db.withTenant(tenantId, (tx) =>
    tx.tenantEntitlementOverride.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, value: value as never, reason: 'test' },
      update: { value: value as never },
    }),
  )
const contactCount = (tenantId: string) =>
  db.withTenant(tenantId, (tx) => tx.contact.count({ where: { deletedAt: null } }))

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    ...ENFORCED,
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  webhookUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}/api/v1/webhooks/whatsapp`
  mock.state.webhookTarget = { url: webhookUrl, appSecret: SECRET, statuses: [], delayMs: 20 }
  worker = await bootWorker({ ...ENFORCED, META_GRAPH_BASE_URL: mock.url })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Phase 11 Step 4: contact limit', { timeout: 60_000 }, () => {
  let owner: Member
  beforeAll(async () => {
    owner = await createOwner(api, 'sub-contacts')
  })

  it('refuses a manual create past the limit with LIMIT_EXCEEDED {key, limit, current}', async () => {
    await override(owner.tenantId, 'max_contacts', 2)
    for (let i = 0; i < 2; i++)
      expect((await owner.client.post('/contacts', { phone: phone() })).status).toBe(201)
    const refused = await owner.client.post('/contacts', { phone: phone() })
    expect(refused.status).toBe(422)
    expect(refused.body.error).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      details: { key: 'max_contacts', limit: 2, current: 2 },
    })
    // Reads, edits and deletes still work over the limit.
    expect((await owner.client.post('/contacts/search', {})).status).toBe(200)
  })

  it('20 concurrent creates at limit − 1: exactly one succeeds', async () => {
    const current = await contactCount(owner.tenantId)
    await override(owner.tenantId, 'max_contacts', current + 1)
    const results = await Promise.all(
      Array.from({ length: 20 }, () => owner.client.post('/contacts', { phone: phone() })),
    )
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 422)).toHaveLength(19)
    expect(await contactCount(owner.tenantId)).toBe(current + 1)
  })
})

describe('Phase 11 Step 4: inbound is never refused', { timeout: 60_000 }, () => {
  it('a customer writing in at the contact limit still creates the contact and the message', async () => {
    const w = await campaignWorld(api, mock.url, 'sub-inbound')
    const at = await contactCount(w.owner.tenantId)
    await override(w.owner.tenantId, 'max_contacts', at)
    const from = `9195${String(Math.random()).slice(2, 10)}`
    const res = await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(w.ids, { from, wamid: `wamid.${metaId()}`, text: 'Hi', name: 'Asha' }),
    )
    expect(res).toBe(200)
    let found = 0
    for (let i = 0; i < 50 && !found; i++) {
      found = await db.withTenant(w.owner.tenantId, (tx) =>
        tx.message.count({ where: { direction: 'INBOUND', contact: { phoneE164: `+${from}` } } }),
      )
      if (!found) await new Promise((r) => setTimeout(r, 200))
    }
    expect(found).toBe(1)
    expect(await contactCount(w.owner.tenantId)).toBe(at + 1) // over the limit, by design
    // …while a person creating one more is still refused.
    expect((await w.owner.client.post('/contacts', { phone: phone() })).status).toBe(422)
  })
})

describe('Phase 11 Step 4: team-member limit', { timeout: 60_000 }, () => {
  it('pending invitations count; inviting past the limit is refused', async () => {
    const owner = await createOwner(api, 'sub-users')
    await override(owner.tenantId, 'max_users', 2)
    const email = () => `sub-${metaId()}@fenwira.test`
    expect(
      (await owner.client.post('/team/invitations', { email: email(), role: 'AGENT' })).status,
    ).toBe(201)
    const refused = await owner.client.post('/team/invitations', { email: email(), role: 'AGENT' })
    expect(refused.status).toBe(422)
    expect(refused.body.error.details).toMatchObject({ key: 'max_users', limit: 2, current: 2 })
  })
})

describe('Phase 11 Step 4: downgrade keeps active automations', { timeout: 90_000 }, () => {
  it('flows above a lowered limit stay active; publishing another is refused', async () => {
    const owner = await createOwner(api, 'sub-flows')
    const ids: string[] = []
    for (let i = 0; i < 3; i++)
      ids.push(await createFlow(owner, `Flow ${i}`, chain(keyword(`kw${i}`), text('t', 'hi'))))
    await override(owner.tenantId, 'max_active_flows', 1) // "downgrade": 3 active, limit 1
    const flows = (await owner.client.get('/flows')).body.data as Array<{
      id: string
      status: string
    }>
    expect(flows.filter((f) => ids.includes(f.id)).every((f) => f.status === 'ACTIVE')).toBe(true)
    const draft = await owner.client.post('/flows', {
      name: 'One more',
      priority: 100,
      reentryPolicy: 'ALWAYS',
    })
    const id = draft.body.data.id as string
    const d = await owner.client.get(`/flows/${id}/draft`)
    await owner.client.put(
      `/flows/${id}/draft`,
      { graph: chain(keyword('more'), text('t', 'hi')) },
      { 'If-Match': d.body.data.etag },
    )
    const pub = await owner.client.post(`/flows/${id}/publish`, {}, { 'Idempotency-Key': metaId() })
    expect(pub.status).toBe(403)
    expect(pub.body.error.details).toMatchObject({ entitlement: 'max_active_flows', limit: 1 })
  })
})
