import { backfillTenantTemplateSnapshots } from '@fenwira/api/modules/templates'
import { type TemplateDraft } from '@fenwira/contracts'
import { Database, Prisma } from '@fenwira/database'
import { type MetaMockState, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member, waitForTemplate } from './support/workspace'

/**
 * Inbox template content, media filter and snapshot backfill (docs/INBOX.md → Template messages,
 * Media filter; docs/MESSAGING_ENGINE.md → Template snapshot) against the in-process meta-mock.
 */
const SECRET = 'test-app-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const phoneNo = () => `9195${String(Math.random()).slice(2, 10)}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })

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

type Setup = { owner: Member; phoneId: string; wabaRowId: string }
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
  return { owner, phoneId: res.body.data.id, wabaRowId: t.wabaId }
}

/** Create → submit → approved by the mock; returns the approved version id. */
async function approvedTemplate(s: Setup, draft: TemplateDraft): Promise<string> {
  const created = await s.owner.client.post('/templates', { ...draft, wabaId: s.wabaRowId })
  expect(created.status, created.text).toBe(201)
  const id = created.body.data.id
  const sub = await s.owner.client.post(
    `/templates/${id}/submit`,
    {},
    { 'Idempotency-Key': `sub-${metaId()}` },
  )
  expect(sub.status, sub.text).toBe(200)
  const ok = await waitFor(
    () => s.owner.client.get(`/templates/${id}`).then((r) => r.body.data),
    (x) => x.status === 'APPROVED',
  )
  return ok.currentVersion.id
}

async function uploadSample(s: Setup): Promise<string> {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)])
  const up = await s.owner.client.post('/templates/samples/upload-url', {
    mimeType: 'image/png',
    sizeBytes: png.length,
    filename: 'banner.png',
  })
  expect(up.status, up.text).toBe(201)
  const put = await fetch(up.body.data.url, {
    method: 'PUT',
    headers: up.body.data.headers,
    body: png,
  })
  expect(put.ok).toBe(true)
  await s.owner.client.post(`/templates/samples/${up.body.data.fileId}/complete`)
  return up.body.data.fileId
}

const send = (s: Setup, to: string, content: Record<string, unknown>) =>
  s.owner.client.post(
    '/conversations',
    { to: `+${to}`, phoneNumberId: s.phoneId, content },
    { 'Idempotency-Key': `send-${metaId()}` },
  )

const fullDraft = (name: string): TemplateDraft => ({
  name,
  language: 'en',
  category: 'UTILITY',
  components: {
    header: { format: 'TEXT', text: 'Hello {{1}}' },
    body: {
      text: 'Hi {{1}}, your kumquat voucher {{2}} is ready.\nUse it before the end of this month.',
    },
    footer: { text: 'Reply STOP to opt out' },
    buttons: [
      { type: 'QUICK_REPLY', text: 'Not now' },
      { type: 'URL', text: 'Open voucher', url: 'https://shop.example/v/{{1}}' },
      { type: 'PHONE_NUMBER', text: 'Call us', phoneE164: '+919876543210' },
      { type: 'COPY_CODE', example: 'SAVE10' },
    ],
  },
  samples: { header: ['Asha'], body: ['Asha', 'V-1'], buttons: { '1': ['V-1'] } },
})

