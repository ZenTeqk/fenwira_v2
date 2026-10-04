import { activatePlan, BillingMaintenanceProcessor } from '@fenwira/api/modules/billing'
import { WebhookEventsProcessor } from '@fenwira/api/modules/webhooks'
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
import {
  campaignOf,
  campaignWorld,
  draftCampaign,
  launch,
  metaId,
  seedContacts,
  waitFor,
} from './support/campaigns'
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

const tick = (now?: Date) => worker.get(BillingMaintenanceProcessor).tickSubscriptions(now)
const subOf = (tenantId: string) =>
  db.withTenant(tenantId, (tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId } }))
const setSub = (tenantId: string, data: Record<string, unknown>) =>
  db.withTenant(tenantId, (tx) =>
    tx.subscription.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    }),
  )
const lifecycleNotices = (tenantId: string) =>
  db.withTenant(tenantId, (tx) =>
    tx.notification.findMany({ where: { type: 'subscription.lifecycle' } }),
  )

describe('Phase 11 Step 4: trial lifecycle', { timeout: 120_000 }, () => {
  it('T-3 and T-1 notices are sent once each', async () => {
    const owner = await createOwner(api, 'sub-notice')
    await setSub(owner.tenantId, {
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + 2 * 86_400_000),
    })
    await tick()
    await tick()
    expect((await subOf(owner.tenantId)).noticesSent).toEqual(['T-3'])
    expect(await lifecycleNotices(owner.tenantId)).toHaveLength(1)
    await setSub(owner.tenantId, { trialEndsAt: new Date(Date.now() + 12 * 3_600_000) })
    await tick()
    expect((await subOf(owner.tenantId)).noticesSent).toEqual(['T-3', 'T-1'])
  })

  it('expiry: nothing deleted, inbound continues, billable sends and API refused, campaigns pause', async () => {
    const w = await campaignWorld(api, mock.url, 'sub-expire')
    const { tagId } = await seedContacts(db, w.owner.tenantId, `wave-${metaId()}`, [
      { utility: 'GRANTED', orderNo: '#1' },
    ])
    const key = await w.owner.client.post('/api-keys', { name: 'k', scopes: ['contacts.read'] })
    const token = key.body.data.secret as string
    const contactsBefore = await contactCount(w.owner.tenantId)

    await setSub(w.owner.tenantId, { status: 'TRIALING', trialEndsAt: new Date(Date.now() - 1000) })
    await tick()
    const sub = await subOf(w.owner.tenantId)
    expect(sub.status).toBe('EXPIRED')
    expect(await lifecycleNotices(w.owner.tenantId)).toHaveLength(1)
    const audit = await w.owner.client.get('/audit-logs?action=subscription.')
    expect(audit.body.data.map((a: { action: string }) => a.action)).toContain(
      'subscription.expired',
    )
    expect(await contactCount(w.owner.tenantId)).toBe(contactsBefore)

    // API keys stay, but authenticate to 403 ENTITLEMENT_REQUIRED.
    const apiCall = await w.owner.client.agent
      .post('/api/v1/contacts/search')
      .set({ Authorization: `Bearer ${token}` })
      .send({})
    expect(apiCall.status).toBe(403)
    expect((await w.owner.client.get('/api-keys')).body.data).toHaveLength(1)

    // A campaign launched now pauses with SUBSCRIPTION_INACTIVE instead of sending or failing.
    const c = await draftCampaign(w, tagId)
    expect((await launch(w, c.id)).status).toBe(200)
    const paused = await waitFor(
      () => campaignOf(w, c.id),
      (x) => x.status === 'PAUSED',
    )
    expect(paused.pauseReason).toBe('SUBSCRIPTION_INACTIVE')

    // Inbound still lands.
    const from = `9192${String(Math.random()).slice(2, 10)}`
    expect(
      await deliverWebhook(
        webhookUrl,
        SECRET,
        inboundMessageWebhook(w.ids, {
          from,
          wamid: `wamid.${metaId()}`,
          text: 'Hi',
          name: 'Ravi',
        }),
      ),
    ).toBe(200)
    await waitFor(
      () =>
        db.withTenant(w.owner.tenantId, (tx) =>
          tx.message.count({ where: { direction: 'INBOUND', contact: { phoneE164: `+${from}` } } }),
        ),
      (n) => n === 1,
    )
  })

  it('active subscriptions roll monthly, or end when cancelling at period end', async () => {
    const a = await createOwner(api, 'sub-roll-a')
    const b = await createOwner(api, 'sub-roll-b')
    const end = new Date(Date.now() - 1000)
    await setSub(a.tenantId, {
      status: 'ACTIVE',
      currentPeriodStart: new Date(0),
      currentPeriodEnd: end,
    })
    await setSub(b.tenantId, {
      status: 'ACTIVE',
      currentPeriodEnd: end,
      cancelAtPeriodEnd: true,
    })
    await tick()
    const rolled = await subOf(a.tenantId)
    expect(rolled.status).toBe('ACTIVE')
    expect(rolled.currentPeriodStart?.getTime()).toBe(end.getTime())
    expect(rolled.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000)
    expect((await subOf(b.tenantId)).status).toBe('CANCELLED')
  })
})

