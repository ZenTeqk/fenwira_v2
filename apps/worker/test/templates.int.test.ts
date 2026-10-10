import { TemplatesSyncProcessor } from '@fenwira/api/modules/templates'
import { type TemplateDraft, validateTemplate } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type MetaMockState, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { addMember, createOwner, type Member, waitForTemplate } from './support/workspace'

/**
 * Phase 8 acceptance (docs/prompts/PHASE_08_TEMPLATES.md) against the in-process meta-mock, which
 * reviews submitted templates and posts signed `message_template_status_update` webhooks.
 */
const SECRET = 'test-app-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let webhookUrl: string

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const phoneNo = () => `9196${String(Math.random()).slice(2, 10)}`
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) }).then(
    (r) => r.json() as Promise<Record<string, unknown>>,
  )

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

type Setup = {
  owner: Member
  ids: { wabaId: string; phoneNumberId: string }
  phoneId: string
  wabaRowId: string
}
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
  return { owner, ids, phoneId: res.body.data.id, wabaRowId: t.wabaId }
}

const orderDraft = (name: string): TemplateDraft => ({
  name,
  language: 'en',
  category: 'UTILITY',
  components: {
    header: { format: 'TEXT', text: 'Order {{1}}' },
    body: { text: 'Hi {{1}}, your order {{2}} has shipped and will arrive on {{3}}. Thank you!' },
    footer: { text: 'Reply STOP to opt out' },
    buttons: [
      { type: 'QUICK_REPLY', text: 'Talk to us' },
      { type: 'URL', text: 'Track order', url: 'https://shop.example/track/{{1}}' },
    ],
  },
  samples: {
    header: ['#1042'],
    body: ['Asha', '#1042', 'Friday'],
    buttons: { '1': ['1042'] },
  },
})