const imageDraft = (name: string, fileId: string): TemplateDraft => ({
  name,
  language: 'en',
  category: 'UTILITY',
  components: {
    header: { format: 'IMAGE', sampleFileId: fileId },
    body: { text: 'Hi {{1}}, your order has shipped and arrives soon. Thank you!' },
  },
  samples: { body: ['Asha'] },
})

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
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 2 })
  mock.state.webhookTarget = {
    url: `${apiUrl}/api/v1/webhooks/whatsapp`,
    appSecret: SECRET,
    statuses: ['sent'],
    delayMs: 40,
  }
  mock.state.templateReview = { decision: 'APPROVED', delayMs: 100 }
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('template snapshot', () => {
  it('a send stores the rendered header, body, footer and every button type; search finds the body', async () => {
    const s = await setup('snap-send')
    const versionId = await approvedTemplate(s, fullDraft('voucher_ready'))
    const to = phoneNo()
    const sent = await send(s, to, {
      type: 'TEMPLATE',
      templateVersionId: versionId,
      variables: {
        header: ['Ravi'],
        body: ['Ravi', 'V-77'],
        buttons: { '1': ['V-77'], '3': ['RAVI15'] },
      },
    })
    expect(sent.status, sent.text).toBe(201)
    const expected = {
      v: 1,
      name: 'voucher_ready',
      language: 'en',
      category: 'UTILITY',
      header: { type: 'TEXT', text: 'Hello Ravi' },
      body: 'Hi Ravi, your kumquat voucher V-77 is ready.\nUse it before the end of this month.',
      footer: 'Reply STOP to opt out',
      buttons: [
        { type: 'QUICK_REPLY', label: 'Not now' },
        { type: 'URL', label: 'Open voucher', url: 'https://shop.example/v/V-77' },
        { type: 'PHONE_NUMBER', label: 'Call us', phoneE164: '+919876543210' },
        { type: 'COPY_CODE', label: 'Copy code', code: 'RAVI15' },
      ],
      variables: { header: ['Ravi'], body: ['Ravi', 'V-77'] },
      partial: false,
      missing: [],
    }
    expect(sent.body.data.templateSnapshot).toMatchObject(expected)

    const conversationId = sent.body.data.conversationId
    const thread = await s.owner.client.get(`/conversations/${conversationId}/messages`)
    const stored = thread.body.data.find((m: { id: string }) => m.id === sent.body.data.id)
    expect(stored.templateSnapshot).toMatchObject(expected)
    // The conversation list previews the rendered body, and search indexes it.
    const found = await s.owner.client.get('/conversations?q=kumquat')
    const hit = found.body.data.find((c: { id: string }) => c.id === conversationId)
    expect(hit?.snippet).toContain('kumquat voucher V-77')
    expect(hit?.lastMessagePreview).toContain('kumquat voucher V-77')
  })

  it('a send by name with raw Meta components keeps the values it sent', async () => {
    const s = await setup('snap-raw')
    const sent = await send(s, phoneNo(), {
      type: 'TEMPLATE',
      name: 'hello_world',
      language: 'en_US',
    })
    expect(sent.status, sent.text).toBe(201)
    expect(sent.body.data.templateSnapshot).toMatchObject({
      name: 'hello_world',
      language: 'en_US',
      partial: false,
    })
    expect(sent.body.data.templateSnapshot.body).toBeTruthy()
  })
})

describe('media filter', () => {
  it('template image headers count as images; the type filter pages and counts match', async () => {
    const s = await setup('media-filter')
    const sample = await uploadSample(s)
    const imageVersion = await approvedTemplate(s, imageDraft('order_banner', sample))
    const to = phoneNo()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = await send(s, to, {
        type: 'TEMPLATE',
        templateVersionId: imageVersion,
        variables: { body: [`N${i}`] },
      })
      expect(r.status, r.text).toBe(201)
      expect(r.body.data.templateSnapshot.header).toMatchObject({
        type: 'IMAGE',
        fileId: sample,
        filename: 'banner.png',
        mimeType: 'image/png',
      })
      ids.push(r.body.data.id)
    }
    const text = await send(s, to, { type: 'TEMPLATE', name: 'hello_world', language: 'en_US' })
    const conversationId = text.body.data.conversationId

    const counts = await s.owner.client.get(`/conversations/${conversationId}/media-counts`)
    expect(counts.status, counts.text).toBe(200)
    expect(counts.body.data).toEqual({ all: 4, image: 3, video: 0, document: 0 })

    const first = await s.owner.client.get(
      `/conversations/${conversationId}/messages?type=image&limit=2`,
    )
    expect(first.status, first.text).toBe(200)
    expect(first.body.data.map((m: { id: string }) => m.id)).toEqual([ids[2], ids[1]])
    expect(first.body.data[0].media).toMatchObject({
      fileId: sample,
      filename: 'banner.png',
      mimeType: 'image/png',
      sizeBytes: 72,
    })
    expect(first.body.page.nextCursor).toBeTruthy()
    const second = await s.owner.client.get(
      `/conversations/${conversationId}/messages?type=image&limit=2&before=${first.body.page.nextCursor}`,
    )
    expect(second.body.data.map((m: { id: string }) => m.id)).toEqual([ids[0]])
    expect(second.body.page.nextCursor).toBeNull()
    const none = await s.owner.client.get(`/conversations/${conversationId}/messages?type=video`)
    expect(none.body.data).toEqual([])
    const bad = await s.owner.client.get(`/conversations/${conversationId}/messages?type=sticker`)
    expect(bad.status).toBe(400)

    // The header (a template sample) can be opened from the inbox once a message used it.
    const link = await s.owner.client.get(`/files/${sample}/download-url`)
    expect(link.status, link.text).toBe(200)

    // Other workspaces see nothing (RLS + the conversation check).
    const other = await setup('media-filter-other')
    expect(
      (await other.owner.client.get(`/conversations/${conversationId}/media-counts`)).status,
    ).toBe(404)
    expect(
      (await other.owner.client.get(`/conversations/${conversationId}/messages?type=image`)).status,
    ).toBe(404)
  })
})

