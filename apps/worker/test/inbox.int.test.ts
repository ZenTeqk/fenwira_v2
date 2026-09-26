import { InboxEventsProcessor } from '@fenwira/api/modules/inbox'
import { MessagingService } from '@fenwira/api/modules/messaging'
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
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker, Client } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'

/** Phase 7 acceptance (docs/prompts/PHASE_07_INBOX.md). */
const SECRET = 'inbox-test-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let apiUrl: string
let webhookUrl: string

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const customer = () => `9196${String(Math.random()).slice(2, 10)}`
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

type Ws = { owner: Member; ids: { wabaId: string; phoneNumberId: string } }
async function workspace(label: string): Promise<Ws> {
  const owner = await createOwner(api, label)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
  const res = await owner.client.post('/whatsapp/connections/dev', {
    ...ids,
    accessToken: `mock-dev:${ids.wabaId}`,
  })
  expect(res.status, res.text).toBe(201)
  return { owner, ids }
}

async function inbound(w: Ws, from: string, text: string, timestamp?: number) {
  return deliverWebhook(
    webhookUrl,
    SECRET,
    inboundMessageWebhook(w.ids, { from, wamid: `wamid.${metaId()}`, text, timestamp }),
  )
}

async function conversationOf(w: Ws, from: string, client = w.owner.client) {
  return waitFor(
    async () =>
      (
        (await client.get('/conversations?view=all&limit=100')).body.data as Array<{
          id: string
          contact: { phoneE164: string }
        }>
      ).find((c) => c.contact.phoneE164 === `+${from}`),
    (c) => !!c,
  ) as unknown as Promise<{ id: string; unreadCount: number; automationState: string }>
}

const reply = (m: Member, id: string, text: string) =>
  m.client.post(
    `/conversations/${id}/messages`,
    { content: { type: 'TEXT', text } },
    { 'Idempotency-Key': key() },
  )

