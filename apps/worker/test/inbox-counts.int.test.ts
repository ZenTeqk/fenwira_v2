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
import { bootApi, bootWorker, type Client } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'

/**
 * Inbox tab counts (GET /conversations/counts) share the list's filter, so every count equals the
 * length of that tab's fully-paged list (docs/INBOX.md → List filters and views).
 */
const SECRET = 'inbox-counts-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const customer = () => `9197${String(Math.random()).slice(2, 10)}`
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

type Row = { id: string; contact: { phoneE164: string } }
/** Every page of a list (small pages, so paging itself is exercised). */
async function fullList(client: Client, params: Record<string, string>): Promise<Row[]> {
  const out: Row[] = []
  let cursor: string | null = null
  do {
    const qs = new URLSearchParams({ ...params, limit: '2', ...(cursor ? { cursor } : {}) })
    const res = await client.get(`/conversations?${qs}`)
    expect(res.status, res.text).toBe(200)
    out.push(...(res.body.data as Row[]))
    cursor = res.body.page.nextCursor
  } while (cursor)
  return out
}
const counts = async (client: Client, params: Record<string, string> = {}) => {
  const res = await client.get(`/conversations/counts?${new URLSearchParams(params)}`)
  expect(res.status, res.text).toBe(200)
  return res.body.data as { all: number; mine: number; unassigned: number }
}
/** Asserts counts equal the paged list lengths for each tab under these filters. */
async function expectConsistent(client: Client, params: Record<string, string>) {
  const c = await counts(client, params)
  for (const view of ['all', 'mine', 'unassigned'] as const)
    expect(c[view], `${view} ${JSON.stringify(params)}`).toBe(
      (await fullList(client, { ...params, view })).length,
    )
  return c
}

