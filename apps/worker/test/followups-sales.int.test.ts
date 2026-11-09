import { SalesEventsProcessor } from '@fenwira/api/modules/sales'
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
import { bootApi, bootWorker } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'

/** Follow-ups and simple sales stages (docs/FOLLOW_UPS_AND_SALES.md). */
const SECRET = 'followups-test-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const customer = () => `9197${String(Math.random()).slice(2, 10)}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

async function waitFor<T>(load: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let value = await load()
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`)
    await new Promise((r) => setTimeout(r, 150))
    value = await load()
  }
  return value
}

type Ws = { owner: Member; ids: { wabaId: string; phoneNumberId: string } }
async function workspace(label: string, enabled = true): Promise<Ws> {
  const owner = await createOwner(api, label)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
  const res = await owner.client.post('/whatsapp/connections/dev', {
    ...ids,
    accessToken: `mock-dev:${ids.wabaId}`,
  })
  expect(res.status, res.text).toBe(201)
  if (enabled)
    expect((await owner.client.patch('/workspace', { salesFollowupsEnabled: true })).status).toBe(
      200,
    )
  return { owner, ids }
}

const inbound = (w: Ws, from: string, text: string) =>
  deliverWebhook(
    webhookUrl,
    SECRET,
    inboundMessageWebhook(w.ids, { from, wamid: `wamid.${metaId()}`, text }),
  )

async function conversationOf(w: Ws, from: string) {
  return (await waitFor(
    async () =>
      (
        (await w.owner.client.get('/conversations?view=all&limit=100')).body.data as Array<{
          id: string
          contact: { id: string; phoneE164: string }
        }>
      ).find((c) => c.contact.phoneE164 === `+${from}`),
    (c) => !!c,
  ))!
}

const userId = async (m: Member) => (await m.client.me()).body.data.user.id as string
const notifications = async (m: Member, type: string) =>
  (
    (await m.client.get('/notifications')).body.data as Array<{ type: string; link: string }>
  ).filter((n) => n.type === type)

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  webhookUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}/api/v1/webhooks/whatsapp`
  mock.state.webhookTarget = { url: webhookUrl, appSecret: SECRET, statuses: [], delayMs: 20 }
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 2 })
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('rollout switch', () => {
  it('is off by default: reads are empty, writes are refused, nothing appears in /auth/me', async () => {
    const w = await workspace('fu-off', false)
    const from = customer()
    await inbound(w, from, 'Hello')
    const c = await conversationOf(w, from)
    const me = (await w.owner.client.me()).body.data.memberships[0]
    expect(me.salesFollowups).toBe(false)
    expect((await w.owner.client.get('/follow-ups')).body.data).toEqual([])
    const create = await w.owner.client.post('/follow-ups', {
      contactId: c.contact.id,
      title: 'Call back',
      dueAt: inMinutes(60),
    })
    expect([create.status, create.body.error.code]).toEqual([403, 'FEATURE_NOT_ENABLED'])
    // No waiting episodes are tracked while it is off.
    const episodes = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.conversationWaitEpisode.count(),
    )
    expect(episodes).toBe(0)
  })
})

