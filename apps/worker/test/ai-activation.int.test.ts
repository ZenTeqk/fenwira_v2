import { sha256 } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { waitFor } from './support/campaigns'
import { bootApi, bootWorker, type Client } from './support/harness'
import { createOperator } from './support/platform'
import { addMember, createOwner, type Member } from './support/workspace'

/**
 * AI Assistant activation requests (docs/AI_ASSISTANT.md → Activation requests): customer
 * request rules, RLS isolation, operator approve/reject effects, audit and notifications.
 */
const OPS = 'ai-ops@fenwira.test'
let api: INestApplication
let worker: INestApplication
let db: Database
let migration: Database
let operator: Client
let planId: string
const createdPlans: string[] = []

const request = (m: Member, body: Record<string, unknown> = {}) =>
  m.client.post('/ai/activation/requests', {
    planId,
    expectedConversations: 300,
    useCase: 'Answer delivery and pricing questions',
    contactEmail: m.email,
    contactPhone: '+91 98765 43210',
    ...body,
  })

const settings = (tenantId: string) =>
  db.withTenant(tenantId, (tx) => tx.aiSettings.findFirst({ where: { tenantId } }))
const outbox = (tenantId: string, eventType: string) =>
  db.withTenant(tenantId, (tx) => tx.outboxEvent.count({ where: { tenantId, eventType } }))
const audits = (tenantId: string, action: string) =>
  db.withTenant(tenantId, (tx) => tx.auditLog.count({ where: { tenantId, action } }))
const deliveries = (kind: string, email: string) =>
  migration.withGlobal((tx) =>
    tx.emailDelivery.count({ where: { kind, recipientHash: sha256(email.toLowerCase()) } }),
  )

beforeAll(async () => {
  api = await bootApi()
  worker = await bootWorker({ OPS_ALERT_EMAIL: OPS })
  db = Database.connect({ url: process.env.DATABASE_URL! })
  migration = Database.connect({ url: process.env.MIGRATION_DATABASE_URL! })
  operator = (await createOperator(api, db, migration, 'ai-operator')).client
  const plan = await operator.post('/platform/ai/plans', {
    name: 'Integration plan',
    monthlyPriceMinor: 99_900,
    currency: 'INR',
    includedReplies: 250,
    description: null,
    active: true,
    sortOrder: 1,
  })
  expect(plan.status, plan.text).toBe(201)
  planId = plan.body.data.id
  createdPlans.push(planId)
})

afterAll(async () => {
  // The test database is long-lived: never leave an active test plan behind.
  for (const id of createdPlans)
    await migration.withGlobal((tx) => tx.aiPlan.update({ where: { id }, data: { active: false } }))
  await api?.close()
  await worker?.close()
  await db?.disconnect()
  await migration?.disconnect()
})

describe('customer request', () => {
  it('shows active plans and the prefilled contact while the assistant is off', async () => {
    const owner = await createOwner(api, 'ai-req-state')
    const res = await owner.client.get('/ai/activation')
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ enabled: false, request: null })
    expect(res.body.data.contact.email).toBe(owner.email)
    const names = res.body.data.plans.map((p: { name: string }) => p.name)
    expect(names).toContain('Integration plan')
    // The seeded placeholder is inactive and never shown to customers.
    expect(names).not.toContain('Placeholder plan (edit before activating)')
  })

  it('stores one open request, rejects duplicates and notifies the operators', async () => {
    const owner = await createOwner(api, 'ai-req-dup')
    const first = await request(owner)
    expect(first.status, first.text).toBe(201)
    expect(first.body.data).toMatchObject({ status: 'REQUESTED', planName: 'Integration plan' })
    const again = await request(owner)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('AI_REQUEST_OPEN')
    expect(await outbox(owner.tenantId, 'ai.activation.requested')).toBe(1)
    expect(await audits(owner.tenantId, 'ai.activation_requested')).toBe(1)
    await waitFor(
      () => deliveries('other', OPS),
      (n) => n >= 1,
    )
    const state = await owner.client.get('/ai/activation')
    expect(state.body.data.request).toMatchObject({ id: first.body.data.id, status: 'REQUESTED' })
  })

  it('rejects unknown or inactive plans and invalid input', async () => {
    const owner = await createOwner(api, 'ai-req-invalid')
    const unknown = await request(owner, { planId: '0193a000-0000-7000-8000-000000000a11' })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error.code).toBe('AI_PLAN_UNAVAILABLE')
    const invalid = await request(owner, { useCase: 'short', expectedConversations: 0 })
    expect(invalid.status).toBe(400)
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED')
  })

  it('lets members without ai.manage read the page but not request or cancel', async () => {
    const owner = await createOwner(api, 'ai-req-perm')
    const agent = await addMember(api, owner, 'AGENT')
    expect((await agent.client.get('/ai/activation')).status).toBe(200)
    expect((await request(agent)).status).toBe(403)
    const created = await request(owner)
    expect(created.status).toBe(201)
    const cancel = await agent.client.post(`/ai/activation/requests/${created.body.data.id}/cancel`)
    expect(cancel.status).toBe(403)
  })

  it('cancels an open request once', async () => {
    const owner = await createOwner(api, 'ai-req-cancel')
    const created = await request(owner)
    const path = `/ai/activation/requests/${created.body.data.id}/cancel`
    const cancelled = await owner.client.post(path)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.status).toBe('CANCELLED')
    expect((await owner.client.post(path)).body.error.code).toBe('ALREADY_REVIEWED')
    // A cancelled request no longer blocks a new one.
    expect((await request(owner)).status).toBe(201)
  })
})