describe('snapshot backfill', () => {
  it('rebuilds missing snapshots identically, is idempotent, and marks unresolvable ones partial', async () => {
    const s = await setup('snap-backfill')
    const sample = await uploadSample(s)
    const fullVersion = await approvedTemplate(s, fullDraft('voucher_backfill'))
    const imageVersion = await approvedTemplate(s, imageDraft('banner_backfill', sample))
    const to = phoneNo()
    const full = await send(s, to, {
      type: 'TEMPLATE',
      templateVersionId: fullVersion,
      variables: { header: ['Mia'], body: ['Mia', 'V-9'], buttons: { '1': ['V-9'] } },
    })
    const image = await send(s, to, {
      type: 'TEMPLATE',
      templateVersionId: imageVersion,
      variables: { body: ['Mia'] },
    })
    const gone = await send(s, to, {
      type: 'TEMPLATE',
      templateVersionId: fullVersion,
      variables: { header: ['Zed'], body: ['Zed', 'V-1'], buttons: { '1': ['V-1'] } },
    })
    const originals = new Map(
      [full, image].map((r) => [r.body.data.id, r.body.data.templateSnapshot]),
    )
    const tenantId = s.owner.tenantId
    const conversationId = full.body.data.conversationId

    // Older messages: no snapshot. One of them points at a template that no longer resolves.
    await db.withTenant(tenantId, async (tx) => {
      await tx.message.updateMany({
        where: { conversationId, type: 'TEMPLATE' },
        data: { templateSnapshot: Prisma.DbNull },
      })
      await tx.message.update({
        where: { id: gone.body.data.id },
        data: {
          templateVersionId: null,
          content: {
            type: 'TEMPLATE',
            name: 'deleted_template',
            language: 'en',
            variables: { body: ['Zed', 'V-1'] },
          },
        },
      })
    })
    const empty = await s.owner.client.get(`/conversations/${conversationId}/media-counts`)
    expect(empty.body.data.image).toBe(0)

    const first = await backfillTenantTemplateSnapshots(db, tenantId, 2)
    expect(first).toEqual({ messages: 3, partial: 1 })
    const thread = (await s.owner.client.get(`/conversations/${conversationId}/messages`)).body
      .data as Array<{ id: string; templateSnapshot: Record<string, unknown> }>
    for (const [id, snapshot] of originals)
      expect(thread.find((m) => m.id === id)?.templateSnapshot).toEqual(snapshot)
    expect(thread.find((m) => m.id === gone.body.data.id)?.templateSnapshot).toMatchObject({
      name: 'deleted_template',
      language: 'en',
      body: null,
      variables: { body: ['Zed', 'V-1'] },
      partial: true,
      missing: ['template'],
    })
    // The generated media column followed the backfilled header.
    const counts = await s.owner.client.get(`/conversations/${conversationId}/media-counts`)
    expect(counts.body.data.image).toBe(1)

    // Running again changes nothing.
    expect(await backfillTenantTemplateSnapshots(db, tenantId, 2)).toEqual({
      messages: 0,
      partial: 0,
    })
  })
})