describe('follow-ups', () => {
  it('defaults the assignee to the conversation owner and lists Today / Overdue / Upcoming', async () => {
    const w = await workspace('fu-basic')
    const agent = await addMember(api, w.owner, 'AGENT', 'fuagent')
    const agentId = await userId(agent)
    const from = customer()
    await inbound(w, from, 'Price for 2 units?')
    const c = await conversationOf(w, from)
    await w.owner.client.post(`/conversations/${c.id}/assign`, { assigneeId: agentId })

    const created = await w.owner.client.post('/follow-ups', {
      contactId: c.contact.id,
      conversationId: c.id,
      title: 'Send the quote',
      dueAt: inMinutes(-5),
    })
    expect(created.status, created.text).toBe(201)
    expect(created.body.data).toMatchObject({
      assignee: { id: agentId },
      status: 'PENDING',
      overdue: true,
      conversationId: c.id,
    })
    // Unassigned conversation → the creator.
    const own = await agent.client.post('/follow-ups', {
      contactId: c.contact.id,
      title: 'Check stock',
      dueAt: inMinutes(60 * 24 * 3),
    })
    expect(own.body.data.assignee.id).toBe(agentId)

    const counts = (await agent.client.get('/follow-ups/counts')).body.data
    expect(counts.overdue).toBe(1)
    expect(counts.upcoming).toBe(1)
    const overdue = (await agent.client.get('/follow-ups?tab=overdue')).body.data
    expect(overdue.map((f: { title: string }) => f.title)).toEqual(['Send the quote'])
    expect((await agent.client.get('/follow-ups/summary')).body.data.overdue).toBe(1)

    // The due reminder reaches the assignee once, linking to the conversation and workspace.
    const due = await waitFor(
      () => notifications(agent, 'follow_up.due'),
      (n) => n.length === 1,
    )
    expect(due[0]!.link).toBe(`/inbox?c=${c.id}&ws=${w.owner.tenantId}`)
    // The new assignee also got an "assigned to you" notice (the owner created it for them).
    expect(await notifications(agent, 'follow_up.assigned')).toHaveLength(1)
  })

  it('enforces team scope and object-level access', async () => {
    const w = await workspace('fu-access')
    const a1 = await addMember(api, w.owner, 'AGENT', 'fua1')
    const a2 = await addMember(api, w.owner, 'AGENT', 'fua2')
    const manager = await addMember(api, w.owner, 'MANAGER', 'fumgr')
    const viewer = await addMember(api, w.owner, 'VIEWER', 'fuview')
    const from = customer()
    await inbound(w, from, 'Hi')
    const c = await conversationOf(w, from)
    const f = (
      await a1.client.post('/follow-ups', {
        contactId: c.contact.id,
        title: 'Mine',
        dueAt: inMinutes(30),
      })
    ).body.data
    expect((await a2.client.get(`/follow-ups/${f.id}`)).status).toBe(404)
    expect((await a2.client.post(`/follow-ups/${f.id}/complete`)).status).toBe(404)
    expect((await a2.client.get('/follow-ups?scope=team')).status).toBe(403)
    expect((await viewer.client.post(`/follow-ups/${f.id}/complete`)).status).toBe(403)
    // An agent can't hand their task to an inactive or unknown person.
    const bad = await a1.client.post(`/follow-ups/${f.id}/reassign`, {
      assigneeId: '0192a8f0-0000-7000-8000-00000000abcd',
    })
    expect(bad.status).toBe(400)
    // A viewer can't be an assignee (no followups.write).
    const toViewer = await manager.client.post(`/follow-ups/${f.id}/reassign`, {
      assigneeId: await userId(viewer),
    })
    expect(toViewer.status).toBe(400)
    // Due in 30 minutes: Today, or Upcoming when that crosses workspace midnight.
    const team = [
      ...(await manager.client.get('/follow-ups?scope=team&tab=today')).body.data,
      ...(await manager.client.get('/follow-ups?scope=team&tab=upcoming')).body.data,
    ]
    expect(team.some((x: { id: string }) => x.id === f.id)).toBe(true)
    const moved = await manager.client.post(`/follow-ups/${f.id}/reassign`, {
      assigneeId: await userId(a2),
    })
    expect(moved.status, moved.text).toBe(200)
    expect((await a2.client.get(`/follow-ups/${f.id}`)).status).toBe(200)

    // Another workspace can't see or act on it at all.
    const other = await workspace('fu-access-b')
    expect((await other.owner.client.get(`/follow-ups/${f.id}`)).status).toBe(404)
    expect((await other.owner.client.post(`/follow-ups/${f.id}/cancel`)).status).toBe(404)
  })

  it('makes reminder jobs for older versions, cancelled and completed follow-ups harmless', async () => {
    const w = await workspace('fu-stale')
    const from = customer()
    await inbound(w, from, 'Hi')
    const c = await conversationOf(w, from)
    const reminders = worker.get(SalesEventsProcessor)
    const f = (
      await w.owner.client.post('/follow-ups', {
        contactId: c.contact.id,
        title: 'Reschedule me',
        dueAt: inMinutes(60),
      })
    ).body.data
    expect(f.version).toBe(1)
    // Version 1's job fires early: nothing (not due).
    expect(await reminders.notifyDue(w.owner.tenantId, f.id, 1)).toBe('early')
    const moved = await w.owner.client.post(`/follow-ups/${f.id}/reschedule`, {
      dueAt: inMinutes(-1),
      version: 1,
    })
    expect(moved.body.data.version).toBe(2)
    // A stale version is rejected for writes (optimistic concurrency) …
    const stale = await w.owner.client.post(`/follow-ups/${f.id}/complete`, { version: 1 })
    expect([stale.status, stale.body.error.code]).toEqual([409, 'VERSION_CONFLICT'])
    // … and for reminders.
    expect(await reminders.notifyDue(w.owner.tenantId, f.id, 1)).toBe('stale')
    // Duplicate deliveries of the current version notify exactly once.
    const outcomes = await Promise.all([
      reminders.notifyDue(w.owner.tenantId, f.id, 2),
      reminders.notifyDue(w.owner.tenantId, f.id, 2),
      reminders.notifyDue(w.owner.tenantId, f.id, null),
    ])
    expect(outcomes.filter((o) => o === 'notified').length).toBeLessThanOrEqual(1)
    await waitFor(
      () => notifications(w.owner, 'follow_up.due'),
      (n) => n.length === 1,
    )
    expect(await notifications(w.owner, 'follow_up.due')).toHaveLength(1)

    // Cancelled: its armed job does nothing.
    const g = (
      await w.owner.client.post('/follow-ups', {
        contactId: c.contact.id,
        title: 'Cancel me',
        dueAt: inMinutes(30),
      })
    ).body.data
    expect((await w.owner.client.post(`/follow-ups/${g.id}/cancel`)).body.data.status).toBe(
      'CANCELLED',
    )
    expect(
      await reminders.notifyDue(w.owner.tenantId, g.id, 1, new Date(Date.now() + 3600_000)),
    ).toBe('closed')
    // Completed: same; and closed follow-ups can't be changed again.
    const h = (
      await w.owner.client.post('/follow-ups', {
        contactId: c.contact.id,
        title: 'Complete me',
        dueAt: inMinutes(30),
      })
    ).body.data
    await w.owner.client.post(`/follow-ups/${h.id}/complete`)
    expect(
      await reminders.notifyDue(w.owner.tenantId, h.id, 1, new Date(Date.now() + 3600_000)),
    ).toBe('closed')
    expect(
      (await w.owner.client.post(`/follow-ups/${h.id}/reschedule`, { dueAt: inMinutes(5) })).status,
    ).toBe(409)
    // Every change is audited.
    const audit = (await w.owner.client.get('/audit-logs?limit=100')).body.data as Array<{
      action: string
    }>
    for (const action of [
      'follow_up.created',
      'follow_up.rescheduled',
      'follow_up.cancelled',
      'follow_up.completed',
    ])
      expect(
        audit.some((a) => a.action === action),
        action,
      ).toBe(true)
  })

  it('recovers due reminders after the worker was down', async () => {
    const w = await workspace('fu-restart')
    const from = customer()
    await inbound(w, from, 'Hi')
    const c = await conversationOf(w, from)
    await worker.close()
    const f = (
      await w.owner.client.post('/follow-ups', {
        contactId: c.contact.id,
        title: 'Due while the worker is down',
        dueAt: new Date(Date.now() + 1500).toISOString(),
      })
    ).body.data
    await new Promise((r) => setTimeout(r, 2500))
    expect(await notifications(w.owner, 'follow_up.due')).toHaveLength(0)
    worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
    await waitFor(
      () => notifications(w.owner, 'follow_up.due'),
      (n) => n.length === 1,
    )
    // The sweep alone also recovers one whose delayed job vanished (Redis loss): simulate it by
    // marking another due follow-up as never armed and running the sweep.
    const g = (
      await w.owner.client.post('/follow-ups', {
        contactId: c.contact.id,
        title: 'Lost job',
        dueAt: inMinutes(120),
      })
    ).body.data
    await db.withTenant(w.owner.tenantId, (tx) =>
      tx.followUp.update({ where: { id: g.id }, data: { dueAt: new Date(Date.now() - 1000) } }),
    )
    // (The worker's own once-a-minute sweep may get there first; either way it is one reminder.)
    await worker.get(SalesEventsProcessor).sweep()
    await waitFor(
      () => notifications(w.owner, 'follow_up.due'),
      (n) => n.length === 2,
    )
    void f
  })

  it('flags a pending follow-up when the customer replies, without completing it', async () => {
    const w = await workspace('fu-reply')
    const from = customer()
    await inbound(w, from, 'Hi')
    const c = await conversationOf(w, from)
    const f = (
      await w.owner.client.post('/follow-ups', {
        contactId: c.contact.id,
        conversationId: c.id,
        title: 'Wait for their decision',
        dueAt: inMinutes(60),
      })
    ).body.data
    await new Promise((r) => setTimeout(r, 50))
    await inbound(w, from, 'Okay, I decided')
    const flagged = await waitFor(
      async () => (await w.owner.client.get(`/follow-ups/${f.id}`)).body.data,
      (x) => x.needsReview,
    )
    expect(flagged.status).toBe('PENDING')
    await inbound(w, from, 'Also, one more thing')
    await new Promise((r) => setTimeout(r, 800))
    expect(await notifications(w.owner, 'follow_up.customer_replied')).toHaveLength(1)
    // Resolving the conversation doesn't complete it either.
    await w.owner.client.post(`/conversations/${c.id}/status`, { status: 'RESOLVED' })
    expect((await w.owner.client.get(`/follow-ups/${f.id}`)).body.data.status).toBe('PENDING')
    // Nothing was sent to the customer.
    expect(
      mock.state.calls.filter((x) => x.path.endsWith(`${w.ids.phoneNumberId}/messages`)),
    ).toHaveLength(0)
  })
})

