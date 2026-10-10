import { MessagingService } from '@fenwira/api/modules/messaging'
import { type ContactFilter, type FilterRule } from '@fenwira/contracts'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
} from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import fc from 'fast-check'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import Papa from 'papaparse'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'

/** Phase 6 acceptance (docs/prompts/PHASE_06_CONTACTS_CONSENT.md). */
const SECRET = 'contacts-test-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let webhookUrl: string

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })

async function waitFor<T>(load: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let value = await load()
  while (!done(value)) {
    if (Date.now() > deadline) throw new Error(`timed out; last value ${JSON.stringify(value)}`)
    await new Promise((r) => setTimeout(r, 200))
    value = await load()
  }
  return value
}

/** Uploads a CSV through the presigned flow and returns the READY file id. */
async function uploadCsv(owner: Member, csv: string, filename = 'contacts.csv') {
  const bytes = Buffer.from(csv, 'utf8')
  const upload = await owner.client.post('/imports/upload-url', {
    mimeType: 'text/csv',
    sizeBytes: bytes.length,
    filename,
  })
  expect(upload.status, upload.text).toBe(201)
  const put = await fetch(upload.body.data.url, {
    method: 'PUT',
    headers: upload.body.data.headers,
    body: bytes,
  })
  expect(put.status).toBe(200)
  return upload.body.data.fileId as string
}