describe('isolation', () => {
  it('never shows or changes another workspace’s request', async () => {
    const a = await createOwner(api, 'ai-rls-a')
    const b = await createOwner(api, 'ai-rls-b')
    const created = await request(a)
    expect((await b.client.get('/ai/activation')).body.data.request).toBeNull()
    const cancel = await b.client.post(`/ai/activation/requests/${created.body.data.id}/cancel`)
    expect(cancel.status).toBe(404)
    expect(
      await db.withTenant(b.tenantId, (tx) =>
        tx.aiActivationRequest.count({ where: { id: created.body.data.id } }),
      ),
    ).toBe(0)
  })
})

describe('operator decisions', () => {
  it('approve turns the assistant on with the plan quota, audits and notifies', async () => {
    const owner = await createOwner(api, 'ai-approve')
    const created = await request(owner)
    expect((await owner.client.get('/ai/overview')).body.error.code).toBe('AI_NOT_ENABLED')
    const queue = await operator.get('/platform/ai/requests?status=REQUESTED')
    expect(queue.status).toBe(200)
    expect(queue.body.data.find((r: { id: string }) => r.id === created.body.data.id)).toMatchObject(
      { workspaceId: owner.tenantId, includedReplies: 250, expectedConversations: 300 },
    )
    const path = `/platform/ai/workspaces/${owner.tenantId}/requests/${created.body.data.id}`
    const approved = await operator.post(`${path}/approve`, { note: 'Welcome aboard' })
    expect(approved.status, approved.text).toBe(200)
    expect(approved.body.data).toMatchObject({
      alreadyEnabled: false,
      request: { status: 'APPROVED', decisionNote: 'Welcome aboard' },
    })
    expect(await settings(owner.tenantId)).toMatchObject({ enabled: true, monthlyMessageQuota: 250 })
    expect(await audits(owner.tenantId, 'ai.activation_approved')).toBe(1)
    expect(await outbox(owner.tenantId, 'ai.activation.decided')).toBe(1)
    expect((await owner.client.get('/ai/overview')).status).toBe(200)
    const notes = await waitFor(
      () =>
        db.withTenant(owner.tenantId, (tx) =>
          tx.notification.findMany({ where: { type: 'ai.activation_approved' } }),
        ),
      (rows) => rows.length > 0,
    )
    expect(notes[0]!.link).toBe('/ai-assistant')
    await waitFor(
      () => deliveries('ai_activation', owner.email),
      (n) => n === 1,
    )
    expect((await operator.post(`${path}/approve`, {})).body.error.code).toBe('ALREADY_REVIEWED')
  })

  it('approving an already-enabled workspace closes the request and changes nothing', async () => {
    const owner = await createOwner(api, 'ai-approve-noop')
    const created = await request(owner)
    await db.withTenant(owner.tenantId, (tx) =>
      tx.aiSettings.upsert({
        where: { tenantId: owner.tenantId },
        create: { tenantId: owner.tenantId, enabled: true, monthlyMessageQuota: 42 },
        update: { enabled: true, monthlyMessageQuota: 42 },
      }),
    )
    const res = await operator.post(
      `/platform/ai/workspaces/${owner.tenantId}/requests/${created.body.data.id}/approve`,
      {},
    )
    expect(res.body.data).toMatchObject({ alreadyEnabled: true, request: { status: 'APPROVED' } })
    expect(await settings(owner.tenantId)).toMatchObject({ enabled: true, monthlyMessageQuota: 42 })
    expect(await outbox(owner.tenantId, 'ai.activation.decided')).toBe(0)
  })

  it('reject records the note, keeps the assistant off, notifies and allows a new request', async () => {
    const owner = await createOwner(api, 'ai-reject')
    const created = await request(owner)
    const path = `/platform/ai/workspaces/${owner.tenantId}/requests/${created.body.data.id}`
    expect((await operator.post(`${path}/reject`, { note: '' })).status).toBe(400)
    const rejected = await operator.post(`${path}/reject`, { note: 'Please add a WhatsApp number' })
    expect(rejected.status).toBe(200)
    expect(rejected.body.data.request).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Please add a WhatsApp number',
    })
    expect((await settings(owner.tenantId))?.enabled ?? false).toBe(false)
    expect(await audits(owner.tenantId, 'ai.activation_rejected')).toBe(1)
    const state = await owner.client.get('/ai/activation')
    expect(state.body.data.request).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Please add a WhatsApp number',
    })
    await waitFor(
      () =>
        db.withTenant(owner.tenantId, (tx) =>
          tx.notification.count({ where: { type: 'ai.activation_rejected' } }),
        ),
      (n) => n > 0,
    )
    expect((await request(owner)).status).toBe(201)
  })

  it('plans: operators create, edit and deactivate; customers only see active plans', async () => {
    const created = await operator.post('/platform/ai/plans', {
      name: 'Temporary plan',
      monthlyPriceMinor: 0,
      currency: 'INR',
      includedReplies: 10,
      description: 'x',
      active: true,
      sortOrder: 9,
    })
    expect(created.status).toBe(201)
    createdPlans.push(created.body.data.id)
    const owner = await createOwner(api, 'ai-plans')
    const names = async () =>
      (await owner.client.get('/ai/activation')).body.data.plans.map((p: { name: string }) => p.name)
    expect(await names()).toContain('Temporary plan')
    const off = await operator.post(`/platform/ai/plans/${created.body.data.id}`, {
      ...created.body.data,
      active: false,
    })
    expect(off.status).toBe(200)
    expect(await names()).not.toContain('Temporary plan')
    expect((await owner.client.get('/platform/ai/plans')).status).toBe(401)
  })
})