describe('sales stages and opportunities', () => {
  it('lets managers manage stages with stable ids, history kept', async () => {
    const w = await workspace('sales-stages')
    const agent = await addMember(api, w.owner, 'AGENT', 'stagent')
    const manager = await addMember(api, w.owner, 'MANAGER', 'stmgr')
    const stages = (await manager.client.get('/sales/stages')).body.data as Array<{
      id: string
      name: string
      outcome: string
    }>
    expect(stages.map((s) => s.name)).toEqual([
      'New enquiry',
      'Interested',
      'Quote sent',
      'Won',
      'Lost',
    ])
    expect((await agent.client.post('/sales/stages', { name: 'X', outcome: 'OPEN' })).status).toBe(
      403,
    )
    const added = await manager.client.post('/sales/stages', {
      name: 'Negotiation',
      outcome: 'OPEN',
    })
    expect(added.status).toBe(201)
    const names = added.body.data
      .filter((s: { archived: boolean }) => !s.archived)
      .map((s: { name: string }) => s.name)
    expect(names).toEqual(['New enquiry', 'Interested', 'Quote sent', 'Negotiation', 'Won', 'Lost'])
    const interested = stages[1]!
    const renamed = await manager.client.patch(`/sales/stages/${interested.id}`, {
      name: 'Warm lead',
    })
    expect(renamed.body.data.find((s: { id: string }) => s.id === interested.id).name).toBe(
      'Warm lead',
    )
    const dup = await manager.client.patch(`/sales/stages/${interested.id}`, { name: 'won' })
    expect(dup.status).toBe(400)
    // The only won stage can't be archived.
    const won = stages[3]!
    expect((await manager.client.patch(`/sales/stages/${won.id}`, { archived: true })).status).toBe(
      422,
    )
    const order = added.body.data
      .filter((s: { archived: boolean }) => !s.archived)
      .map((s: { id: string }) => s.id)
      .reverse()
    const reordered = await manager.client.put('/sales/stages/order', { ids: order })
    expect(reordered.status, reordered.text).toBe(200)
    expect(reordered.body.data[0].id).toBe(order[0])
  })

  it('tracks one open opportunity per customer, repeat purchases and stage history', async () => {
    const w = await workspace('sales-opps')
    const agent = await addMember(api, w.owner, 'AGENT', 'oppagent')
    const from = customer()
    await inbound(w, from, 'I want to buy')
    const c = await conversationOf(w, from)
    const stages = (await agent.client.get('/sales/stages')).body.data as Array<{
      id: string
      name: string
      outcome: string
    }>
    const byName = (n: string) => stages.find((s) => s.name === n)!.id

    const opp = await agent.client.post('/opportunities', {
      contactId: c.contact.id,
      conversationId: c.id,
      expectedValueMinor: 1234550,
    })
    expect(opp.status, opp.text).toBe(201)
    expect(opp.body.data).toMatchObject({
      status: 'OPEN',
      stage: { name: 'New enquiry' },
      expectedValueMinor: 1234550,
      currency: 'INR',
    })
    const second = await agent.client.post('/opportunities', { contactId: c.contact.id })
    expect([second.status, second.body.error.code]).toEqual([409, 'CONFLICT'])

    // Filters: by stage; the conversation's status and assignee are untouched.
    const filtered = (
      await agent.client.get(`/conversations?view=all&salesStageId=${byName('New enquiry')}`)
    ).body.data
    expect(filtered.map((x: { id: string }) => x.id)).toContain(c.id)
    const f = (
      await agent.client.post('/follow-ups', {
        contactId: c.contact.id,
        opportunityId: opp.body.data.id,
        title: 'Chase payment',
        dueAt: inMinutes(-1),
      })
    ).body.data
    expect(f.salesStage).toMatchObject({ name: 'New enquiry' })
    const overdue = (await agent.client.get('/conversations?view=all&overdueFollowUp=true')).body
      .data
    expect(overdue.map((x: { id: string }) => x.id)).toContain(c.id)

    await agent.client.patch(`/opportunities/${opp.body.data.id}`, {
      stageId: byName('Quote sent'),
    })
    // Closing as won keeps the follow-up pending unless asked.
    const wonRes = await agent.client.patch(`/opportunities/${opp.body.data.id}`, {
      stageId: byName('Won'),
    })
    expect(wonRes.body.data).toMatchObject({ status: 'WON', pendingFollowUps: 1 })
    expect((await agent.client.get(`/follow-ups/${f.id}`)).body.data.status).toBe('PENDING')
    const conv = (await agent.client.get(`/conversations/${c.id}`)).body.data
    expect(conv.status).toBe('OPEN')

    // Repeat purchase: a new opportunity, the old one stays as history.
    const repeat = await agent.client.post('/opportunities', { contactId: c.contact.id })
    expect(repeat.status).toBe(201)
    const lost = await agent.client.patch(`/opportunities/${repeat.body.data.id}`, {
      stageId: byName('Lost'),
      cancelPendingFollowUps: true,
    })
    expect(lost.body.data.status).toBe('LOST')
    // Reopening the first while none is open is fine; a second open is not.
    const third = await agent.client.post('/opportunities', { contactId: c.contact.id })
    expect(third.status).toBe(201)
    const reopen = await agent.client.patch(`/opportunities/${opp.body.data.id}`, {
      stageId: byName('Interested'),
    })
    expect(reopen.status).toBe(409)
    const history = (await agent.client.get(`/opportunities?contactId=${c.contact.id}`)).body.data
    expect(history).toHaveLength(3)

    const activity = (await agent.client.get(`/contacts/${c.contact.id}/activities`)).body
      .data as Array<{ type: string; data: Record<string, unknown> }>
    const types = activity.map((a) => a.type)
    for (const t of [
      'opportunity.created',
      'opportunity.stage_changed',
      'opportunity.won',
      'opportunity.lost',
    ])
      expect(types, t).toContain(t)
    expect(activity.find((a) => a.type === 'opportunity.won')?.data.stage).toBe('Won')

    // A stage with open opportunities can't be archived; history keeps archived stages.
    const archive = await w.owner.client.patch(`/sales/stages/${byName('New enquiry')}`, {
      archived: true,
    })
    expect(archive.status).toBe(422)
    const other = await workspace('sales-opps-b')
    expect((await other.owner.client.get(`/opportunities/${opp.body.data.id}`)).status).toBe(404)
    expect(
      (await other.owner.client.patch(`/opportunities/${opp.body.data.id}`, { title: 'x' })).status,
    ).toBe(404)
  })
})