const getTemplate = (s: Setup, id: string) =>
  s.owner.client.get(`/templates/${id}`).then((r) => r.body.data)

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
  webhookUrl = `${apiUrl}/api/v1/webhooks/whatsapp`
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url, WHATSAPP_OUTBOUND_BACKOFF_MS: '20' })
  mock.state.webhookTarget = { url: webhookUrl, appSecret: SECRET, statuses: ['sent'], delayMs: 40 }
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Phase 8: templates', () => {
  it('round-trips: create → submit → approval webhook → APPROVED → sent with variables', async () => {
    mock.state.templateReview = { decision: 'APPROVED', delayMs: 300 }
    const s = await setup('tpl-roundtrip')
    const created = await s.owner.client.post('/templates', {
      ...orderDraft('order_shipped'),
      wabaId: s.wabaRowId,
    })
    expect(created.status, created.text).toBe(201)
    const t = created.body.data
    expect(t).toMatchObject({ status: 'DRAFT', currentVersion: { version: 1, status: 'DRAFT' } })

    const submitted = await s.owner.client.post(
      `/templates/${t.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    expect(submitted.status, submitted.text).toBe(200)
    expect(submitted.body.data.status).toBe('PENDING')
    // Meta got components with examples built from the samples.
    const call = mock.state.calls.find(
      (c) => c.method === 'POST' && c.path === `${s.ids.wabaId}/message_templates`,
    )
    expect(call?.body).toMatchObject({
      name: 'order_shipped',
      category: 'UTILITY',
      components: expect.arrayContaining([
        {
          type: 'BODY',
          text: expect.any(String),
          example: { body_text: [['Asha', '#1042', 'Friday']] },
        },
      ]),
    })

    const approved = await waitFor(
      () => getTemplate(s, t.id),
      (x) => x.status === 'APPROVED',
    )
    expect(approved.approvedVersionId).toBe(approved.currentVersion.id)
    expect(approved.currentVersion.decidedAt).toBeTruthy()
    // Owner (the creator) was notified.
    const notes = (await s.owner.client.get('/notifications')).body.data
    expect(
      notes.some(
        (n: { type: string; title: string }) =>
          n.type === 'template.status.changed' && /approved/.test(n.title),
      ),
    ).toBe(true)

    // The inbox picker lists it; a send with every variable reaches Meta with parameters.
    const picker = (await s.owner.client.get(`/templates/approved?phoneNumberId=${s.phoneId}`)).body
      .data
    const entry = picker.find((p: { name: string }) => p.name === 'order_shipped')
    expect(entry).toMatchObject({ versionId: approved.currentVersion.id, category: 'UTILITY' })

    const to = phoneNo()
    const missing = await s.owner.client.post(
      '/conversations',
      {
        to: `+${to}`,
        phoneNumberId: s.phoneId,
        content: {
          type: 'TEMPLATE',
          templateVersionId: entry.versionId,
          variables: { body: ['Asha'] },
        },
      },
      { 'Idempotency-Key': `send-${metaId()}` },
    )
    expect([missing.status, missing.body.error.code]).toEqual([422, 'TEMPLATE_VARIABLES_INVALID'])
    const sent = await s.owner.client.post(
      '/conversations',
      {
        to: `+${to}`,
        phoneNumberId: s.phoneId,
        content: {
          type: 'TEMPLATE',
          templateVersionId: entry.versionId,
          variables: { header: ['#77'], body: ['Ravi', '#77', 'Monday'], buttons: { '1': ['77'] } },
        },
      },
      { 'Idempotency-Key': `send-${metaId()}` },
    )
    expect(sent.status, sent.text).toBe(201)
    expect(sent.body.data.content).toMatchObject({ name: 'order_shipped', category: 'UTILITY' })
    const payload = await waitFor(
      async () => mock.state.sent.find((m) => m.payload.to === to)?.payload,
      (p) => !!p,
    )
    expect(payload).toMatchObject({
      type: 'template',
      template: {
        name: 'order_shipped',
        language: { code: 'en' },
        components: [
          { type: 'header', parameters: [{ type: 'text', text: '#77' }] },
          {
            type: 'body',
            parameters: [{ text: 'Ravi' }, { text: '#77' }, { text: 'Monday' }].map((p) => ({
              type: 'text',
              ...p,
            })),
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '1',
            parameters: [{ type: 'text', text: '77' }],
          },
        ],
      },
    })
  })

  it('a rejection shows Meta’s reason; editing creates version 2 and version 1 stays unchanged', async () => {
    const s = await setup('tpl-reject')
    mock.state.templateReview = { decision: 'REJECTED', reason: 'INVALID_FORMAT', delayMs: 200 }
    const t = (
      await s.owner.client.post('/templates', {
        ...orderDraft('order_rejected'),
        wabaId: s.wabaRowId,
      })
    ).body.data
    await s.owner.client.post(
      `/templates/${t.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    const rejected = await waitFor(
      () => getTemplate(s, t.id),
      (x) => x.status === 'REJECTED',
    )
    expect(rejected.currentVersion).toMatchObject({
      version: 1,
      status: 'REJECTED',
      rejectionReason: 'INVALID_FORMAT',
    })

    // A rejected (or approved) version is immutable: PATCH is refused; a new version is a draft.
    expect(
      (await s.owner.client.patch(`/templates/${t.id}`, { samples: { body: ['x', 'y', 'z'] } }))
        .status,
    ).toBe(409)
    const v2 = (await s.owner.client.post(`/templates/${t.id}/versions`)).body.data
    expect(v2.currentVersion).toMatchObject({ version: 2, status: 'DRAFT' })
    const edited = await s.owner.client.patch(`/templates/${t.id}`, {
      components: {
        ...orderDraft('x').components,
        footer: { text: 'Thanks for shopping with us' },
      },
    })
    expect(edited.status, edited.text).toBe(200)
    const versions = (await s.owner.client.get(`/templates/${t.id}/versions`)).body.data
    expect(versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual(
      [
        [2, 'DRAFT'],
        [1, 'REJECTED'],
      ],
    )
    expect(versions[1].components.footer.text).toBe('Reply STOP to opt out')
    expect(versions[1].rejectionReason).toBe('INVALID_FORMAT')

    // Resubmitting v2 edits the same Meta template; approval advances approved_version_id.
    mock.state.templateReview = { decision: 'APPROVED', delayMs: 200 }
    const resub = await s.owner.client.post(
      `/templates/${t.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    expect(resub.status, resub.text).toBe(200)
    expect(
      mock.state.calls.some((c) => c.method === 'POST' && c.path === versions[1].metaTemplateId),
    ).toBe(true)
    const ok = await waitFor(
      () => getTemplate(s, t.id),
      (x) => x.status === 'APPROVED',
    )
    expect(ok.approvedVersionId).toBe(v2.currentVersion.id)
  })

  it('while version 2 is under review, the approved version 1 stays usable', async () => {
    mock.state.templateReview = { decision: 'APPROVED', delayMs: 150 }
    const s = await setup('tpl-inreview')
    const t = (
      await s.owner.client.post('/templates', {
        ...orderDraft('order_v1_live'),
        wabaId: s.wabaRowId,
      })
    ).body.data
    await s.owner.client.post(
      `/templates/${t.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    const v1 = await waitFor(
      () => getTemplate(s, t.id),
      (x) => x.status === 'APPROVED',
    )
    mock.state.templateReview = { decision: 'NONE' }
    await s.owner.client.post(`/templates/${t.id}/versions`)
    await s.owner.client.post(
      `/templates/${t.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    const pending = await getTemplate(s, t.id)
    expect(pending).toMatchObject({ status: 'PENDING', approvedVersionId: v1.currentVersion.id })
    const picker = (await s.owner.client.get('/templates/approved')).body.data
    expect(picker.find((p: { name: string }) => p.name === 'order_v1_live')?.versionId).toBe(
      v1.currentVersion.id,
    )
    // Meta can't edit a template while it is under review.
    expect((await s.owner.client.post(`/templates/${t.id}/versions`)).status).toBe(409)
  })

  it('invalid templates are blocked identically by the shared schema (UI) and the API', async () => {
    const s = await setup('tpl-invalid')
    const base = orderDraft('bad_template')
    const cases: Array<[string, TemplateDraft, string]> = [
      [
        'variable gap',
        {
          ...base,
          components: {
            ...base.components,
            body: { text: 'Hi {{1}}, your order {{3}} is ready now.' },
          },
        },
        'TEMPLATE_VARIABLES_NOT_SEQUENTIAL',
      ],
      [
        'missing sample',
        { ...base, samples: { ...base.samples, body: ['Asha', '', 'Friday'] } },
        'TEMPLATE_SAMPLE_MISSING',
      ],
      [
        'too many buttons',
        {
          ...base,
          components: {
            ...base.components,
            buttons: Array.from({ length: 11 }, (_, i) => ({
              type: 'QUICK_REPLY' as const,
              text: `Option ${i}`,
            })),
          },
        },
        'TEMPLATE_BUTTONS_INVALID',
      ],
    ]
    for (const [label, draft, code] of cases) {
      const shared = validateTemplate(draft)
      expect(shared.valid, label).toBe(false)
      expect(
        shared.errors.map((e) => e.code),
        label,
      ).toContain(code)
      // The API's dry run returns exactly the shared codes.
      const dry = (
        await s.owner.client.post('/templates/validate', { ...draft, wabaId: s.wabaRowId })
      ).body.data
      expect(dry.errors.map((e: { code: string }) => e.code).sort(), label).toEqual(
        shared.errors.map((e) => e.code).sort(),
      )
      // And a submit of the same draft is refused with them.
      const t = (
        await s.owner.client.post('/templates', {
          ...draft,
          name: `bad_${metaId()}`,
          wabaId: s.wabaRowId,
        })
      ).body.data
      const submit = await s.owner.client.post(
        `/templates/${t.id}/submit`,
        {},
        { 'Idempotency-Key': `sub-${metaId()}` },
      )
      expect([submit.status, submit.body.error.code], label).toEqual([422, 'TEMPLATE_INVALID'])
      expect(
        submit.body.error.details.errors.map((e: { code: string }) => e.code),
        label,
      ).toContain(code)
    }
    // A name taken in the same language is refused.
    expect(
      (
        await s.owner.client.post('/templates', {
          ...base,
          name: 'hello_world',
          language: 'en_US',
          wabaId: s.wabaRowId,
        })
      ).body.error.code,
    ).toBe('TEMPLATE_NAME_TAKEN')
  })

  it('a network failure on submit leaves the version DRAFT and retryable, never REJECTED', async () => {
    mock.state.templateReview = { decision: 'APPROVED', delayMs: 150 }
    const s = await setup('tpl-network')
    const t = (
      await s.owner.client.post('/templates', { ...orderDraft('order_retry'), wabaId: s.wabaRowId })
    ).body.data
    await control('fail', {
      pathContains: `${s.ids.wabaId}/message_templates`,
      method: 'POST',
      status: 503,
      code: 2,
      times: 1,
    })
    const failed = await s.owner.client.post(
      `/templates/${t.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    expect([failed.status, failed.body.error.code]).toEqual([503, 'UPSTREAM_UNAVAILABLE'])
    const draft = await getTemplate(s, t.id)
    expect(draft).toMatchObject({
      status: 'DRAFT',
      currentVersion: { status: 'DRAFT', metaTemplateId: null },
    })
    expect(draft.currentVersion.lastError).toMatch(/Temporary Meta error/)
    // A token problem is not a rejection either.
    await control('fail', {
      pathContains: `${s.ids.wabaId}/message_templates`,
      method: 'POST',
      status: 401,
      code: 190,
      times: 1,
    })
    expect(
      (
        await s.owner.client.post(
          `/templates/${t.id}/submit`,
          {},
          { 'Idempotency-Key': `sub-${metaId()}` },
        )
      ).status,
    ).toBe(503)
    expect((await getTemplate(s, t.id)).status).toBe('DRAFT')
    // Retry succeeds.
    const retry = await s.owner.client.post(
      `/templates/${t.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    expect(retry.status, retry.text).toBe(200)
    await waitFor(
      () => getTemplate(s, t.id),
      (x) => x.status === 'APPROVED',
    )
    // Meta's own validation error (4xx) IS a rejection, with Meta's message.
    const t2 = (
      await s.owner.client.post('/templates', {
        ...orderDraft('order_meta_refuses'),
        wabaId: s.wabaRowId,
      })
    ).body.data
    await control('fail', {
      pathContains: `${s.ids.wabaId}/message_templates`,
      method: 'POST',
      status: 400,
      code: 100,
      message: 'Param components[1] is invalid',
      times: 1,
    })
    const refused = await s.owner.client.post(
      `/templates/${t2.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    expect(refused.status).toBe(200)
    expect(refused.body.data).toMatchObject({
      status: 'REJECTED',
      currentVersion: { rejectionReason: 'Param components[1] is invalid' },
    })
  })

  it('a lost submit response is adopted on retry instead of duplicating the template', async () => {
    mock.state.templateReview = { decision: 'NONE' }
    const s = await setup('tpl-adopt')
    const t = (
      await s.owner.client.post('/templates', { ...orderDraft('order_adopt'), wabaId: s.wabaRowId })
    ).body.data
    // Meta already has it (created by a submit whose response we never saw).
    await control('templates', {
      wabaId: s.ids.wabaId,
      add: [
        {
          name: 'order_adopt',
          language: 'en',
          category: 'UTILITY',
          status: 'PENDING',
          components: [],
        },
      ],
    })
    const res = await s.owner.client.post(
      `/templates/${t.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    expect(res.status, res.text).toBe(200)
    expect(res.body.data.status).toBe('PENDING')
    expect(res.body.data.currentVersion.metaTemplateId).toBeTruthy()
  })

  it('syncs from Meta: imports outside templates; pause, quality and category webhooks apply', async () => {
    const s = await setup('tpl-sync')
    await control('templates', {
      wabaId: s.ids.wabaId,
      add: [
        {
          name: 'flash_offer',
          language: 'en',
          category: 'MARKETING',
          status: 'APPROVED',
          components: [
            {
              type: 'BODY',
              text: 'Hi {{1}}, today only: extra savings on your favourites.',
              example: { body_text: [['Asha']] },
            },
            { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Shop now' }] },
          ],
        },
      ],
    })
    const synced = await s.owner.client.post('/templates/sync', {})
    expect(synced.status, synced.text).toBe(200)
    expect(synced.body.data[0]).toMatchObject({ imported: 1 })
    const list = (await s.owner.client.get('/templates?category=MARKETING')).body.data
    const offer = list.find((x: { name: string }) => x.name === 'flash_offer')
    expect(offer).toMatchObject({
      status: 'APPROVED',
      currentVersion: {
        origin: 'META',
        samples: { body: ['Asha'] },
        components: { buttons: [{ type: 'QUICK_REPLY', text: 'Shop now' }] },
      },
    })
    const metaTemplateId = offer.currentVersion.metaTemplateId

    await control('template-event', { id: metaTemplateId, quality: 'YELLOW' })
    await waitFor(
      () => getTemplate(s, offer.id),
      (x) => x.qualityScore === 'YELLOW',
    )
    await control('template-event', { id: metaTemplateId, event: 'PAUSED' })
    await waitFor(
      () => getTemplate(s, offer.id),
      (x) => x.status === 'PAUSED',
    )
    // A paused template leaves the picker and can't be sent.
    const picker = (await s.owner.client.get('/templates/approved')).body.data
    expect(picker.map((p: { name: string }) => p.name)).not.toContain('flash_offer')
    const blocked = await s.owner.client.post(
      '/conversations',
      {
        to: `+${phoneNo()}`,
        phoneNumberId: s.phoneId,
        content: { type: 'TEMPLATE', name: 'flash_offer', language: 'en' },
      },
      { 'Idempotency-Key': `send-${metaId()}` },
    )
    expect([blocked.status, blocked.body.error.code]).toEqual([422, 'TEMPLATE_NOT_APPROVED'])
    await control('template-event', { id: metaTemplateId, event: 'APPROVED' })
    await waitFor(
      () => getTemplate(s, offer.id),
      (x) => x.status === 'APPROVED',
    )

    // Meta re-categorizes: the template follows, and owners are told.
    const utility = (
      await s.owner.client.post('/templates', { ...orderDraft('order_recat'), wabaId: s.wabaRowId })
    ).body.data
    mock.state.templateReview = { decision: 'APPROVED', delayMs: 100 }
    await s.owner.client.post(
      `/templates/${utility.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    const approved = await waitFor(
      () => getTemplate(s, utility.id),
      (x) => x.status === 'APPROVED',
    )
    await control('template-event', {
      id: approved.currentVersion.metaTemplateId,
      category: 'MARKETING',
    })
    await waitFor(
      () => getTemplate(s, utility.id),
      (x) => x.category === 'MARKETING',
    )

    // Edited in WhatsApp Manager: the next sync records a Meta-originated version.
    const remote = mock.state.wabas.get(s.ids.wabaId)!.templates.get(metaTemplateId)!
    remote.components = [
      {
        type: 'BODY',
        text: 'Hi {{1}}, today only: new savings on your favourites.',
        example: { body_text: [['Asha']] },
      },
    ]
    const before = (await s.owner.client.get(`/templates/${offer.id}/versions`)).body.data.length
    await s.owner.client.post('/templates/sync', {})
    const after = (await s.owner.client.get(`/templates/${offer.id}/versions`)).body.data
    expect(after).toHaveLength(before + 1)
    expect(after[0]).toMatchObject({
      origin: 'META',
      status: 'APPROVED',
      components: { body: { text: 'Hi {{1}}, today only: new savings on your favourites.' } },
    })
    // The previously approved version is superseded, and a re-sync changes nothing.
    expect(after[1].status).toBe('ARCHIVED')
    await s.owner.client.post('/templates/sync', {})
    expect((await s.owner.client.get(`/templates/${offer.id}/versions`)).body.data).toHaveLength(
      before + 1,
    )
  })

  it('media headers: the sample goes through the resumable upload; a send uploads the file', async () => {
    mock.state.templateReview = { decision: 'APPROVED', delayMs: 100 }
    const s = await setup('tpl-media')
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
    expect(
      (await s.owner.client.post(`/templates/samples/${up.body.data.fileId}/complete`)).body.data
        .status,
    ).toBe('READY')
    const draft = orderDraft('order_banner')
    const created = await s.owner.client.post('/templates', {
      ...draft,
      wabaId: s.wabaRowId,
      components: {
        ...draft.components,
        header: { format: 'IMAGE', sampleFileId: up.body.data.fileId },
      },
      samples: { ...draft.samples, header: [] },
    })
    expect(created.status, created.text).toBe(201)
    const sub = await s.owner.client.post(
      `/templates/${created.body.data.id}/submit`,
      {},
      { 'Idempotency-Key': `sub-${metaId()}` },
    )
    expect(sub.status, sub.text).toBe(200)
    const uploadCall = mock.state.calls.find((c) => c.path.startsWith('upload:'))
    expect(uploadCall?.authorization).toMatch(/^OAuth /)
    const createCall = mock.state.calls
      .filter((c) => c.path === `${s.ids.wabaId}/message_templates` && c.method === 'POST')
      .at(-1)
    expect(JSON.stringify(createCall?.body)).toContain('header_handle')
    const ok = await waitFor(
      () => getTemplate(s, created.body.data.id),
      (x) => x.status === 'APPROVED',
    )

    const to = phoneNo()
    const sent = await s.owner.client.post(
      '/conversations',
      {
        to: `+${to}`,
        phoneNumberId: s.phoneId,
        content: {
          type: 'TEMPLATE',
          templateVersionId: ok.currentVersion.id,
          variables: { body: ['A', 'B', 'C'], buttons: { '1': ['9'] } },
        },
      },
      { 'Idempotency-Key': `send-${metaId()}` },
    )
    expect(sent.status, sent.text).toBe(201)
    const payload = await waitFor(
      async () => mock.state.sent.find((m) => m.payload.to === to)?.payload,
      (p) => !!p,
    )
    const header = (
      payload!.template as {
        components: Array<{ type: string; parameters: Array<{ image?: { id: string } }> }>
      }
    ).components.find((c) => c.type === 'header')
    expect(header?.parameters[0]?.image?.id).toMatch(/^media/)
  })

  it('AGENT reads and sends but can’t write or submit; other tenants see nothing', async () => {
    const s = await setup('tpl-rbac')
    const agent = await addMember(api, s.owner, 'AGENT')
    const draft = { ...orderDraft('agent_try'), wabaId: s.wabaRowId }
    expect((await agent.client.get('/templates')).status).toBe(200)
    expect((await agent.client.get('/templates/approved')).status).toBe(200)
    expect((await agent.client.post('/templates', draft)).status).toBe(403)
    const t = (await s.owner.client.post('/templates', draft)).body.data
    expect(
      (
        await agent.client.post(
          `/templates/${t.id}/submit`,
          {},
          { 'Idempotency-Key': `x-${metaId()}` },
        )
      ).status,
    ).toBe(403)
    const other = await setup('tpl-other')
    expect((await other.owner.client.get(`/templates/${t.id}`)).status).toBe(404)
    const names = (await other.owner.client.get('/templates')).body.data.map(
      (x: { name: string }) => x.name,
    )
    expect(names).not.toContain('agent_try')
    // Using another tenant's version id to send is refused.
    const hello = await waitForTemplate(s.owner, 'hello_world')
    const cross = await other.owner.client.post(
      '/conversations',
      {
        to: `+${phoneNo()}`,
        phoneNumberId: other.phoneId,
        content: {
          type: 'TEMPLATE',
          templateVersionId: hello.currentVersion.id,
          variables: { body: [] },
        },
      },
      { 'Idempotency-Key': `x-${metaId()}` },
    )
    expect([cross.status, cross.body.error.code]).toEqual([422, 'TEMPLATE_NOT_APPROVED'])
  })

  it('deleting removes the template at Meta, in every language', async () => {
    mock.state.templateReview = { decision: 'APPROVED', delayMs: 100 }
    const s = await setup('tpl-delete')
    const en = (
      await s.owner.client.post('/templates', { ...orderDraft('order_gone'), wabaId: s.wabaRowId })
    ).body.data
    const hi = (
      await s.owner.client.post('/templates', {
        ...orderDraft('order_gone'),
        language: 'hi',
        wabaId: s.wabaRowId,
      })
    ).body.data
    for (const t of [en, hi])
      await s.owner.client.post(
        `/templates/${t.id}/submit`,
        {},
        { 'Idempotency-Key': `sub-${metaId()}` },
      )
    expect((await s.owner.client.delete(`/templates/${en.id}`)).status).toBe(204)
    expect(
      mock.state.calls.some(
        (c) => c.method === 'DELETE' && c.path === `${s.ids.wabaId}/message_templates`,
      ),
    ).toBe(true)
    expect((await s.owner.client.get(`/templates/${hi.id}`)).status).toBe(404)
    const audit = (await s.owner.client.get('/audit-logs?limit=50')).body.data.map(
      (a: { action: string }) => a.action,
    )
    expect(audit).toEqual(
      expect.arrayContaining(['template.created', 'template.submitted', 'template.deleted']),
    )
  })

  it('overlapping syncs of one WABA are serialized (no duplicate import, no error)', async () => {
    const s = await setup('tpl-sync-race')
    await control('templates', {
      wabaId: s.ids.wabaId,
      add: [
        {
          name: 'race_one',
          language: 'en',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [{ type: 'BODY', text: 'A race test message body.' }],
        },
      ],
    })
    const results = await Promise.all(
      Array.from({ length: 4 }, () => s.owner.client.post('/templates/sync', {})),
    )
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200])
    const found = (await s.owner.client.get('/templates?q=race_one')).body.data
    expect(found).toHaveLength(1)
  })

  it('the 6-hourly sync fans out to due WABAs only (X14)', async () => {
    const s = await setup('tpl-fanout')
    const db = worker.get(Database)
    const due = async (at: number) =>
      (await db.system.wabasDueForTemplateSync(new Date(at - 6 * 3600_000), 100_000)).map(
        (d) => d.wabaId,
      )
    // Synced on connect: not due now, due once 6 hours have passed.
    expect(await due(Date.now())).not.toContain(s.wabaRowId)
    expect(await due(Date.now() + 7 * 3600_000)).toContain(s.wabaRowId)
    // The fan-out enqueues due WABAs (capped per run).
    expect(
      await worker.get(TemplatesSyncProcessor).fanOut(new Date(Date.now() + 7 * 3600_000)),
    ).toBeGreaterThan(0)
  })
})