async function socketFor(member: Member): Promise<Socket> {
  const login = await new Client(api).login(member.email)
  const cookie = ((login.headers['set-cookie'] as unknown as string[]) ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')
  const socket = io(apiUrl, {
    path: '/ws',
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie },
    auth: { tenantId: member.tenantId },
    reconnection: false,
  })
  await new Promise<void>((resolve, reject) => {
    socket.on('session.ready', () => resolve())
    socket.on('session.error', (e: { code: string }) => reject(new Error(e.code)))
  })
  return socket
}

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  apiUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`
  webhookUrl = `${apiUrl}/api/v1/webhooks/whatsapp`
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

describe('collision control', () => {
  it('only the lock holder or the assignee can send; others see who is replying', async () => {
    const w = await workspace('ib-lock')
    const priya = await addMember(api, w.owner, 'AGENT', 'priya')
    const arun = await addMember(api, w.owner, 'AGENT', 'arun')
    const from = customer()
    await inbound(w, from, 'Hello, anyone there?')
    const c = await conversationOf(w, from)

    const watcher = await socketFor(arun)
    expect((await watcher.emitWithAck('conversation.join', { conversationId: c.id })).ok).toBe(true)
    const seen: Array<{ holder: { name: string } | null }> = []
    watcher.on('compose.lock', (e) => seen.push(e))

    expect((await priya.client.post(`/conversations/${c.id}/compose-lock`, {})).status).toBe(200)
    await waitFor(
      async () => seen,
      (s) => s.some((e) => e.holder?.name === 'priya person'),
    )
    const blocked = await reply(arun, c.id, 'I can help!')
    expect([blocked.status, blocked.body.error.code]).toEqual([409, 'COMPOSE_LOCKED'])
    expect(blocked.body.error.message).toContain('priya person is replying')
    const take = await arun.client.post(`/conversations/${c.id}/compose-lock`, { force: true })
    expect(take.status).toBe(409) // not the assignee and no inbox.reassign

    expect((await reply(priya, c.id, 'Hi! Priya here.')).status).toBe(201)
    // Sending releases the lock.
    await waitFor(
      async () => seen,
      (s) => s.at(-1)?.holder === null,
    )
    expect(
      (await arun.client.get(`/conversations/${c.id}/compose-lock`)).body.data.holder,
    ).toBeNull()

    // The assignee can reply while the lock is free, and can take the lock from someone else.
    const arunId = (await arun.client.me()).body.data.user.id
    expect(
      (await w.owner.client.post(`/conversations/${c.id}/assign`, { assigneeId: arunId })).status,
    ).toBe(200)
    expect((await priya.client.post(`/conversations/${c.id}/compose-lock`, {})).status).toBe(200)
    const lockedOut = await reply(arun, c.id, 'Assignee, but Priya is typing')
    expect(lockedOut.status).toBe(409)
    expect(
      (await arun.client.post(`/conversations/${c.id}/compose-lock`, { force: true })).status,
    ).toBe(200)
    expect((await reply(priya, c.id, 'Priya lost the lock')).status).toBe(409)
    expect((await reply(arun, c.id, 'Arun took over')).status).toBe(201)
    watcher.close()
  })
})

describe('burst of inbound messages', () => {
  it('100 messages into 20 conversations: in order, correct unread counts, no duplicates', async () => {
    const w = await workspace('ib-burst')
    const customers = Array.from({ length: 20 }, () => customer())
    const base = Math.floor(Date.now() / 1000) - 60
    const sends = customers.flatMap((from) =>
      Array.from({ length: 5 }, (_, k) => () => inbound(w, from, `message ${k}`, base + k)),
    )
    // Shuffle so the webhooks for one conversation arrive out of order and concurrently.
    sends.sort(() => Math.random() - 0.5)
    const statuses = await Promise.all(sends.map((s) => s()))
    expect(statuses.every((s) => s === 200)).toBe(true)

    const list = await waitFor(
      async () =>
        (await w.owner.client.get('/conversations?view=all&limit=100')).body.data as Array<{
          id: string
          unreadCount: number
        }>,
      (l) => l.length === 20 && l.every((c) => c.unreadCount === 5),
      40_000,
    )
    for (const c of list) {
      const thread = (await w.owner.client.get(`/conversations/${c.id}/messages`)).body
        .data as Array<{ content: { text: string } }>
      expect(thread.map((m) => m.content.text).reverse()).toEqual(
        [0, 1, 2, 3, 4].map((k) => `message ${k}`),
      )
    }
    const stored = await db.withTenant(w.owner.tenantId, async (tx) => ({
      messages: await tx.message.count({ where: { direction: 'INBOUND' } }),
      events: await tx.webhookEvent.count(),
    }))
    expect(stored).toEqual({ messages: 100, events: 100 })

    expect((await w.owner.client.get('/inbox/unread-count')).body.data.conversations).toBe(20)
    await w.owner.client.post(`/conversations/${list[0]!.id}/read`)
    expect((await w.owner.client.get(`/conversations/${list[0]!.id}`)).body.data.unreadCount).toBe(
      0,
    )
    expect((await w.owner.client.get('/inbox/unread-count')).body.data.conversations).toBe(19)
    // A new message after reading counts again.
    const first = (await w.owner.client.get(`/conversations/${list[0]!.id}`)).body.data
    await inbound(w, first.contact.phoneE164.slice(1), 'one more')
    await waitFor(
      () =>
        w.owner.client.get(`/conversations/${list[0]!.id}`).then((r) => r.body.data.unreadCount),
      (n) => n === 1,
    )
  }, 90_000)
})

describe('server-side rules', () => {
  it('blocks a freeform reply outside the service window even when the UI is bypassed', async () => {
    const w = await workspace('ib-window')
    const from = customer()
    await inbound(w, from, 'Old message')
    const c = await conversationOf(w, from)
    await db.withTenant(w.owner.tenantId, (tx) =>
      tx.conversation.update({
        where: { id: c.id },
        data: { serviceWindowExpiresAt: new Date(Date.now() - 1000) },
      }),
    )
    const res = await reply(w.owner, c.id, 'Hi again')
    expect([res.status, res.body.error.code]).toEqual([422, 'CONVERSATION_WINDOW_CLOSED'])
    const view = (await w.owner.client.get(`/conversations/${c.id}`)).body.data
    expect(view.serviceWindow.isOpen).toBe(false)
  })

  it('rejects automation sends during AGENT_TAKEOVER and allows them after returning to automation', async () => {
    const w = await workspace('ib-takeover')
    const from = customer()
    await inbound(w, from, 'Need help')
    const c = await conversationOf(w, from)
    const messaging = api.get(MessagingService)
    const automated = () =>
      messaging.send({
        tenantId: w.owner.tenantId,
        target: { conversationId: c.id },
        content: { type: 'TEXT', text: 'Automated follow-up' },
        source: 'AUTOMATION',
        idempotencyKey: key(),
      })
    await expect(automated()).resolves.toMatchObject({ source: 'AUTOMATION' })
    expect((await reply(w.owner, c.id, 'An agent answers')).status).toBe(201)
    const after = (await w.owner.client.get(`/conversations/${c.id}`)).body.data
    expect(after.automationState).toBe('AGENT_TAKEOVER')
    const thread = (await w.owner.client.get(`/conversations/${c.id}/messages`)).body.data
    expect(
      thread.some((m: { content: { event?: string } }) => m.content.event === 'takeover'),
    ).toBe(true)
    await expect(automated()).rejects.toMatchObject({ code: 'AUTOMATION_BLOCKED_BY_TAKEOVER' })

    const back = await w.owner.client.post(`/conversations/${c.id}/automation-state`, {
      state: 'AUTOMATION_ACTIVE',
    })
    expect(back.body.data.automationState).toBe('AUTOMATION_ACTIVE')
    await expect(automated()).resolves.toMatchObject({ source: 'AUTOMATION' })
  })
})

describe('tenant isolation', () => {
  it("an agent never receives another tenant's WebSocket events", async () => {
    const a = await workspace('ib-ws-a')
    const b = await workspace('ib-ws-b')
    const sa = await socketFor(a.owner)
    const sb = await socketFor(b.owner)
    const gotA: string[] = []
    const gotB: string[] = []
    for (const ev of [
      'message.created',
      'conversation.updated',
      'message.status',
      'compose.lock',
      'presence.updated',
    ]) {
      sa.on(ev, () => gotA.push(ev))
      sb.on(ev, () => gotB.push(ev))
    }
    const from = customer()
    await inbound(a, from, 'Tenant A only')
    const c = await conversationOf(a, from)
    await waitFor(
      async () => gotA,
      (g) => g.includes('message.created'),
    )
    await a.owner.client.post(`/conversations/${c.id}/compose-lock`, {})
    await new Promise((r) => setTimeout(r, 800))
    expect(gotB).toEqual([])
    expect((await sb.emitWithAck('conversation.join', { conversationId: c.id })).ok).toBe(false)
    expect((await sb.emitWithAck('compose.heartbeat', { conversationId: c.id })).ok).toBe(false)
    sa.close()
    sb.close()
  })

  it("search returns only the current tenant's conversations", async () => {
    const a = await workspace('ib-search-a')
    const b = await workspace('ib-search-b')
    const word = `refund${metaId().slice(-5)}`
    const fa = customer()
    const fb = customer()
    await inbound(a, fa, `I want a ${word} for my order`)
    await inbound(b, fb, `Please ${word} me`)
    const ca = await conversationOf(a, fa)
    await conversationOf(b, fb)
    const found = (await a.owner.client.get(`/conversations?q=${word}`)).body.data
    expect(found.map((c: { id: string }) => c.id)).toEqual([ca.id])
    expect(found[0].snippet).toContain(word)
    const byPhone = (await a.owner.client.get(`/conversations?q=${fb.slice(-6)}`)).body.data
    expect(byPhone).toEqual([])
  })
})

describe('assignment and lifecycle', () => {
  it('enforces assignment permissions, notifies the assignee, and auto-assigns round robin', async () => {
    const w = await workspace('ib-assign')
    const agent = await addMember(api, w.owner, 'AGENT', 'meera')
    const other = await addMember(api, w.owner, 'AGENT', 'kiran')
    const agentId = (await agent.client.me()).body.data.user.id
    const otherId = (await other.client.me()).body.data.user.id
    const from = customer()
    await inbound(w, from, 'Assign me')
    const c = await conversationOf(w, from)

    const toOther = await agent.client.post(`/conversations/${c.id}/assign`, {
      assigneeId: otherId,
    })
    expect(toOther.status).toBe(403)
    expect(
      (await agent.client.post(`/conversations/${c.id}/assign`, { assigneeId: agentId })).status,
    ).toBe(200)
    expect(
      (await other.client.post(`/conversations/${c.id}/assign`, { assigneeId: otherId })).status,
    ).toBe(403)
    const reassigned = await w.owner.client.post(`/conversations/${c.id}/assign`, {
      assigneeId: otherId,
    })
    expect(reassigned.body.data.assignee).toMatchObject({ id: otherId, name: 'kiran person' })
    const notes = (await other.client.get('/notifications')).body
    expect(notes.data[0]).toMatchObject({ type: 'conversation.assigned', link: `/inbox?c=${c.id}` })
    expect(notes.meta.unread).toBe(1)
    const thread = (await w.owner.client.get(`/conversations/${c.id}/messages`)).body.data
    expect(
      thread.filter((m: { content: { event?: string } }) => m.content.event === 'assigned'),
    ).toHaveLength(2)

    // Round robin: only ONLINE agents are candidates.
    await w.owner.client.patch('/workspace/inbox-settings', { autoAssign: 'ROUND_ROBIN' })
    const s = await socketFor(agent)
    expect((await s.emitWithAck('presence.heartbeat', {})).ok).toBe(true)
    const presence = (await w.owner.client.get('/inbox/presence')).body.data
    expect(presence.find((p: { userId: string }) => p.userId === agentId).status).toBe('ONLINE')
    const next = customer()
    await inbound(w, next, 'New customer')
    const auto = await conversationOf(w, next)
    await waitFor(
      () => w.owner.client.get(`/conversations/${auto.id}`).then((r) => r.body.data.assignee?.id),
      (id) => id === agentId,
    )
    s.close()
  })

  it('snoozes until a time, then maintenance reopens it', async () => {
    const w = await workspace('ib-snooze')
    const from = customer()
    await inbound(w, from, 'Later please')
    const c = await conversationOf(w, from)
    const until = new Date(Date.now() + 1500).toISOString()
    const snoozed = await w.owner.client.post(`/conversations/${c.id}/status`, {
      status: 'SNOOZED',
      snoozedUntil: until,
    })
    expect(snoozed.body.data.status).toBe('SNOOZED')
    const all = (await w.owner.client.get('/conversations?view=all')).body.data
    expect(all.some((x: { id: string }) => x.id === c.id)).toBe(false)
    await new Promise((r) => setTimeout(r, 1700))
    await worker.get(InboxEventsProcessor).maintenance()
    expect((await w.owner.client.get(`/conversations/${c.id}`)).body.data.status).toBe('OPEN')
  })

  it('ASSIGNED_ONLY visibility shows agents their own and unassigned conversations only', async () => {
    const w = await workspace('ib-visibility')
    const agent = await addMember(api, w.owner, 'AGENT')
    const ownerId = (await w.owner.client.me()).body.data.user.id
    const f1 = customer()
    const f2 = customer()
    await inbound(w, f1, 'Mine (owner)')
    await inbound(w, f2, 'Unassigned')
    const c1 = await conversationOf(w, f1)
    await conversationOf(w, f2)
    await w.owner.client.post(`/conversations/${c1.id}/assign`, { assigneeId: ownerId })
    await w.owner.client.patch('/workspace/inbox-settings', { inboxVisibility: 'ASSIGNED_ONLY' })
    const seen = (await agent.client.get('/conversations?view=all')).body.data
    expect(seen.map((c: { id: string }) => c.id)).not.toContain(c1.id)
    expect(seen).toHaveLength(1)
    expect((await agent.client.get(`/conversations/${c1.id}`)).status).toBe(404)
  })

  it('canned replies: workspace-shared, unique shortcuts, role-gated, tenant-isolated', async () => {
    const w = await workspace('ib-canned')
    const manager = await addMember(api, w.owner, 'MANAGER')
    const agent = await addMember(api, w.owner, 'AGENT')
    const viewer = await addMember(api, w.owner, 'VIEWER')

    const created = await manager.client.post('/canned-replies', {
      shortcut: '/Hello',
      title: 'Greeting',
      body: 'Hi! How can we help?',
    })
    expect(created.status).toBe(201)
    expect(created.body.data.shortcut).toBe('/hello') // stored lowercase
    const id = created.body.data.id as string

    // Unique per workspace, case-insensitively; invalid shortcuts are rejected.
    const dup = await w.owner.client.post('/canned-replies', {
      shortcut: '/HELLO',
      title: 'x',
      body: 'y',
    })
    expect([dup.status, dup.body.error.code]).toEqual([409, 'CONFLICT'])
    const bad = await w.owner.client.post('/canned-replies', {
      shortcut: 'hello',
      title: 'x',
      body: 'y',
    })
    expect(bad.status).toBe(400)
    await w.owner.client.post('/canned-replies', {
      shortcut: '/price',
      title: 'Price',
      body: 'From ₹499',
    })

    // AGENT uses (lists) but can't modify; VIEWER can do neither.
    const listed = await agent.client.get('/canned-replies')
    expect(listed.body.data.map((r: { shortcut: string }) => r.shortcut)).toEqual([
      '/hello',
      '/price',
    ])
    expect((await agent.client.get('/canned-replies?q=pri')).body.data).toHaveLength(1)
    expect(
      (await agent.client.post('/canned-replies', { shortcut: '/a', title: 'a', body: 'a' }))
        .status,
    ).toBe(403)
    expect((await agent.client.patch(`/canned-replies/${id}`, { title: 'x' })).status).toBe(403)
    expect((await agent.client.delete(`/canned-replies/${id}`)).status).toBe(403)
    expect((await viewer.client.get('/canned-replies')).status).toBe(403)

    // Managers edit and delete; renaming onto a taken shortcut is a conflict.
    const edited = await manager.client.patch(`/canned-replies/${id}`, { body: 'Hello there!' })
    expect(edited.body.data.body).toBe('Hello there!')
    expect(
      (await manager.client.patch(`/canned-replies/${id}`, { shortcut: '/price' })).status,
    ).toBe(409)

    // Another workspace sees none of them and can reuse the shortcut.
    const other = await workspace('ib-canned-b')
    expect((await other.owner.client.get('/canned-replies')).body.data).toEqual([])
    expect((await other.owner.client.patch(`/canned-replies/${id}`, { title: 'x' })).status).toBe(
      404,
    )
    expect((await other.owner.client.delete(`/canned-replies/${id}`)).status).toBe(404)
    const reuse = await other.owner.client.post('/canned-replies', {
      shortcut: '/hello',
      title: 'h',
      body: 'b',
    })
    expect(reuse.status).toBe(201)

    expect((await manager.client.delete(`/canned-replies/${id}`)).status).toBe(204)
    expect((await agent.client.get('/canned-replies')).body.data).toHaveLength(1)
    const audit = (await w.owner.client.get('/audit-logs?limit=50')).body.data as Array<{
      action: string
    }>
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'canned_reply.created',
        'canned_reply.updated',
        'canned_reply.deleted',
      ]),
    )
  })
})
