import { Database } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
  statusWebhook,
} from '@fenwira/whatsapp/testing'
import { signWebhookBody } from '@fenwira/whatsapp'
import { type INestApplication } from '@nestjs/common'
import { MetricsService } from '@fenwira/api/core'
import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { execFileSync } from 'node:child_process'
import { type AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { type Server } from 'node:http'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker, Client } from './support/harness'
import { createOwner, type Member } from './support/workspace'

/**
 * Phase 5 acceptance (docs/prompts/PHASE_05_MESSAGING_ENGINE.md) against the in-process
 * meta-mock. The mock posts signed status webhooks (sent → delivered → read) back to the API
 * after each send unless a test turns that off.
 */
const SECRET = 'test-app-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let apiUrl: string
let webhookUrl: string

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const phoneNo = () => `9198${String(Math.random()).slice(2, 10)}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })
const autoStatuses = (statuses: Array<'sent' | 'delivered' | 'read'>) => {
  mock.state.webhookTarget = { url: webhookUrl, appSecret: SECRET, statuses, delayMs: 40 }
}

async function waitFor<T>(
  load: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let value = await load()
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`)
    await new Promise((r) => setTimeout(r, 100))
    value = await load()
  }
  return value
}

type Ids = { wabaId: string; phoneNumberId: string }
type Setup = { owner: Member; ids: Ids; phoneId: string }

/** Owner + a connected number (developer connect against the mock). */
async function setup(label: string): Promise<Setup> {
  const owner = await createOwner(api, label)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
  const res = await owner.client.post('/whatsapp/connections/dev', {
    ...ids,
    accessToken: `mock-dev:${ids.wabaId}`,
  })
  expect(res.status, res.text).toBe(201)
  return { owner, ids, phoneId: res.body.data.id }
}

/** A customer message arrives; returns their conversation once processed. */
async function customerWrites(
  s: Setup,
  from: string,
  text = 'Hi there',
  wamid = `wamid.in.${metaId()}`,
) {
  expect(
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(s.ids, { from, wamid, text, name: 'Asha' }),
    ),
  ).toBe(200)
  return waitFor(
    async () =>
      (
        (await s.owner.client.get('/conversations')).body.data as Array<{
          id: string
          contact: { phoneE164: string }
        }>
      ).find((c) => c.contact.phoneE164 === `+${from}`),
    (c) => !!c,
  ) as Promise<{
    id: string
    serviceWindowExpiresAt: string
    contact: { phoneE164: string; waProfileName: string }
  }>
}

const messageOf = (s: Setup, id: string) =>
  s.owner.client.get(`/messages/${id}`).then((r) => r.body.data)