describe('Phase 11 Step 4: API and webhooks suspended by plan', { timeout: 60_000 }, () => {
  it('keeps keys and endpoints, reports meta.entitled, and creates no deliveries', async () => {
    const owner = await createOwner(api, 'sub-suspend')
    await owner.client.post('/api-keys', { name: 'k', scopes: ['contacts.read'] })
    const ep = await owner.client.post('/webhook-endpoints', {
      name: 'CRM',
      url: 'https://example.com/hook',
      events: ['contact.updated'],
    })
    const endpointId = ep.body.data.endpoint.id as string
    expect((await owner.client.get('/api-keys')).body.meta).toEqual({ entitled: true })

    await override(owner.tenantId, 'api_enabled', false)
    await override(owner.tenantId, 'webhooks_enabled', false)
    const keys = await owner.client.get('/api-keys')
    expect(keys.body.meta).toEqual({ entitled: false })
    expect(keys.body.data).toHaveLength(1)
    const eps = await owner.client.get('/webhook-endpoints')
    expect(eps.body.meta).toEqual({ entitled: false })
    expect(eps.body.data[0].status).toBe('ACTIVE') // not auto-disabled: regaining resumes delivery

    const processor = worker.get(WebhookEventsProcessor)
    const event = {
      eventId: crypto.randomUUID(),
      eventType: 'contact.updated' as const,
      tenantId: owner.tenantId,
      correlationId: null,
      occurredAt: new Date().toISOString(),
      payload: { contactId: crypto.randomUUID(), changedFields: ['name'] },
    }
    expect(await processor.fanOut(event)).toBe('suspended-by-plan')
    const deliveries = await db.withTenant(owner.tenantId, (tx) =>
      tx.webhookDelivery.count({ where: { endpointId } }),
    )
    expect(deliveries).toBe(0)

    // Regained: deliveries are created again, without any action on the endpoint.
    await override(owner.tenantId, 'webhooks_enabled', true)
    expect(await processor.fanOut({ ...event, eventId: crypto.randomUUID() })).toMatch(
      /^fanned-out:1/,
    )
  })
})

const activate = (tenantId: string, plan: string) =>
  db.withTenant(tenantId, (tx) =>
    activatePlan(tx, tenantId, plan, new Date(), { type: 'SYSTEM' }, 'GROWTH'),
  )