/** Full import: upload → analyze → map → validate → confirm → completed. */
async function runImport(
  owner: Member,
  csv: string,
  mapping: Record<string, string>,
  opts: { policy?: 'SKIP' | 'UPDATE'; timeoutMs?: number } = {},
) {
  const fileId = await uploadCsv(owner, csv)
  const created = await owner.client.post('/imports', { fileId })
  expect(created.status, created.text).toBe(201)
  const id = created.body.data.id as string
  const get = async () => {
    const response = await owner.client.get(`/imports/${id}`)
    expect(response.status, JSON.stringify(response.body.error)).toBe(200)
    return response.body.data
  }
  const t = opts.timeoutMs ?? 60_000
  await waitFor(get, (j) => j.status === 'MAPPING', t)
  const configured = await owner.client.patch(`/imports/${id}`, {
    columnMapping: mapping,
    duplicatePolicy: opts.policy ?? 'SKIP',
  })
  expect(configured.status, configured.text).toBe(200)
  const preview = await waitFor(get, (j) => j.status === 'PREVIEW_READY', t)
  expect((await owner.client.post(`/imports/${id}/confirm`)).status).toBe(200)
  const done = await waitFor(get, (j) => ['COMPLETED', 'FAILED'].includes(j.status), t)
  return { id, preview, done }
}

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
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('contacts', () => {
  it('normalizes phones, rejects duplicates, and soft-deletes with an audit entry', async () => {
    const owner = await createOwner(api, 'ct-crud')
    const created = await owner.client.post('/contacts', { phone: '98765 43210', name: 'Asha' })
    expect(created.status, created.text).toBe(201)
    expect(created.body.data).toMatchObject({
      phoneE164: '+919876543210',
      country: 'IN',
      source: 'MANUAL',
    })
    const bad = await owner.client.post('/contacts', { phone: '12345' })
    expect([bad.status, bad.body.error.code]).toEqual([422, 'INVALID_PHONE'])
    const dup = await owner.client.post('/contacts', { phone: '+91 98765 43210' })
    expect(dup.status).toBe(409)

    const id = created.body.data.id
    expect((await owner.client.delete(`/contacts/${id}`)).status).toBe(204)
    expect((await owner.client.get(`/contacts/${id}`)).status).toBe(404)
    const audit = await owner.client.get('/audit-logs?action=contact.deleted')
    expect(audit.body.data[0]).toMatchObject({ targetId: id, action: 'contact.deleted' })
    // The phone is free again.
    expect((await owner.client.post('/contacts', { phone: '+919876543210' })).status).toBe(201)
  })

  it('imports 50k rows with 5% invalid and 10% duplicates; counts and error CSV match', async () => {
    const owner = await createOwner(api, 'ct-import')
    const phone = (i: number) => `98${String(10_000_000 + i).slice(-8)}`
    // 5,000 contacts exist before the big import.
    const seed = [
      'phone,name',
      ...Array.from({ length: 5000 }, (_, i) => `${phone(i)},Seed ${i}`),
    ].join('\n')
    const first = await runImport(owner, seed, { phone: 'phone', name: 'name' })
    expect(first.done.counts).toMatchObject({ created: 5000, invalid: 0 })

    // 50,000 rows: 42,500 new, 5,000 already existing (10%), 2,500 invalid phones (5%).
    const lines = ['Mobile,Full Name,Email,Tags,Consent']
    const invalidRows: number[] = []
    for (let i = 0; i < 50_000; i++) {
      if (i % 20 === 7) {
        lines.push(`12345,Broken ${i},,,`)
        invalidRows.push(i + 2)
      } else if (i % 10 === 3) lines.push(`${phone(Math.floor(i / 10))},Existing ${i},,,`)
      else
        lines.push(
          `${phone(100_000 + i)},New ${i},new${i}@example.com,vip;import,${i % 2 ? 'yes' : 'no'}`,
        )
    }
    const big = await runImport(
      owner,
      lines.join('\n'),
      {
        Mobile: 'phone',
        'Full Name': 'name',
        Email: 'email',
        Tags: 'tags',
        Consent: 'consent.marketing',
      },
      { timeoutMs: 240_000 },
    )
    expect(big.preview.suggestedMapping).toEqual({
      Mobile: 'phone',
      'Full Name': 'name',
      Email: 'email',
      Tags: 'tags',
      Consent: 'consent.marketing',
    })
    expect(big.preview.counts).toMatchObject({
      total: 50_000,
      valid: 47_500,
      invalid: 2500,
      new: 42_500,
      existing: 5000,
    })
    expect(big.done.status).toBe('COMPLETED')
    expect(big.done.counts).toMatchObject({
      processed: 50_000,
      created: 42_500,
      skipped: 5000,
      updated: 0,
      invalid: 2500,
    })
    const total = await owner.client.post('/contacts/count', {})
    expect(total.body.data.count).toBe(47_500)
    const vip = await owner.client.post('/contacts/count', { q: 'New 1' })
    expect(vip.body.data.count).toBeGreaterThan(0)

    const report = await owner.client.get(`/imports/${big.id}/error-report`)
    const csv = await (await fetch(report.body.data.url)).text()
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
    expect(parsed.data).toHaveLength(2500)
    expect(parsed.data.map((r) => Number(r.error_row))).toEqual(invalidRows)
    expect(parsed.data.every((r) => r.error_code === 'INVALID_PHONE' && r.Mobile === '12345')).toBe(
      true,
    )
    expect(parsed.data[0]!['Full Name']).toBe('Broken 7')

    // Imported consent carries its evidence.
    const sample = await owner.client.post('/contacts/search', { q: 'New 1', limit: 1 })
    const consents = await owner.client.get(`/contacts/${sample.body.data[0].id}/consents`)
    expect(consents.body.data[0]).toMatchObject({
      source: 'IMPORT',
      evidence: { importJobId: big.id },
    })
  }, 300_000)

  it('exports the filtered contacts as a CSV and audit-logs it', async () => {
    const owner = await createOwner(api, 'ct-export')
    for (const [p, n] of [
      ['9811111111', 'Ravi'],
      ['9822222222', 'Meena'],
      ['9833333333', 'Ravi K'],
    ])
      await owner.client.post('/contacts', { phone: p, name: n })
    const filter = { op: 'AND', rules: [{ field: 'name', operator: 'STARTS_WITH', value: 'ravi' }] }
    const res = await owner.client.post('/exports', { filter })
    expect(res.status, res.text).toBe(202)
    const done = await waitFor(
      () => owner.client.get(`/exports/${res.body.data.id}`).then((r) => r.body.data),
      (e) => e.status === 'COMPLETED',
    )
    expect(done.rowCount).toBe(2)
    const csv = await (await fetch(done.downloadUrl)).text()
    const rows = Papa.parse<Record<string, string>>(csv, {
      header: true,
      skipEmptyLines: true,
    }).data
    expect(rows.map((r) => r.name).sort()).toEqual(['Ravi', 'Ravi K'])
    const audit = await owner.client.get('/audit-logs?action=contacts.exported')
    expect(audit.body.data[0].changes).toMatchObject({ rows: 2 })
  })
})