const reply = (s: Setup, conversationId: string, text: string, key = `key-${metaId()}`) =>
  s.owner.client.post(
    `/conversations/${conversationId}/messages`,
    { content: { type: 'TEXT', text } },
    { 'Idempotency-Key': key },
  )

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    META_WEBHOOK_VERIFY_TOKEN: 'verify-me',
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  apiUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`
  webhookUrl = `${apiUrl}/api/v1/webhooks/whatsapp`
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 2 })
  autoStatuses(['sent', 'delivered', 'read'])
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('webhook endpoint', () => {
  it('answers the verification handshake only with the right token', async () => {
    const ok = await fetch(
      `${webhookUrl}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`,
    )
    expect([ok.status, await ok.text()]).toEqual([200, '12345'])
    const bad = await fetch(
      `${webhookUrl}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`,
    )
    expect(bad.status).toBe(403)
  })

  it('rejects a bad signature with 401 and persists nothing', async () => {
    const s = await setup('msg-sig')
    const payload = JSON.stringify(
      inboundMessageWebhook(s.ids, { from: phoneNo(), wamid: `wamid.${metaId()}` }),
    )
    const post = (signature?: string) =>
      fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature ? { 'X-Hub-Signature-256': signature } : {}),
        },
        body: payload,
      })
    expect((await post(signWebhookBody('wrong-secret', payload))).status).toBe(401)
    expect((await post()).status).toBe(401)
    // Signed over different bytes than were sent (re-serialized JSON) also fails.
    expect(
      (await post(signWebhookBody(SECRET, JSON.stringify(JSON.parse(payload), null, 1)))).status,
    ).toBe(401)
    const stored = await db.withTenant(s.owner.tenantId, (tx) => tx.webhookEvent.count())
    expect(stored).toBe(0)
    expect((await s.owner.client.get('/conversations')).body.data).toEqual([])
  })

  it('ignores events for numbers no tenant owns', async () => {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    const payload = inboundMessageWebhook(
      { wabaId: '1', phoneNumberId: metaId() },
      { from: '1', wamid: 'w' },
    )
    const raw = JSON.stringify(payload)
    const unknown = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signWebhookBody(SECRET, raw),
      },
      body: raw,
    })
    expect(unknown.status).toBe(200)
    expect(await unknown.json()).toMatchObject({ accepted: 0, ignored: 1 })
  })
})

describe('inbound messages', () => {
  it('replaying the same webhook 10 times creates exactly one message', async () => {
    const s = await setup('msg-replay')
    const from = phoneNo()
    const payload = inboundMessageWebhook(s.ids, {
      from,
      wamid: `wamid.in.${metaId()}`,
      text: 'Is my order ready?',
      name: 'Asha',
      timestamp: Math.floor(Date.now() / 1000),
    })
    const statuses = await Promise.all(
      Array.from({ length: 10 }, () => deliverWebhook(webhookUrl, SECRET, payload)),
    )
    expect(statuses.every((st) => st === 200)).toBe(true)
    const conv = await waitFor(
      async () => (await s.owner.client.get('/conversations')).body.data[0],
      (c) => !!c,
    )
    await new Promise((r) => setTimeout(r, 500))
    const messages = (await s.owner.client.get(`/conversations/${conv.id}/messages`)).body.data
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      direction: 'INBOUND',
      status: 'RECEIVED',
      content: { type: 'TEXT', text: 'Is my order ready?' },
    })
    expect(conv.contact).toMatchObject({ phoneE164: `+${from}`, waProfileName: 'Asha' })
    // The 24-hour window opens from the customer's message time.
    const window =
      new Date(conv.serviceWindowExpiresAt).getTime() -
      new Date(messages[0].providerTimestamp).getTime()
    expect(window).toBe(24 * 3600 * 1000)
    const events = await db.withTenant(s.owner.tenantId, (tx) => tx.webhookEvent.findMany())
    expect(events.map((e) => e.status)).toEqual(['PROCESSED'])
  })

  it('downloads inbound media into storage', async () => {
    const s = await setup('msg-media-in')
    const mediaId = `media-in-${metaId()}`
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    await control('media', { id: mediaId, mimeType: 'image/png', base64: png.toString('base64') })
    const from = phoneNo()
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(s.ids, {
        from,
        wamid: `wamid.in.${metaId()}`,
        body: { type: 'image', image: { id: mediaId, mime_type: 'image/png', caption: 'receipt' } },
      }),
    )
    const conv = await waitFor(
      async () => (await s.owner.client.get('/conversations')).body.data[0],
      (c) => !!c,
    )
    const [message] = (await waitFor(
      async () => (await s.owner.client.get(`/conversations/${conv.id}/messages`)).body.data,
      (m: Array<{ content: { fileId?: string } }>) => !!m[0]?.content.fileId,
    )) as [{ content: { fileId: string } }]
    expect(message.content).toMatchObject({ type: 'IMAGE', caption: 'receipt' })
    const link = await s.owner.client.get(`/files/${message.content.fileId}/download-url`)
    expect(link.status).toBe(200)
    const bytes = Buffer.from(await (await fetch(link.body.data.url)).arrayBuffer())
    expect(bytes.equals(png)).toBe(true)
  })
})

describe('outbound messages', () => {
  it('goes CREATED → QUEUED → SENDING → SENT → DELIVERED → READ and streams each change live', async () => {
    autoStatuses(['sent', 'delivered', 'read'])
    const s = await setup('msg-lifecycle')
    const conv = await customerWrites(s, phoneNo())

    const login = await new Client(api).login(s.owner.email)
    const cookie = ((login.headers['set-cookie'] as unknown as string[]) ?? [])
      .map((c) => c.split(';')[0])
      .join('; ')
    const socket: Socket = io(apiUrl, {
      path: '/ws',
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      auth: { tenantId: s.owner.tenantId },
      reconnection: false,
    })
    await new Promise<void>((resolve) => socket.on('session.ready', () => resolve()))
    expect((await socket.emitWithAck('conversation.join', { conversationId: conv.id })).ok).toBe(
      true,
    )
    const seen: string[] = []
    let createdEvent: { id: string } | undefined
    socket.on('message.created', (m: { id: string; direction: string }) => {
      if (m.direction === 'OUTBOUND') createdEvent = m
    })
    socket.on('message.status', (e: { status: string }) => seen.push(e.status))

    const res = await reply(s, conv.id, 'Yes, it is ready for pickup.')
    expect(res.status, res.text).toBe(201)
    expect(res.body.data).toMatchObject({
      status: 'CREATED',
      direction: 'OUTBOUND',
      source: 'INBOX',
    })
    const done = await waitFor(
      () => messageOf(s, res.body.data.id),
      (m) => m.status === 'READ',
    )
    expect(done.providerMessageId).toMatch(/^wamid\./)
    expect(done.sentAt && done.deliveredAt && done.readAt).toBeTruthy()
    await waitFor(
      async () => seen,
      (x) => x.includes('READ'),
      5000,
    )
    socket.close()
    expect(createdEvent?.id).toBe(res.body.data.id)
    const order = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ']
    expect(seen.filter((x) => order.includes(x))).toEqual(order)
    const sent = mock.state.sent.filter((m) => m.phoneNumberId === s.ids.phoneNumberId)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.payload).toMatchObject({
      type: 'text',
      text: { body: 'Yes, it is ready for pickup.' },
      biz_opaque_callback_data: res.body.data.id,
    })
  })

  it('the same Idempotency-Key returns the same message and sends once', async () => {
    autoStatuses([])
    const s = await setup('msg-idem')
    const conv = await customerWrites(s, phoneNo())
    const first = await reply(s, conv.id, 'Once only', 'idem-key-0001')
    const second = await reply(s, conv.id, 'Once only', 'idem-key-0001')
    expect(second.status).toBe(201)
    expect(second.headers['idempotent-replayed']).toBe('true')
    expect(second.body.data.id).toBe(first.body.data.id)
    const reused = await reply(s, conv.id, 'Different body', 'idem-key-0001')
    expect([reused.status, reused.body.error.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED'])
    const missing = await s.owner.client.post(`/conversations/${conv.id}/messages`, {
      content: { type: 'TEXT', text: 'x' },
    })
    expect(missing.status).toBe(400)
    await waitFor(
      () => messageOf(s, first.body.data.id),
      (m) => m.status === 'SENT',
    )
    await new Promise((r) => setTimeout(r, 300))
    expect(mock.state.sent.filter((m) => m.phoneNumberId === s.ids.phoneNumberId)).toHaveLength(1)
  })

  it('out-of-order statuses (READ before DELIVERED) end in READ', async () => {
    autoStatuses([])
    const s = await setup('msg-order')
    const conv = await customerWrites(s, phoneNo())
    const res = await reply(s, conv.id, 'Order check')
    const sent = await waitFor(
      () => messageOf(s, res.body.data.id),
      (m) => m.status === 'SENT',
    )
    const wamid = sent.providerMessageId
    await deliverWebhook(webhookUrl, SECRET, statusWebhook(s.ids, { wamid, status: 'read' }))
    await deliverWebhook(webhookUrl, SECRET, statusWebhook(s.ids, { wamid, status: 'delivered' }))
    await deliverWebhook(webhookUrl, SECRET, statusWebhook(s.ids, { wamid, status: 'sent' }))
    await new Promise((r) => setTimeout(r, 800))
    const final = await messageOf(s, res.body.data.id)
    expect(final.status).toBe('READ')
    expect(final.deliveredAt).toBeTruthy()
    // A late failure after delivery is recorded but doesn't regress the status.
    await deliverWebhook(
      webhookUrl,
      SECRET,
      statusWebhook(s.ids, { wamid, status: 'failed', errorCode: 131026 }),
    )
    await new Promise((r) => setTimeout(r, 800))
    expect(await messageOf(s, res.body.data.id)).toMatchObject({
      status: 'READ',
      errorCode: 'META_131026',
    })
  })

  it('rejects freeform outside the 24-hour window; a template may start the conversation', async () => {
    autoStatuses([])
    const s = await setup('msg-window')
    const to = `+${phoneNo()}`
    const text = await s.owner.client.post(
      '/conversations',
      { to, content: { type: 'TEXT', text: 'Hello?' } },
      { 'Idempotency-Key': `win-${metaId()}` },
    )
    expect([text.status, text.body.error.code]).toEqual([422, 'CONVERSATION_WINDOW_CLOSED'])
    const template = await s.owner.client.post(
      '/conversations',
      { to, content: { type: 'TEMPLATE', name: 'hello_world', language: 'en_US' } },
      { 'Idempotency-Key': `win-${metaId()}` },
    )
    expect(template.status, template.text).toBe(201)
    await waitFor(
      () => messageOf(s, template.body.data.id),
      (m) => m.status === 'SENT',
    )
    expect(mock.state.sent.at(-1)?.payload).toMatchObject({ type: 'template', to: to.slice(1) })
  })

  it('retries a Meta 5xx with backoff, fails a permanent error without retrying', async () => {
    autoStatuses([])
    const s = await setup('msg-retry')
    const conv = await customerWrites(s, phoneNo())
    const path = `${s.ids.phoneNumberId}/messages`
    await control('fail', { pathContains: path, method: 'POST', status: 500, code: 1, times: 2 })
    const retried = await reply(s, conv.id, 'Try again')
    await waitFor(
      () => messageOf(s, retried.body.data.id),
      (m) => m.status === 'SENT',
    )
    const attempts = mock.state.calls.filter((c) => c.path === path && c.method === 'POST')
    expect(attempts).toHaveLength(3)

    await control('fail', {
      pathContains: path,
      method: 'POST',
      status: 400,
      code: 131026,
      times: 1,
    })
    const before = mock.state.calls.filter((c) => c.path === path).length
    const permanent = await reply(s, conv.id, 'Undeliverable')
    const failed = await waitFor(
      () => messageOf(s, permanent.body.data.id),
      (m) => m.status === 'FAILED',
    )
    expect(failed.errorCode).toBe('META_UNDELIVERABLE')
    await new Promise((r) => setTimeout(r, 300))
    expect(mock.state.calls.filter((c) => c.path === path).length - before).toBe(1)
  })

  it('exhausted retries fail the message and land in the DLQ', async () => {
    autoStatuses([])
    const s = await setup('msg-dlq')
    const conv = await customerWrites(s, phoneNo())
    const path = `${s.ids.phoneNumberId}/messages`
    await control('fail', { pathContains: path, method: 'POST', status: 503, code: 2, times: 10 })
    const res = await reply(s, conv.id, 'Never arrives')
    const failed = await waitFor(
      () => messageOf(s, res.body.data.id),
      (m) => m.status === 'FAILED',
      20_000,
    )
    expect(failed.errorCode).toBe('RETRIES_EXHAUSTED')
    expect(mock.state.calls.filter((c) => c.path === path && c.method === 'POST')).toHaveLength(5)
    const redis = new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })
    const dlq = new Queue(QUEUES.whatsappOutboundDlq, { connection: redis })
    const jobs = await dlq.getJobs(['waiting', 'wait', 'paused', 'delayed'])
    expect(
      jobs.some(
        (j) =>
          (j.data as { payload?: { messageId?: string } }).payload?.messageId === res.body.data.id,
      ),
    ).toBe(true)
    await dlq.close()
    await redis.quit()
    mock.state.failures = []
    // An admin replays it once Meta is healthy again: same message, fresh attempt budget.
    const out = execFileSync('node', ['dist/cli/replay-dlq.js', '--message', res.body.data.id], {
      cwd: resolve(__dirname, '..'),
      env: process.env,
    }).toString()
    expect(out).toContain('requeued 1 message(s)')
    const replayed = await waitFor(
      () => messageOf(s, res.body.data.id),
      (m) => m.status === 'SENT',
    )
    expect(replayed.errorCode).toBeNull()
  })

  it('stopping the worker mid-send and restarting it sends exactly once', async () => {
    autoStatuses([])
    const s = await setup('msg-restart')
    const conv = await customerWrites(s, phoneNo())
    await control('delay', { pathContains: `${s.ids.phoneNumberId}/messages`, ms: 1500, times: 1 })
    const res = await reply(s, conv.id, 'Survives a restart')
    await waitFor(
      () => messageOf(s, res.body.data.id),
      (m) => m.status === 'SENDING',
    )
    await worker.close() // graceful: the in-flight send completes, nothing new starts
    const second = await reply(s, conv.id, 'Queued while the worker is down')
    await new Promise((r) => setTimeout(r, 500))
    expect((await messageOf(s, second.body.data.id)).status).toBe('CREATED')
    worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
    await waitFor(
      () => messageOf(s, second.body.data.id),
      (m) => m.status === 'SENT',
    )
    expect((await messageOf(s, res.body.data.id)).status).toBe('SENT')
    const sent = mock.state.sent.filter((m) => m.phoneNumberId === s.ids.phoneNumberId)
    expect(sent.map((m) => (m.payload.text as { body: string }).body)).toEqual([
      'Survives a restart',
      'Queued while the worker is down',
    ])
  })

  it('an interrupted send is matched by its callback data instead of being sent again', async () => {
    autoStatuses([])
    const s = await setup('msg-crash')
    const conv = await customerWrites(s, phoneNo())
    await worker.close()
    const res = await reply(s, conv.id, 'Accepted by Meta, response lost')
    const id = res.body.data.id as string
    // Simulate a worker killed after calling Meta but before writing SENT.
    await db.withTenant(s.owner.tenantId, (tx) =>
      tx.message.update({ where: { id }, data: { status: 'SENDING', sendingAt: new Date() } }),
    )
    // The worker comes back: its outbound job finds SENDING and waits for Meta's status.
    worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
    await waitFor(
      () =>
        db.withTenant(s.owner.tenantId, (tx) =>
          tx.outboxEvent.findFirst({
            where: { aggregateId: id, eventType: 'message.outbound.requested' },
          }),
        ),
      (e) => e?.status === 'DISPATCHED',
    )
    const wamid = `wamid.recovered.${metaId()}`
    await deliverWebhook(
      webhookUrl,
      SECRET,
      statusWebhook(s.ids, { wamid, status: 'sent', callbackData: id }),
    )
    const recovered = await waitFor(
      () => messageOf(s, id),
      (m) => m.status === 'SENT',
    )
    expect(recovered.providerMessageId).toBe(wamid)
    await new Promise((r) => setTimeout(r, 3000)) // past the job's 2 s re-check
    expect(mock.state.sent.filter((m) => m.phoneNumberId === s.ids.phoneNumberId)).toHaveLength(0)
    expect((await messageOf(s, id)).status).toBe('SENT')
  })

  it('sends an uploaded image through presigned upload → complete → send', async () => {
    autoStatuses([])
    const s = await setup('msg-media-out')
    const conv = await customerWrites(s, phoneNo())
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)])
    const upload = await s.owner.client.post('/files/upload-url', {
      purpose: 'MESSAGE_MEDIA',
      mimeType: 'image/png',
      sizeBytes: png.length,
      filename: 'menu.png',
    })
    expect(upload.status, upload.text).toBe(201)
    const put = await fetch(upload.body.data.url, {
      method: 'PUT',
      headers: upload.body.data.headers,
      body: png,
    })
    expect(put.status).toBe(200)
    const complete = await s.owner.client.post(`/files/${upload.body.data.fileId}/complete`)
    expect(complete.body.data.status).toBe('READY')
    const res = await s.owner.client.post(
      `/conversations/${conv.id}/messages`,
      { content: { type: 'IMAGE', fileId: upload.body.data.fileId, caption: "Today's menu" } },
      { 'Idempotency-Key': `img-${metaId()}` },
    )
    expect(res.status, res.text).toBe(201)
    await waitFor(
      () => messageOf(s, res.body.data.id),
      (m) => m.status === 'SENT',
    )
    expect(mock.state.sent.at(-1)?.payload).toMatchObject({
      type: 'image',
      image: { caption: "Today's menu" },
    })

    // A file whose bytes don't match its declared type is rejected.
    const fake = await s.owner.client.post('/files/upload-url', {
      purpose: 'MESSAGE_MEDIA',
      mimeType: 'image/png',
      sizeBytes: 4,
    })
    await fetch(fake.body.data.url, {
      method: 'PUT',
      headers: fake.body.data.headers,
      body: 'nope',
    })
    expect(
      (await s.owner.client.post(`/files/${fake.body.data.fileId}/complete`)).body.data.status,
    ).toBe('REJECTED')
  })

  it('marks the conversation read on WhatsApp through the outbound worker', async () => {
    const s = await setup('msg-read')
    const wamid = `wamid.in.${metaId()}`
    const conv = await customerWrites(s, phoneNo(), 'Seen?', wamid)
    expect((await s.owner.client.post(`/conversations/${conv.id}/read`)).status).toBe(204)
    await waitFor(
      async () =>
        mock.state.calls.find(
          (c) =>
            c.path === `${s.ids.phoneNumberId}/messages` &&
            (c.body as { status?: string })?.status === 'read',
        ),
      (c) => !!c,
    ).then((c) => expect((c!.body as { message_id: string }).message_id).toBe(wamid))
  })

  it('exports webhook, Meta and DLQ metrics without tenant labels', async () => {
    const apiMetrics = await api.get(MetricsService).metrics()
    expect(apiMetrics).toMatch(/webhook_received_total\{[^}]*kind="MESSAGE"[^}]*result="duplicate"/)
    expect(apiMetrics).toMatch(/webhook_received_total\{[^}]*result="bad_signature"/)
    expect(apiMetrics).toContain('webhook_ingest_duration_ms_bucket')
    const workerMetrics = await worker.get(MetricsService).metrics()
    expect(workerMetrics).toMatch(/meta_api_requests_total\{[^}]*result="success"/)
    expect(workerMetrics).toMatch(/queue_depth\{[^}]*queue="whatsapp.outbound"/)
    expect(workerMetrics).toContain('dlq_size')
    expect(apiMetrics + workerMetrics).not.toMatch(/tenant/i)
  })
})