describe('Phase 11 Step 4: plans, subscription and entitlements API', { timeout: 90_000 }, () => {
  it('lists plans as data with no price; entitlements report usage and over-limit', async () => {
    const owner = await createOwner(api, 'sub-api')
    const plans = (await owner.client.get('/billing/plans')).body.data as Array<{
      key: string
      price: unknown
      entitlements: Record<string, unknown>
    }>
    expect(plans.map((p) => p.key)).toEqual(['STARTER', 'GROWTH', 'BUSINESS'])
    expect(plans.every((p) => p.price === null)).toBe(true)
    expect(plans[0]!.entitlements).toMatchObject({ max_contacts: 5000, api_enabled: false })

    await owner.client.post('/contacts', { phone: phone() })
    await override(owner.tenantId, 'max_contacts', 0)
    const ents = (await owner.client.get('/billing/entitlements')).body.data as Array<{
      key: string
      limit: number | null
      usage: number | null
      overLimit: boolean
    }>
    expect(ents.find((e) => e.key === 'max_contacts')).toMatchObject({
      limit: 0,
      usage: 1,
      overLimit: true,
    })

    const status = (await owner.client.get('/workspace/status')).body.data
    expect(status.subscription).toMatchObject({ status: 'TRIALING' })
    expect(status.subscription.trialDaysLeft).toBeGreaterThan(0)
    expect(status.wallet).toBeDefined()
  })

  it('OWNER requests a plan; an operator activates it; access returns', async () => {
    const owner = await createOwner(api, 'sub-request')
    const key = await owner.client.post('/api-keys', { name: 'k', scopes: ['contacts.read'] })
    const token = key.body.data.secret as string
    await setSub(owner.tenantId, { status: 'EXPIRED', trialEndsAt: new Date(Date.now() - 1000) })
    const call = () =>
      owner.client.agent
        .post('/api/v1/contacts/search')
        .set({ Authorization: `Bearer ${token}` })
        .send({})
    expect((await call()).status).toBe(403)

    const growth = (
      (await owner.client.get('/billing/plans')).body.data as Array<{ id: string; key: string }>
    ).find((p) => p.key === 'GROWTH')!
    const req = await owner.client.post('/billing/subscription/request', { planId: growth.id })
    expect(req.status).toBe(200)
    expect(req.body.data).toMatchObject({ status: 'EXPIRED', requestedPlan: { key: 'GROWTH' } })

    await activate(owner.tenantId, 'GROWTH')
    const sub = (await owner.client.get('/billing/subscription')).body.data
    expect(sub).toMatchObject({ status: 'ACTIVE', plan: { key: 'GROWTH' }, requestedPlan: null })
    expect((await call()).status).toBe(200)
    const audit = await owner.client.get('/audit-logs?action=subscription.')
    const actions = audit.body.data.map((a: { action: string }) => a.action)
    expect(actions).toEqual(
      expect.arrayContaining(['subscription.plan_requested', 'subscription.activated']),
    )
  })

  it('a downgrade keeps the old analytics window for 30 days (P11-D28)', async () => {
    const owner = await createOwner(api, 'sub-retention')
    await activate(owner.tenantId, 'BUSINESS')
    await activate(owner.tenantId, 'STARTER')
    const grace = await db.withTenant(owner.tenantId, (tx) =>
      tx.tenantEntitlementOverride.findUniqueOrThrow({
        where: { tenantId_key: { tenantId: owner.tenantId, key: 'analytics_retention' } },
      }),
    )
    expect(grace.value).toBe(365)
    const days = (grace.expiresAt!.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThanOrEqual(30)
    // Everything else follows STARTER immediately (P11-D26).
    const ents = (await owner.client.get('/billing/entitlements')).body.data as Array<{
      key: string
      limit: number | null
      enabled: boolean | null
    }>
    expect(ents.find((e) => e.key === 'max_contacts')!.limit).toBe(5000)
    expect(ents.find((e) => e.key === 'api_enabled')!.enabled).toBe(false)
    expect(ents.find((e) => e.key === 'analytics_retention')!.limit).toBe(365)
  })
})