describe('consent', () => {
  async function connected(label: string) {
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
  const customer = () => `9197${String(Math.random()).slice(2, 10)}`

  it('an inbound STOP revokes marketing consent within seconds, with the message as evidence', async () => {
    const { owner, ids } = await connected('ct-stop')
    const from = customer()
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(ids, { from, wamid: `wamid.${metaId()}`, text: 'Hi' }),
    )
    const contact = await waitFor(
      () =>
        owner.client.post('/contacts/search', { q: from.slice(-6) }).then((r) => r.body.data[0]),
      (c) => !!c,
    )
    const granted = await owner.client.post(`/contacts/${contact.id}/consents`, {
      purpose: 'MARKETING',
      status: 'GRANTED',
      note: 'Signed up at the store counter',
    })
    expect(granted.body.data.marketingConsent).toBe('GRANTED')

    const stopWamid = `wamid.${metaId()}`
    const sentAt = Date.now()
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(ids, { from, wamid: stopWamid, text: '  stop ' }),
    )
    await waitFor(
      () => owner.client.get(`/contacts/${contact.id}`).then((r) => r.body.data.marketingConsent),
      (s) => s === 'REVOKED',
      10_000,
    )
    expect(Date.now() - sentAt).toBeLessThan(10_000)
    const history = (await owner.client.get(`/contacts/${contact.id}/consents`)).body.data
    const stopMessage = (await owner.client.get(`/conversations`)).body.data[0]
    const messages = (await owner.client.get(`/conversations/${stopMessage.id}/messages`)).body.data
    const inboundStop = messages.find(
      (m: { content: { text?: string } }) => m.content.text?.trim() === 'stop',
    )
    expect(history[0]).toMatchObject({
      purpose: 'MARKETING',
      status: 'REVOKED',
      source: 'INBOUND_KEYWORD',
      evidence: { messageId: inboundStop.id, keyword: 'STOP' },
    })
    expect(history[1]).toMatchObject({ status: 'GRANTED', revokeSource: 'INBOUND_KEYWORD' })
    // The confirmation reply went out through the messaging engine.
    await waitFor(
      async () => mock.state.sent.filter((m) => m.phoneNumberId === ids.phoneNumberId),
      (s) =>
        s.some((m) => String((m.payload.text as { body?: string })?.body).includes('unsubscribed')),
    )
    // A repeated STOP adds nothing; START opts back in.
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(ids, { from, wamid: `wamid.${metaId()}`, text: 'STOP' }),
    )
    await new Promise((r) => setTimeout(r, 1500)) // keywords are processed concurrently; keep order
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(ids, { from, wamid: `wamid.${metaId()}`, text: 'start' }),
    )
    await waitFor(
      () => owner.client.get(`/contacts/${contact.id}`).then((r) => r.body.data.marketingConsent),
      (s) => s === 'GRANTED',
    )
    const after = (await owner.client.get(`/contacts/${contact.id}/consents`)).body.data
    expect(after.map((c: { status: string }) => c.status)).toEqual([
      'GRANTED',
      'REVOKED',
      'GRANTED',
    ])
  })

  it('eligibility summary mirrors MessageEligibilityService (read-only, C1)', async () => {
    const { owner, ids } = await connected('ct-elig')
    const created = await owner.client.post('/contacts', { phone: `+${customer()}`, name: 'Elig' })
    expect(created.status, created.text).toBe(201)
    const id = created.body.data.id
    const read = async () => (await owner.client.get(`/contacts/${id}/eligibility`)).body.data
    // No conversation yet: no window, no marketing consent; utility allowed (C3 interim rule).
    expect(await read()).toMatchObject({
      serviceWindowExpiresAt: null,
      freeform: { allowed: false, code: 'CONVERSATION_WINDOW_CLOSED' },
      marketingTemplate: { allowed: false, code: 'CONSENT_REQUIRED', optedOut: false },
      utilityTemplate: { allowed: true, code: null },
    })
    // The customer writes: free-form opens. Marketing granted: marketing opens.
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(ids, {
        from: created.body.data.phoneE164.slice(1),
        wamid: `wamid.${metaId()}`,
        text: 'Hello',
      }),
    )
    await waitFor(read, (e) => e.freeform.allowed === true)
    const granted = await owner.client.post(`/contacts/${id}/consents`, {
      purpose: 'MARKETING',
      status: 'GRANTED',
      note: 'Asked at the counter',
    })
    expect(granted.status, granted.text).toBe(200)
    expect((await read()).marketingTemplate).toMatchObject({ allowed: true })
    // Opting out of utility blocks utility templates, flagged as an opt-out.
    const revoked = await owner.client.post(`/contacts/${id}/consents`, {
      purpose: 'UTILITY',
      status: 'REVOKED',
      note: 'Asked us to stop order updates',
    })
    expect(revoked.status, revoked.text).toBe(200)
    expect((await read()).utilityTemplate).toMatchObject({ allowed: false, optedOut: true })
    // Another workspace can't read it.
    const other = await createOwner(api, 'ct-elig-other')
    expect((await other.client.get(`/contacts/${id}/eligibility`)).status).toBe(404)
  })

  it('MessagingService rejects a marketing send without consent; Meta 131050 revokes it', async () => {
    const { owner, ids } = await connected('ct-mkt')
    const messaging = api.get(MessagingService)
    const to = `+${customer()}`
    const created = await owner.client.post('/contacts', { phone: to, name: 'Marketing target' })
    expect(created.status, created.text).toBe(201)
    // One approved template per category, created in WhatsApp Manager and imported by a sync.
    await control('templates', {
      wabaId: ids.wabaId,
      add: [
        {
          name: 'spring_sale',
          language: 'en',
          category: 'MARKETING',
          status: 'APPROVED',
          components: [
            { type: 'BODY', text: 'Our spring sale is on: 20% off everything this week.' },
          ],
        },
        {
          name: 'order_update',
          language: 'en',
          category: 'UTILITY',
          status: 'APPROVED',
          components: [{ type: 'BODY', text: 'Your order has shipped and arrives soon.' }],
        },
      ],
    })
    expect((await owner.client.post('/templates/sync', {})).status).toBe(200)
    // The template's category decides the purpose (docs/TEMPLATE_ENGINE.md → Rendering and sending).
    const send = (key: string, purpose: 'MARKETING' | 'UTILITY') =>
      messaging.send({
        tenantId: owner.tenantId,
        target: { phoneE164: to },
        content: {
          type: 'TEMPLATE',
          name: purpose === 'MARKETING' ? 'spring_sale' : 'order_update',
          language: 'en',
        },
        source: 'API',
        idempotencyKey: key,
      })
    await expect(send(`mkt-${metaId()}`, 'MARKETING')).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    })

    const contact = created.body.data
    await owner.client.post(`/contacts/${contact.id}/consents`, {
      purpose: 'MARKETING',
      status: 'GRANTED',
      note: 'Opted in on the website form',
    })
    // Meta says the user stopped marketing messages (131050): the send fails and consent is revoked.
    await control('fail', {
      pathContains: `${ids.phoneNumberId}/messages`,
      method: 'POST',
      status: 400,
      code: 131050,
      times: 1,
    })
    const message = await send(`mkt-${metaId()}`, 'MARKETING')
    expect(message.status).toBe('CREATED')
    await waitFor(
      () => owner.client.get(`/contacts/${contact.id}`).then((r) => r.body.data.marketingConsent),
      (s) => s === 'REVOKED',
    )
    const history = (await owner.client.get(`/contacts/${contact.id}/consents`)).body.data
    expect(history[0]).toMatchObject({
      source: 'META_OPT_OUT',
      evidence: { messageId: message.id, errorCode: 'META_USER_OPTED_OUT' },
    })
    // TEMPORARY rule (TEMP_UTILITY_BLOCK_ON_REVOKED, decision C3): utility is blocked only when revoked.
    await expect(send(`utl-${metaId()}`, 'UTILITY')).resolves.toMatchObject({ status: 'CREATED' })
    await owner.client.post(`/contacts/${contact.id}/consents`, {
      purpose: 'UTILITY',
      status: 'REVOKED',
      note: 'Asked not to receive updates',
    })
    await expect(send(`utl-${metaId()}`, 'UTILITY')).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    })
  })
})

