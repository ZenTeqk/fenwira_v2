import { ResponseAlertsProcessor } from '@fenwira/api/modules/response-alerts'
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

/** Missed-enquiry alerts (docs/RESPONSE_ALERTS.md). */
const SECRET = 'alerts-test-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string

const MIN = 60_000
const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const customer = () => `9198${String(Math.random()).slice(2, 10)}`
const key = () => `k-${metaId()}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })

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

type Ws = {
  owner: Member
  manager: Member
  agent: Member
  ids: { wabaId: string; phoneNumberId: string }
}
/** Every day open almost all day, so the test never depends on the wall clock. */
const ALL_DAY = {
  timezone: 'Asia/Kolkata',
  week: Array.from({ length: 7 }, () => ({ closed: false, open: '00:00', close: '23:59' })),
  holidays: [],
}

async function workspace(label: string, alerts: Record<string, unknown> | null = {}): Promise<Ws> {
  const owner = await createOwner(api, label)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
  expect(
    (
      await owner.client.post('/whatsapp/connections/dev', {
        ...ids,
        accessToken: `mock-dev:${ids.wabaId}`,
      })
    ).status,
  ).toBe(201)
  await owner.client.patch('/workspace', { salesFollowupsEnabled: true })
  expect((await owner.client.put('/reply-studio/business-hours', ALL_DAY)).status).toBe(200)
  const manager = await addMember(api, owner, 'MANAGER', `${label}-mgr`)
  const agent = await addMember(api, owner, 'AGENT', `${label}-agent`)
  if (alerts) {
    const res = await owner.client.patch('/inbox/response-alerts', {
      enabled: true,
      unassignedMinutes: 30,
      responseMinutes: 60,
      escalationMinutes: 90,
      escalationUserIds: [await userId(manager)],
      ...alerts,
    })
    expect(res.status, res.text).toBe(200)
  }
  return { owner, manager, agent, ids }
}

const inbound = (w: Ws, from: string, text: string) =>
  deliverWebhook(
    webhookUrl,
    SECRET,
    inboundMessageWebhook(w.ids, { from, wamid: `wamid.${metaId()}`, text }),
  )
const userId = async (m: Member) => (await m.client.me()).body.data.user.id as string
const notifications = async (m: Member, type: string) =>
  (
    (await m.client.get('/notifications')).body.data as Array<{
      type: string
      link: string
      body: string
    }>
  ).filter((n) => n.type === type)

async function conversationOf(w: Ws, from: string) {
  return (await waitFor(
    async () =>
      (
        (await w.owner.client.get('/conversations?view=all&limit=100')).body.data as Array<{
          id: string
          contact: { id: string; phoneE164: string }
          waiting: { since: string; botHandling: boolean } | null
        }>
      ).find((c) => c.contact.phoneE164 === `+${from}`),
    (c) => !!c,
  ))!
}

const episodes = (w: Ws, conversationId: string) =>
  db.withTenant(w.owner.tenantId, (tx) =>
    tx.conversationWaitEpisode.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    }),
  )
const openEpisode = async (w: Ws, conversationId: string) =>
  (await episodes(w, conversationId)).find((e) => !e.endedAt)

const alerts = () => worker.get(ResponseAlertsProcessor)
/** Runs the once-a-minute check as if it were `minutes` after the customer's first message. */
const checkAt = async (start: Date, minutes: number) =>
  alerts().sweep(new Date(start.getTime() + minutes * MIN))

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

describe('settings', () => {
  it('starts disabled with the suggested values; only managers configure it', async () => {
    const w = await workspace('ra-settings', null)
    const s = (await w.manager.client.get('/inbox/response-alerts')).body.data
    expect(s).toMatchObject({
      enabled: false,
      unassignedMinutes: 5,
      responseMinutes: 15,
      escalationMinutes: 30,
      workspaceTimezone: 'Asia/Kolkata',
      businessHoursConfigured: true,
    })
    expect((await w.agent.client.get('/inbox/response-alerts')).status).toBe(403)
    const order = await w.manager.client.patch('/inbox/response-alerts', {
      responseMinutes: 30,
      escalationMinutes: 30,
    })
    expect(order.status).toBe(400)
    // Agents can't be escalation recipients.
    const bad = await w.manager.client.patch('/inbox/response-alerts', {
      escalationUserIds: [await userId(w.agent)],
    })
    expect(bad.status).toBe(400)
    // Turning it on with no recipients surfaces a configuration issue.
    const on = await w.manager.client.patch('/inbox/response-alerts', { enabled: true })
    expect(on.body.data.issue?.code).toBe('NO_ESCALATION_RECIPIENT')
    expect(on.body.data.enabledAt).not.toBeNull()
  })
})

describe('waiting episodes and alerts', () => {
  it('alerts once per level, keeps the oldest wait, and assignment does not reset it', async () => {
    const w = await workspace('ra-levels')
    const from = customer()
    await inbound(w, from, 'Do you deliver to Pune?')
    const c = await conversationOf(w, from)
    const first = await waitFor(
      () => openEpisode(w, c.id),
      (e) => !!e,
    )
    const start = first!.startedAt
    expect(first!.clockStartedAt?.getTime()).toBe(start.getTime())
    // A second message doesn't reset the wait.
    await inbound(w, from, 'Hello??')
    await new Promise((r) => setTimeout(r, 600))
    expect((await episodes(w, c.id)).length).toBe(1)
    expect((await openEpisode(w, c.id))!.startedAt.getTime()).toBe(start.getTime())
    expect((await conversationOf(w, from)).waiting?.since).toBe(start.toISOString())

    // 45 business minutes: unassigned alert to everyone who can assign (owner and manager).
    await checkAt(start, 45)
    await checkAt(start, 46) // a second check never repeats a level
    expect(await notifications(w.manager, 'response_alert.unassigned')).toHaveLength(1)
    expect(await notifications(w.owner, 'response_alert.unassigned')).toHaveLength(1)
    expect(await notifications(w.agent, 'response_alert.unassigned')).toHaveLength(0)
    const [n] = await notifications(w.manager, 'response_alert.unassigned')
    expect(n!.link).toBe(`/inbox?c=${c.id}&ws=${w.owner.tenantId}`)
    expect(n!.body).not.toContain('Pune') // never the message text

    // Assignment clears the unassigned condition but not the wait.
    await w.owner.client.post(`/conversations/${c.id}/assign`, {
      assigneeId: await userId(w.agent),
    })
    await new Promise((r) => setTimeout(r, 500))
    expect((await openEpisode(w, c.id))!.startedAt.getTime()).toBe(start.getTime())
    await checkAt(start, 75)
    expect(await notifications(w.agent, 'response_alert.response')).toHaveLength(1)
    expect(await notifications(w.manager, 'response_alert.response')).toHaveLength(0)
    await checkAt(start, 110)
    await checkAt(start, 120)
    expect(await notifications(w.manager, 'response_alert.escalation')).toHaveLength(1)
    expect(await notifications(w.owner, 'response_alert.escalation')).toHaveLength(0)
  })

  it('a failed staff send keeps waiting; an accepted one ends it and suppresses later alerts', async () => {
    const w = await workspace('ra-reply')
    const from = customer()
    await inbound(w, from, 'Need help')
    const c = await conversationOf(w, from)
    const ep = await waitFor(
      () => openEpisode(w, c.id),
      (e) => !!e,
    )
    const path = `${w.ids.phoneNumberId}/messages`
    await control('fail', {
      pathContains: path,
      method: 'POST',
      status: 400,
      code: 131026,
      times: 1,
    })
    const failing = await w.owner.client.post(
      `/conversations/${c.id}/messages`,
      { content: { type: 'TEXT', text: 'This one fails' } },
      { 'Idempotency-Key': key() },
    )
    await waitFor(
      async () => (await w.owner.client.get(`/messages/${failing.body.data.id}`)).body.data.status,
      (s) => s === 'FAILED',
    )
    // Past the customer's (whole-second) timestamp, so the reply is clearly later.
    await new Promise((r) => setTimeout(r, 1100))
    expect((await openEpisode(w, c.id))?.id).toBe(ep!.id)

    await w.owner.client.post(
      `/conversations/${c.id}/messages`,
      { content: { type: 'TEXT', text: 'Happy to help!' } },
      { 'Idempotency-Key': key() },
    )
    const ended = await waitFor(
      async () => (await episodes(w, c.id)).find((e) => e.id === ep!.id),
      (e) => !!e?.endedAt,
    )
    expect(ended!.endReason).toBe('STAFF_REPLY')
    expect((await conversationOf(w, from)).waiting).toBeNull()
    await checkAt(ep!.startedAt, 200)
    for (const type of ['unassigned', 'response', 'escalation'])
      expect(await notifications(w.manager, `response_alert.${type}`)).toHaveLength(0)

    // A new customer message after the reply starts a new episode.
    await inbound(w, from, 'Thanks, one more question')
    const next = await waitFor(
      () => openEpisode(w, c.id),
      (e) => !!e && e.id !== ep!.id,
    )
    expect(next!.startedAt.getTime()).toBeGreaterThan(ep!.startedAt.getTime())
  }, 45_000)

  it('an automated acknowledgement does not end the wait; resolving does', async () => {
    const w = await workspace('ra-ack')
    const from = customer()
    await inbound(w, from, 'Hello')
    const c = await conversationOf(w, from)
    const ep = await waitFor(
      () => openEpisode(w, c.id),
      (e) => !!e,
    )
    const ack = await db.withTenant(w.owner.tenantId, (tx) =>
      tx.message.create({
        data: {
          tenantId: w.owner.tenantId,
          conversationId: c.id,
          contactId: c.contact.id,
          direction: 'OUTBOUND',
          type: 'TEXT',
          status: 'SENT',
          source: 'AUTOMATION',
          content: { type: 'TEXT', text: 'Thanks! We will reply soon.' },
        },
      }),
    )
    expect(await alerts().staffReply(w.owner.tenantId, ack.id)).toBe('none')
    expect((await openEpisode(w, c.id))?.id).toBe(ep!.id)
    await w.owner.client.post(`/conversations/${c.id}/status`, { status: 'RESOLVED' })
    const ended = await waitFor(
      async () => (await episodes(w, c.id)).find((e) => e.id === ep!.id),
      (e) => !!e?.endedAt,
    )
    expect(ended!.endReason).toBe('RESOLVED')
  })

  it('does not run the staff timer while a bot handles the conversation; handover starts it', async () => {
    const w = await workspace('ra-bot')
    const from = customer()
    await inbound(w, from, 'Hi')
    const c = await conversationOf(w, from)
    const before = await waitFor(
      () => openEpisode(w, c.id),
      (e) => !!e,
    )
    // A bot menu waiting for the customer's answer (Reply Studio).
    await db.withTenant(w.owner.tenantId, async (tx) => {
      const f = await tx.flow.create({ data: { tenantId: w.owner.tenantId, name: 'Bot' } })
      const v = await tx.flowVersion.create({
        data: { tenantId: w.owner.tenantId, flowId: f.id, version: 1, graph: {} },
      })
      await tx.automationExecution.create({
        data: {
          tenantId: w.owner.tenantId,
          flowId: f.id,
          flowVersionId: v.id,
          contactId: c.contact.id,
          conversationId: c.id,
          triggerEvent: {},
          status: 'WAITING',
          context: { reply: { promptNode: 'menu' } },
        },
      })
    })
    // The check sees the bot: the timer stops and nothing fires, however long it takes.
    await checkAt(before!.startedAt, 1)
    const paused = await openEpisode(w, c.id)
    expect(paused).toMatchObject({ botHandling: true, clockStartedAt: null, nextCheckAt: null })
    await checkAt(before!.startedAt, 300)
    expect(await notifications(w.manager, 'response_alert.unassigned')).toHaveLength(0)
    expect((await conversationOf(w, from)).waiting?.botHandling).toBe(true)

    // Handover: the staff timer starts at the handover, not at the first message.
    const handoverAt = Date.now()
    await w.owner.client.post(`/conversations/${c.id}/automation-state`, {
      state: 'AGENT_TAKEOVER',
    })
    const running = await waitFor(
      () => openEpisode(w, c.id),
      (e) => !!e && !e.botHandling && !!e.clockStartedAt,
    )
    expect(running!.clockStartedAt!.getTime()).toBeGreaterThanOrEqual(handoverAt - 1000)
    // 31 minutes after the first message (but only a moment after handover): nothing yet.
    await alerts().sweep(new Date(running!.clockStartedAt!.getTime() + 20 * MIN))
    expect(await notifications(w.manager, 'response_alert.unassigned')).toHaveLength(0)
    await alerts().sweep(new Date(running!.clockStartedAt!.getTime() + 45 * MIN))
    expect(await notifications(w.manager, 'response_alert.unassigned')).toHaveLength(1)
  })

  it('surfaces a configuration issue instead of escalating to no one, and never crosses workspaces', async () => {
    const w = await workspace('ra-issue', { escalationUserIds: [] })
    const other = await workspace('ra-issue-b')
    const from = customer()
    await inbound(w, from, 'Hello')
    const c = await conversationOf(w, from)
    const ep = await waitFor(
      () => openEpisode(w, c.id),
      (e) => !!e,
    )
    await w.owner.client.post(`/conversations/${c.id}/assign`, {
      assigneeId: await userId(w.agent),
    })
    await checkAt(ep!.startedAt, 120)
    expect(await notifications(w.manager, 'response_alert.escalation')).toHaveLength(0)
    expect(await notifications(w.owner, 'response_alert.escalation')).toHaveLength(0)
    const s = (await w.owner.client.get('/inbox/response-alerts')).body.data
    expect(s.issue?.code).toBe('NO_ESCALATION_RECIPIENT')
    for (const m of [other.owner, other.manager, other.agent])
      expect(
        ((await m.client.get('/notifications')).body.data as Array<{ type: string }>).filter((n) =>
          n.type.startsWith('response_alert.'),
        ),
      ).toHaveLength(0)
  })

  it('never alerts for time that passed before alerts were turned on', async () => {
    const w = await workspace('ra-history', null)
    const from = customer()
    await inbound(w, from, 'Hello')
    const c = await conversationOf(w, from)
    const ep = await waitFor(
      () => openEpisode(w, c.id),
      (e) => !!e,
    )
    // Pretend the customer has waited two hours already, then turn alerts on.
    await db.withTenant(w.owner.tenantId, (tx) =>
      tx.conversationWaitEpisode.update({
        where: { id: ep!.id },
        data: {
          startedAt: new Date(Date.now() - 120 * MIN),
          clockStartedAt: new Date(Date.now() - 120 * MIN),
        },
      }),
    )
    await w.owner.client.patch('/inbox/response-alerts', {
      enabled: true,
      unassignedMinutes: 30,
      responseMinutes: 60,
      escalationMinutes: 90,
      escalationUserIds: [await userId(w.manager)],
    })
    await alerts().sweep(new Date(Date.now() + 1000))
    for (const type of ['unassigned', 'response', 'escalation'])
      expect(await notifications(w.manager, `response_alert.${type}`)).toHaveLength(0)
  })
})
