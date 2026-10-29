import { type TemplateDraft } from '@fenwira/contracts'
import { type MetaMockState, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member, waitForTemplate } from './support/workspace'

/**
 * Meta-compatible send (docs/API_KEYS.md → Meta-compatible send): an integration built for Meta's
 * Cloud API sends through `/api/v1/graph` with only a Fenwira API key, end to end against the
 * in-process meta-mock.
 */
const SECRET = 'test-app-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const phoneNo = () => `9196${String(Math.random()).slice(2, 10)}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(256, 0x20)])

async function waitFor<T>(load: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  let value = await load()
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`)
    await new Promise((r) => setTimeout(r, 100))
    value = await load()
  }
  return value
}

type Setup = { owner: Member; metaPhoneId: string; wabaRowId: string; token: string }
async function setup(label: string): Promise<Setup> {
  const owner = await createOwner(api, label)
  const ids = { wabaId: metaId(), phoneNumberId: metaId() }
  await control('seed', { wabaId: ids.wabaId, phones: [{ id: ids.phoneNumberId }] })
  const res = await owner.client.post('/whatsapp/connections/dev', {
    ...ids,
    accessToken: `mock-dev:${ids.wabaId}`,
  })
  expect(res.status, res.text).toBe(201)
  await waitForTemplate(owner, 'hello_world')
  const t = (await owner.client.get('/templates?q=hello_world')).body.data[0]
  const key = await owner.client.post('/api-keys', { name: 'admin panel', scopes: ['inbox.reply'] })
  expect(key.status, key.text).toBe(201)
  return {
    owner,
    metaPhoneId: ids.phoneNumberId,
    wabaRowId: t.wabaId,
    token: key.body.data.secret,
  }
}

/** An approved DOCUMENT-header template, like an invoice; created with a sample PDF. */
async function invoiceTemplate(s: Setup, name: string) {
  const up = await s.owner.client.post('/templates/samples/upload-url', {
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
    filename: 'sample.pdf',
  })
  expect(up.status, up.text).toBe(201)
  await fetch(up.body.data.url, { method: 'PUT', headers: up.body.data.headers, body: PDF })
  await s.owner.client.post(`/templates/samples/${up.body.data.fileId}/complete`)
  const draft: TemplateDraft = {
    name,
    language: 'en',
    category: 'UTILITY',
    components: {
      header: { format: 'DOCUMENT', sampleFileId: up.body.data.fileId },
      body: { text: 'Hi {{1}}, your invoice {{2}} is attached to this message for your records.' },
    },
    samples: { body: ['Priya', 'INV-1'] },
  }
  const created = await s.owner.client.post('/templates', { ...draft, wabaId: s.wabaRowId })
  expect(created.status, created.text).toBe(201)
  const id = created.body.data.id
  await s.owner.client.post(`/templates/${id}/submit`, {}, { 'Idempotency-Key': `sub-${metaId()}` })
  await waitFor(
    () => s.owner.client.get(`/templates/${id}`).then((r) => r.body.data.status),
    (status) => status === 'APPROVED',
  )
}

const graph = (s: Setup, path: string) => ({
  get: () =>
    s.owner.client.agent.get(`/api/v1/graph/${path}`).set('Authorization', `Bearer ${s.token}`),
  post: (body: unknown) =>
    s.owner.client.agent
      .post(`/api/v1/graph/${path}`)
      .set('Authorization', `Bearer ${s.token}`)
      .send(body as object),
})

const sentTo = (to: string) => mock.state.sent.filter((m) => m.payload.to === to)

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    META_APP_ID: 'mock-app',
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  const apiUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
  mock.state.webhookTarget = {
    url: `${apiUrl}/api/v1/webhooks/whatsapp`,
    appSecret: SECRET,
    statuses: ['sent'],
    delayMs: 40,
  }
  mock.state.templateReview = { decision: 'APPROVED', delayMs: 100 }
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Meta-compatible send', () => {
  it('looks up the connected number by Meta id or `default`, and 404s any other', async () => {
    const s = await setup('graph-phone')
    const byId = await graph(s, s.metaPhoneId).get()
    expect(byId.status, byId.text).toBe(200)
    expect(byId.body).toMatchObject({ id: s.metaPhoneId })
    expect(byId.body.display_phone_number).toBeTruthy()
    expect((await graph(s, 'default').get()).body.id).toBe(s.metaPhoneId)
    expect((await graph(s, '123456789').get()).status).toBe(404)
  })

  it('uploads a PDF, then sends an invoice template with it, as Meta would; it lands in the Inbox', async () => {
    const s = await setup('graph-invoice')
    await invoiceTemplate(s, 'invoice_ready')
    const upload = await s.owner.client.agent
      .post(`/api/v1/graph/${s.metaPhoneId}/media`)
      .set('Authorization', `Bearer ${s.token}`)
      .field('messaging_product', 'whatsapp')
      .field('type', 'application/pdf')
      .attach('file', PDF, { filename: 'Invoice-45.pdf', contentType: 'application/pdf' })
    expect(upload.status, upload.text).toBe(200)

    const to = phoneNo()
    const sent = await graph(s, `${s.metaPhoneId}/messages`).post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'invoice_ready',
        language: { code: 'en' },
        components: [
          {
            type: 'header',
            parameters: [
              { type: 'document', document: { id: upload.body.id, filename: 'Invoice-45.pdf' } },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Priya' },
              { type: 'text', text: 'INV-45' },
            ],
          },
        ],
      },
    })
    expect(sent.status, sent.text).toBe(200)
    expect(sent.body).toMatchObject({
      messaging_product: 'whatsapp',
      contacts: [{ input: to, wa_id: to }],
      messages: [{ message_status: 'accepted' }],
    })

    const message = await waitFor(
      () => s.owner.client.get(`/messages/${sent.body.messages[0].id}`).then((r) => r.body.data),
      (m) => m?.status === 'SENT',
    )
    expect(message).toMatchObject({ source: 'API', direction: 'OUTBOUND' })
    // The worker uploaded our PDF to Meta and sent its media id in the header.
    const [payload] = sentTo(to).map((m) => m.payload)
    const header = (payload!.template as { components: Array<{ parameters: unknown[] }> })
      .components[0]!.parameters[0] as { document: { id: string; filename: string } }
    // The mock keeps the raw multipart upload body, so look for our PDF inside it.
    expect(mock.state.media.get(header.document.id)?.bytes.includes(PDF)).toBe(true)
    expect(header.document.filename).toBe('Invoice-45.pdf')
  })

  it('sends a media template whose header is a link, with no Fenwira file', async () => {
    const s = await setup('graph-link')
    await invoiceTemplate(s, 'quote_ready')
    const to = phoneNo()
    const link = 'https://files.example/Quotation-12.pdf'
    const sent = await graph(s, `${s.metaPhoneId}/messages`).post({
      to,
      type: 'template',
      template: {
        name: 'quote_ready',
        language: { code: 'en' },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { link } }] },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Priya' },
              { type: 'text', text: 'QT-12' },
            ],
          },
        ],
      },
    })
    expect(sent.status, sent.text).toBe(200)
    await waitFor(
      async () => sentTo(to).length,
      (n) => n === 1,
    )
    expect(JSON.stringify(sentTo(to)[0]!.payload)).toContain(link)
  })

  it('an Idempotency-Key makes a retry return the same message without sending twice', async () => {
    const s = await setup('graph-idem')
    const to = phoneNo()
    const body = {
      to,
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    }
    const key = `inv-${metaId()}`
    const send = () =>
      s.owner.client.agent
        .post(`/api/v1/graph/${s.metaPhoneId}/messages`)
        .set('Authorization', `Bearer ${s.token}`)
        .set('Idempotency-Key', key)
        .send(body)
    const first = await send()
    const second = await send()
    expect(first.status, first.text).toBe(200)
    expect(second.body.messages[0].id).toBe(first.body.messages[0].id)
    await waitFor(
      async () => sentTo(to).length,
      (n) => n >= 1,
    )
    await new Promise((r) => setTimeout(r, 300))
    expect(sentTo(to)).toHaveLength(1)
  })

  it('needs inbox.reply: a key without it gets 403', async () => {
    const s = await setup('graph-scope')
    const key = await s.owner.client.post('/api-keys', {
      name: 'read only',
      scopes: ['templates.read'],
    })
    const res = await s.owner.client.agent
      .post(`/api/v1/graph/${s.metaPhoneId}/messages`)
      .set('Authorization', `Bearer ${key.body.data.secret}`)
      .send({ to: phoneNo(), text: { body: 'Hi' } })
    expect(res.status).toBe(403)
  })
})