describe('filters and segments', () => {
  type Seeded = {
    id: string
    name: string | null
    email: string | null
    tags: string[]
    marketing: 'GRANTED' | 'REVOKED' | 'NONE'
    score: number | null
    plan: string | null
  }

  /** Reference semantics of the DSL, independent of the SQL compiler. */
  function matches(c: Seeded, f: ContactFilter): boolean {
    const results = f.rules.map((r) => ('rules' in r ? matches(c, r) : rule(c, r)))
    if (!results.length) return true
    return f.op === 'AND' ? results.every(Boolean) : results.some(Boolean)
  }
  function rule(c: Seeded, r: FilterRule): boolean {
    const v = r.value as never
    const lc = (s: string | null) => (s ?? '').toLowerCase()
    switch (r.field) {
      case 'name':
      case 'email': {
        const x = c[r.field]
        if (r.operator === 'EXISTS') return x !== null
        if (r.operator === 'NOT_EXISTS') return x === null
        if (r.operator === 'EQUALS') return x !== null && lc(x) === lc(v)
        if (r.operator === 'CONTAINS') return x !== null && lc(x).includes(lc(v))
        if (r.operator === 'NOT_CONTAINS') return x === null || !lc(x).includes(lc(v))
        return x !== null && lc(x).startsWith(lc(v))
      }
      case 'tags': {
        const ids = v as string[]
        if (r.operator === 'HAS_ANY') return ids.some((t) => c.tags.includes(t))
        if (r.operator === 'HAS_ALL') return ids.every((t) => c.tags.includes(t))
        return !ids.some((t) => c.tags.includes(t))
      }
      case 'consent.marketing':
        return c.marketing === v
      case 'property.score': {
        const x = c.score
        if (r.operator === 'EXISTS') return x !== null
        if (r.operator === 'NOT_EXISTS') return x === null
        if (r.operator === 'NOT_EQUALS') return x === null || x !== v
        if (x === null) return false
        if (r.operator === 'GT') return x > v
        if (r.operator === 'LT') return x < v
        const [a, b] = v as [number, number]
        return x >= a && x <= b
      }
      default: {
        const x = c.plan
        if (r.operator === 'IN') return x !== null && (v as string[]).includes(x)
        return x === null || !(v as string[]).includes(x)
      }
    }
  }

  it('count, search and segment count agree with the reference semantics for generated filters', async () => {
    const owner = await createOwner(api, 'ct-dsl')
    const tagIds: string[] = []
    for (const name of ['gold', 'silver', 'bronze'])
      tagIds.push((await owner.client.post('/tags', { name })).body.data.id)
    await owner.client.post('/contact-properties', { key: 'score', label: 'Score', type: 'NUMBER' })
    await owner.client.post('/contact-properties', {
      key: 'plan',
      label: 'Plan',
      type: 'SELECT',
      options: ['free', 'pro', 'team'],
    })
    const names = ['Asha Rao', 'Ravi Kumar', 'Meena', 'ravi', null, 'Priya S']
    const seeded: Seeded[] = []
    const rnd = fc.sample(
      fc.record({
        name: fc.constantFrom(...names),
        email: fc.option(fc.constantFrom('a@x.io', 'ravi@shop.in', 'meena@corp.com'), {
          nil: null,
        }),
        tags: fc.subarray(tagIds),
        marketing: fc.constantFrom('GRANTED' as const, 'REVOKED' as const, 'NONE' as const),
        score: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
        plan: fc.option(fc.constantFrom('free', 'pro', 'team'), { nil: null }),
      }),
      { numRuns: 60, seed: 42 },
    )
    for (const [i, s] of rnd.entries()) {
      const res = await owner.client.post('/contacts', {
        phone: `98${String(20_000_000 + i).slice(-8)}`,
        name: s.name,
        email: s.email,
        tagIds: s.tags,
        properties: { score: s.score, plan: s.plan },
        consents:
          s.marketing === 'NONE'
            ? []
            : [{ purpose: 'MARKETING', status: 'GRANTED', source: 'MANUAL' }],
      })
      expect(res.status, res.text).toBe(201)
      if (s.marketing === 'REVOKED')
        await owner.client.post(`/contacts/${res.body.data.id}/consents`, {
          purpose: 'MARKETING',
          status: 'REVOKED',
          note: 'Seeded revocation',
        })
      seeded.push({ id: res.body.data.id, ...s })
    }

    const text = fc.constantFrom('ravi', 'a', 'Meena', 'x.io', 'zzz')
    const ruleArb: fc.Arbitrary<FilterRule> = fc.oneof(
      fc.record({
        field: fc.constant('name'),
        operator: fc.constantFrom('EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'STARTS_WITH'),
        value: text,
      }),
      fc.record({
        field: fc.constantFrom('name', 'email'),
        operator: fc.constantFrom('EXISTS', 'NOT_EXISTS'),
      }),
      fc.record({ field: fc.constant('email'), operator: fc.constant('CONTAINS'), value: text }),
      fc.record({
        field: fc.constant('tags'),
        operator: fc.constantFrom('HAS_ANY', 'HAS_ALL', 'HAS_NONE'),
        value: fc.subarray(tagIds, { minLength: 1 }),
      }),
      fc.record({
        field: fc.constant('consent.marketing'),
        operator: fc.constant('IS'),
        value: fc.constantFrom('GRANTED', 'REVOKED', 'NONE'),
      }),
      fc.record({
        field: fc.constant('property.score'),
        operator: fc.constantFrom('GT', 'LT', 'NOT_EQUALS'),
        value: fc.integer({ min: 0, max: 100 }),
      }),
      fc.record({
        field: fc.constant('property.score'),
        operator: fc.constantFrom('EXISTS', 'NOT_EXISTS'),
      }),
      fc.record({
        field: fc.constant('property.score'),
        operator: fc.constant('BETWEEN'),
        value: fc.tuple(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 50, max: 100 })),
      }),
      fc.record({
        field: fc.constant('property.plan'),
        operator: fc.constantFrom('IN', 'NOT_IN'),
        value: fc.subarray(['free', 'pro', 'team'], { minLength: 1 }),
      }),
    ) as fc.Arbitrary<FilterRule>
    const group = (depth: number): fc.Arbitrary<ContactFilter> =>
      fc.record({
        op: fc.constantFrom('AND' as const, 'OR' as const),
        rules: fc.array(depth > 1 ? fc.oneof(ruleArb, group(depth - 1)) : ruleArb, {
          maxLength: 4,
        }),
      })

    await fc.assert(
      fc.asyncProperty(group(3), async (filter) => {
        const expected = seeded
          .filter((c) => matches(c, filter))
          .map((c) => c.id)
          .sort()
        const search = await owner.client.post('/contacts/search', { filter, limit: 200 })
        expect(search.status, search.text).toBe(200)
        const ids = search.body.data.map((c: { id: string }) => c.id).sort()
        const count = (await owner.client.post('/contacts/count', { filter })).body.data.count
        const segment = await owner.client.post('/segments', { name: 'generated', filter })
        const segmentCount = (await owner.client.post(`/segments/${segment.body.data.id}/count`))
          .body.data.count
        await owner.client.delete(`/segments/${segment.body.data.id}`)
        expect(ids).toEqual(expected)
        expect(count).toBe(expected.length)
        expect(segmentCount).toBe(expected.length)
      }),
      { numRuns: 40, seed: 7 },
    )
  }, 180_000)

  it("rejects invalid filters and another workspace's segment", async () => {
    const a = await createOwner(api, 'ct-seg-a')
    const b = await createOwner(api, 'ct-seg-b')
    const foreign = await b.client.post('/segments', {
      name: 'B only',
      filter: { op: 'AND', rules: [] },
    })
    const bad = [
      { op: 'AND', rules: [{ field: 'segment', operator: 'IN', value: foreign.body.data.id }] },
      { op: 'AND', rules: [{ field: 'property.nope', operator: 'EXISTS' }] },
      { op: 'AND', rules: [{ field: 'name', operator: 'GT', value: 3 }] },
      {
        op: 'AND',
        rules: [{ op: 'OR', rules: [{ op: 'AND', rules: [{ op: 'OR', rules: [] }] }] }],
      },
    ]
    for (const filter of bad) {
      const res = await a.client.post('/contacts/count', { filter })
      expect([res.status, res.body.error.code], JSON.stringify(filter)).toEqual([
        400,
        'VALIDATION_FAILED',
      ])
    }
  })
})