/** One inbound message per customer; returns conversation ids in the same order. */
async function seed(w: Ws, texts: string[]): Promise<string[]> {
  const phones = texts.map(() => customer())
  for (const [i, text] of texts.entries())
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(w.ids, { from: phones[i]!, wamid: `wamid.${metaId()}`, text }),
    )
  const rows = await waitFor(
    () => fullList(w.owner.client, {}),
    (r) => phones.every((p) => r.some((c) => c.contact.phoneE164 === `+${p}`)),
  )
  return phones.map((p) => rows.find((c) => c.contact.phoneE164 === `+${p}`)!.id)
}

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  const apiUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`
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

describe('conversation counts', () => {
  it('equal the fully-paged list of each tab under search, status and unread filters', async () => {
    const w = await workspace('ib-counts')
    const ownerId = (await w.owner.client.me()).body.data.user.id
    const agent = await addMember(api, w.owner, 'AGENT')
    const agentId = (await agent.client.me()).body.data.user.id
    const [c1, c2, c3, c4, c5] = await seed(w, [
      'kumquat alpha',
      'kumquat beta',
      'plain one',
      'kumquat gamma',
      'plain two',
    ])
    await w.owner.client.post(`/conversations/${c1}/assign`, { assigneeId: ownerId })
    await w.owner.client.post(`/conversations/${c2}/assign`, { assigneeId: agentId })
    await w.owner.client.post(`/conversations/${c4}/status`, { status: 'RESOLVED' })
    await w.owner.client.post(`/conversations/${c3}/read`)
    await waitFor(
      () => fullList(w.owner.client, { unread: 'true' }),
      (r) => !r.some((c) => c.id === c3),
    )

    // Defaults: views show open/pending only (c4 is resolved).
    expect(await expectConsistent(w.owner.client, {})).toEqual({ all: 4, mine: 1, unassigned: 2 })
    expect(await expectConsistent(w.owner.client, { q: 'kumquat' })).toEqual({
      all: 2,
      mine: 1,
      unassigned: 0,
    })
    expect(await expectConsistent(w.owner.client, { unread: 'true' })).toEqual({
      all: 3,
      mine: 1,
      unassigned: 1,
    })
    expect(await expectConsistent(w.owner.client, { q: 'plain', unread: 'true' })).toEqual({
      all: 1,
      mine: 0,
      unassigned: 1,
    })
    for (const status of ['OPEN', 'PENDING', 'SNOOZED', 'RESOLVED'])
      await expectConsistent(w.owner.client, { status })
    await expectConsistent(w.owner.client, { status: 'OPEN', q: 'kumquat', unread: 'true' })
    // Mine is per user.
    expect((await expectConsistent(agent.client, {})).mine).toBe(1)
    expect(c5).toBeTruthy()
  })

  it('an ASSIGNED_ONLY agent only counts conversations they can see', async () => {
    const w = await workspace('ib-counts-visibility')
    const ownerId = (await w.owner.client.me()).body.data.user.id
    const agent = await addMember(api, w.owner, 'AGENT')
    const [c1] = await seed(w, ['hidden from agent', 'unassigned one', 'unassigned two'])
    await w.owner.client.post(`/conversations/${c1}/assign`, { assigneeId: ownerId })
    await w.owner.client.patch('/workspace/inbox-settings', { inboxVisibility: 'ASSIGNED_ONLY' })

    expect(await expectConsistent(agent.client, {})).toEqual({ all: 2, mine: 0, unassigned: 2 })
    expect(await expectConsistent(agent.client, { q: 'hidden' })).toEqual({
      all: 0,
      mine: 0,
      unassigned: 0,
    })
    expect((await counts(w.owner.client)).all).toBe(3)
  })

  it('never counts another workspace’s conversations', async () => {
    const a = await workspace('ib-counts-a')
    const b = await workspace('ib-counts-b')
    await seed(a, ['zanzibar one', 'zanzibar two'])
    await seed(b, ['zanzibar three'])
    expect(await expectConsistent(a.owner.client, { q: 'zanzibar' })).toEqual({
      all: 2,
      mine: 0,
      unassigned: 2,
    })
    expect(await expectConsistent(b.owner.client, {})).toEqual({ all: 1, mine: 0, unassigned: 1 })
  })

  it('validates its filters', async () => {
    const w = await workspace('ib-counts-validate')
    expect((await w.owner.client.get('/conversations/counts?status=NOPE')).status).toBe(400)
  })
})

describe('status filter', () => {
  it('an explicit status replaces the open/pending default under All, Mine and Unassigned', async () => {
    const w = await workspace('ib-status-filter')
    const ownerId = (await w.owner.client.me()).body.data.user.id
    const [snoozedMine, resolvedFree, resolvedMine, open] = await seed(w, [
      'snoozed mine',
      'resolved unassigned',
      'resolved mine',
      'open unassigned',
    ])
    for (const id of [snoozedMine, resolvedMine])
      await w.owner.client.post(`/conversations/${id}/assign`, { assigneeId: ownerId })
    const snooze = await w.owner.client.post(`/conversations/${snoozedMine}/status`, {
      status: 'SNOOZED',
      snoozedUntil: new Date(Date.now() + 86_400_000).toISOString(),
    })
    expect(snooze.status, snooze.text).toBe(200)
    for (const id of [resolvedFree, resolvedMine])
      await w.owner.client.post(`/conversations/${id}/status`, { status: 'RESOLVED' })

    const ids = async (params: Record<string, string>) =>
      (await fullList(w.owner.client, params)).map((c) => c.id).sort()
    expect(await ids({ view: 'all', status: 'RESOLVED' })).toEqual(
      [resolvedFree, resolvedMine].sort(),
    )
    expect(await ids({ view: 'mine', status: 'RESOLVED' })).toEqual([resolvedMine])
    expect(await ids({ view: 'unassigned', status: 'RESOLVED' })).toEqual([resolvedFree])
    expect(await ids({ view: 'all', status: 'SNOOZED' })).toEqual([snoozedMine])
    expect(await ids({ view: 'mine', status: 'SNOOZED' })).toEqual([snoozedMine])
    expect(await ids({ view: 'unassigned', status: 'SNOOZED' })).toEqual([])
    expect(await expectConsistent(w.owner.client, { status: 'RESOLVED' })).toEqual({
      all: 2,
      mine: 1,
      unassigned: 1,
    })
    expect(await expectConsistent(w.owner.client, { status: 'SNOOZED' })).toEqual({
      all: 1,
      mine: 1,
      unassigned: 0,
    })

    // No status: unchanged default (open and pending only).
    expect(await ids({ view: 'all' })).toEqual([open])
    expect(await ids({ view: 'mine' })).toEqual([])
    expect(await ids({ view: 'unassigned' })).toEqual([open])
    expect(await expectConsistent(w.owner.client, {})).toEqual({ all: 1, mine: 0, unassigned: 1 })
  })
})
