import { Database } from '@fenwira/database'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
} from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'

/**
 * Message attachments are served only to users who can see the conversation (GET
 * /files/:id/download-url, docs/INBOX.md → Attachments); other file kinds keep their own routes.
 */
const SECRET = 'file-access-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let webhookUrl: string

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const customer = () => `9198${String(Math.random()).slice(2, 10)}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)])

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

async function conversation(w: Ws): Promise<string> {
  const from = customer()
  await deliverWebhook(
    webhookUrl,
    SECRET,
    inboundMessageWebhook(w.ids, { from, wamid: `wamid.${metaId()}`, text: 'Hi' }),
  )
  const c = await waitFor(
    async () =>
      (
        (await w.owner.client.get('/conversations?limit=100')).body.data as Array<{
          id: string
          contact: { phoneE164: string }
        }>
      ).find((x) => x.contact.phoneE164 === `+${from}`),
    (x) => !!x,
  )
  return c!.id
}

/** Upload → complete; READY message media owned by `m`. */
async function upload(m: Member): Promise<string> {
  const up = await m.client.post('/files/upload-url', {
    purpose: 'MESSAGE_MEDIA',
    mimeType: 'image/png',
    sizeBytes: png.length,
    filename: 'receipt.png',
  })
  expect(up.status, up.text).toBe(201)
  await fetch(up.body.data.url, { method: 'PUT', headers: up.body.data.headers, body: png })
  const done = await m.client.post(`/files/${up.body.data.fileId}/complete`)
  expect(done.body.data.status).toBe('READY')
  return up.body.data.fileId
}

async function sendImage(m: Member, conversationId: string): Promise<string> {
  const fileId = await upload(m)
  const res = await m.client.post(
    `/conversations/${conversationId}/messages`,
    { content: { type: 'IMAGE', fileId } },
    { 'Idempotency-Key': `img-${metaId()}` },
  )
  expect(res.status, res.text).toBe(201)
  return fileId
}

const download = (m: Member, fileId: string) => m.client.get(`/files/${fileId}/download-url`)

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

describe('message attachment access', () => {
  it('follows conversation visibility, with the same 404 as a missing file', async () => {
    const w = await workspace('file-visibility')
    const ownerId = (await w.owner.client.me()).body.data.user.id
    const agent = await addMember(api, w.owner, 'AGENT')
    const hidden = await conversation(w)
    const shared = await conversation(w)
    await w.owner.client.post(`/conversations/${hidden}/assign`, { assigneeId: ownerId })
    const hiddenFile = await sendImage(w.owner, hidden)
    const sharedFile = await sendImage(w.owner, shared)

    // Workspace-wide visibility: the agent sees every conversation, so every attachment.
    expect((await download(agent, hiddenFile)).status).toBe(200)

    await w.owner.client.patch('/workspace/inbox-settings', { inboxVisibility: 'ASSIGNED_ONLY' })
    const denied = await download(agent, hiddenFile)
    const missing = await download(agent, randomUUID())
    expect(denied.status).toBe(404)
    expect([denied.body.error.code, denied.body.error.message]).toEqual([
      missing.body.error.code,
      missing.body.error.message,
    ])
    const allowed = await download(agent, sharedFile)
    expect(allowed.status, allowed.text).toBe(200)
    expect((await fetch(allowed.body.data.url)).status).toBe(200)
    // Non-agents see every conversation.
    expect((await download(w.owner, hiddenFile)).status).toBe(200)

    // Assigning the conversation to the agent makes its attachment visible.
    const agentId = (await agent.client.me()).body.data.user.id
    await w.owner.client.post(`/conversations/${hidden}/assign`, { assigneeId: agentId })
    expect((await download(agent, hiddenFile)).status).toBe(200)
  })

  it('an unsent upload is visible to its uploader only', async () => {
    const w = await workspace('file-unsent')
    const agent = await addMember(api, w.owner, 'AGENT')
    const fileId = await upload(agent)
    expect((await download(agent, fileId)).status).toBe(200)
    expect((await download(w.owner, fileId)).status).toBe(404)
  })

  it('never serves another workspace’s attachment', async () => {
    const a = await workspace('file-ws-a')
    const b = await workspace('file-ws-b')
    const fileId = await sendImage(a.owner, await conversation(a))
    expect((await download(a.owner, fileId)).status).toBe(200)
    expect((await download(b.owner, fileId)).status).toBe(404)
  })

  it('non-message files keep their own routes', async () => {
    const w = await workspace('file-other-kinds')
    // Template sample: served by the templates route; not a message attachment until sent.
    const up = await w.owner.client.post('/templates/samples/upload-url', {
      mimeType: 'image/png',
      sizeBytes: png.length,
      filename: 'banner.png',
    })
    expect(up.status, up.text).toBe(201)
    await fetch(up.body.data.url, { method: 'PUT', headers: up.body.data.headers, body: png })
    await w.owner.client.post(`/templates/samples/${up.body.data.fileId}/complete`)
    expect((await w.owner.client.get(`/templates/samples/${up.body.data.fileId}/url`)).status).toBe(
      200,
    )
    expect((await download(w.owner, up.body.data.fileId)).status).toBe(404)

    // Export: served by its job route.
    await w.owner.client.post('/contacts', { phone: '9811111111', name: 'Ravi' })
    const res = await w.owner.client.post('/exports', {
      filter: { op: 'AND', rules: [] },
    })
    expect(res.status, res.text).toBe(202)
    const done = await waitFor(
      () => w.owner.client.get(`/exports/${res.body.data.id}`).then((r) => r.body.data),
      (e) => e.status === 'COMPLETED',
    )
    expect((await fetch(done.downloadUrl)).status).toBe(200)
  })
})
