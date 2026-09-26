import { WhatsAppSyncProcessor } from '@fenwira/api/modules/whatsapp-accounts'
import { Database } from '@fenwira/database'
import { type MetaMockState, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { type Server } from 'node:http'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker } from './support/harness'
import { addMember, createOwner, type Member, waitForTemplate } from './support/workspace'

/**
 * Phase 4 acceptance (docs/prompts/PHASE_04_META_ONBOARDING.md) against the in-process meta-mock.
 * Every Graph token the mock issues starts with "mock-token:" or "mock-dev:", so a leak anywhere
 * (responses, logs, audit entries) is a plain substring search.
 */
const TOKEN_MARKERS = /mock-token:|mock-dev:/

let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let apiNoDev: INestApplication
let worker: INestApplication
let db: Database
const logs: string[] = []
const responses: string[] = []

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const control = (action: string, body: unknown) =>
  fetch(`${mock.url}/__mock/${action}`, { method: 'POST', body: JSON.stringify(body) })

/** Seeds a WABA with one number in the mock; `status: 'PENDING'` means "needs registration". */
async function seedNumber(opts: { status?: string } = {}) {
  const wabaId = metaId()
  const phoneNumberId = metaId()
  await control('seed', {
    wabaId,
    name: `WABA ${wabaId}`,
    phones: [{ id: phoneNumberId, verifiedName: 'Acme Foods', status: opts.status }],
  })
  return { wabaId, phoneNumberId }
}

/** Records every response body for the token-leak assertion. */
function track<T extends { text?: string; body?: unknown }>(res: T): T {
  responses.push(res.text ?? JSON.stringify(res.body))
  return res
}

async function connect(owner: Member, ids: { wabaId: string; phoneNumberId: string }) {
  return track(
    await owner.client.post('/whatsapp/connections', { code: `code-for:${ids.wabaId}`, ...ids }),
  )
}

const credentialsOf = (tenantId: string, phoneId: string) =>
  db.withTenant(tenantId, async (tx) => {
    const phone = await tx.whatsAppPhoneNumber.findUniqueOrThrow({ where: { id: phoneId } })
    return tx.metaCredential.findMany({ where: { wabaId: phone.wabaId } })
  })

beforeAll(async () => {
  mock = await startMetaMock(0)
  const meta = {
    META_GRAPH_BASE_URL: mock.url,
    META_APP_ID: 'mock-app',
    META_APP_SECRET: 'mock-app-secret',
    META_ES_CONFIG_ID: 'mock-config',
  }
  const capture = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(chunk.toString('utf8'))
      done()
    },
  })
  api = await bootApi(
    { ...meta, WHATSAPP_DEV_CONNECT: 'true', LOG_LEVEL: 'debug' },
    { logDestination: capture },
  )
  apiNoDev = await bootApi({ WHATSAPP_DEV_CONNECT: 'false', META_GRAPH_BASE_URL: mock.url })
  // The worker sends the verification emails and runs the whatsapp.sync processor.
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 2 })
})

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await apiNoDev?.close()
  await db?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('Embedded Signup connect', () => {
  it('runs all steps and shows Connected, with the token only ever masked', async () => {
    const owner = await createOwner(api, 'wa-connect')
    const config = track(await owner.client.get('/config/whatsapp-signup'))
    expect(config.body.data).toEqual({
      embeddedSignup: true,
      appId: 'mock-app',
      configId: 'mock-config',
      graphVersion: 'v23.0',
      devConnect: true,
    })
    expect(config.text).not.toContain('mock-app-secret')

    const ids = await seedNumber({ status: 'PENDING' })
    const res = await connect(owner, ids)
    expect(res.status, res.text).toBe(201)
    const c = res.body.data
    expect(c).toMatchObject({
      phoneNumberId: ids.phoneNumberId,
      verifiedName: 'Acme Foods',
      status: 'CONNECTED',
      qualityRating: 'GREEN',
      isDefault: true,
      webhookStatus: 'ACTIVE',
      waba: { id: ids.wabaId },
      credential: { status: 'VALID', tokenType: 'BUSINESS_INTEGRATION' },
    })
    expect(c.credential.maskedToken).toMatch(/^mock….{4}$/)
    expect(c.steps.map((s: { status: string }) => s.status)).toEqual([
      'DONE',
      'DONE',
      'DONE',
      'DONE',
      'DONE',
      'DONE',
      'DONE',
      'DONE',
    ])
    // Meta saw subscribe + register (with a 6-digit PIN) for this WABA/number.
    const calls = mock.state.calls.filter(
      (call) => call.path.includes(ids.wabaId) || call.path.includes(ids.phoneNumberId),
    )
    expect(
      calls.some((call) => call.path === `${ids.wabaId}/subscribed_apps` && call.method === 'POST'),
    ).toBe(true)
    const register = calls.find((call) => call.path === `${ids.phoneNumberId}/register`)
    expect((register?.body as { pin?: string }).pin).toMatch(/^\d{6}$/)

    // Stored encrypted: the ciphertext is not the token.
    const [cred] = await credentialsOf(owner.tenantId, c.id)
    expect(Buffer.from(cred!.tokenCiphertext!).toString('utf8')).toMatch(/^v1\.k1\./)

    const listed = track(await owner.client.get('/whatsapp/connections'))
    expect(listed.body.data).toHaveLength(1)

    const audit = track(await owner.client.get('/audit-logs?action=whatsapp.'))
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['whatsapp.connection_started', 'whatsapp.connected']),
    )
  })

  it('reports the failing pre-store step and stores nothing', async () => {
    const owner = await createOwner(api, 'wa-prestore')
    const ids = await seedNumber()
    const bad = track(
      await owner.client.post('/whatsapp/connections', { code: 'not-a-code', ...ids }),
    )
    expect(bad.status).toBe(422)
    expect(bad.body.error.code).toBe('WHATSAPP_CONNECT_FAILED')
    expect(bad.body.error.details.step).toBe('EXCHANGE')

    const wrongNumber = await connect(owner, { wabaId: ids.wabaId, phoneNumberId: metaId() })
    expect(wrongNumber.status).toBe(422)
    expect(wrongNumber.body.error.details.step).toBe('FETCH')

    const list = await owner.client.get('/whatsapp/connections')
    expect(list.body.data).toEqual([])
  })

  it('persists a post-store failure and resumes from it on retry', async () => {
    const owner = await createOwner(api, 'wa-retry')
    const ids = await seedNumber()
    await control('fail', {
      pathContains: `${ids.wabaId}/subscribed_apps`,
      status: 500,
      code: 1,
      times: 1,
    })
    const first = await connect(owner, ids)
    expect(first.status).toBe(201)
    expect(first.body.data.status).toBe('ERROR')
    expect(first.body.data.webhookStatus).toBe('FAILED')
    const subscribe = first.body.data.steps.find((s: { key: string }) => s.key === 'SUBSCRIBE')
    expect(subscribe).toMatchObject({ status: 'FAILED', error: { code: 'META_TRANSIENT' } })

    const retried = track(
      await owner.client.post(`/whatsapp/connections/${first.body.data.id}/retry`),
    )
    expect(retried.status).toBe(200)
    expect(retried.body.data).toMatchObject({ status: 'CONNECTED', webhookStatus: 'ACTIVE' })
  })
})

describe('one tenant per number', () => {
  it('rejects a number live in another workspace without revealing it; allows it after disconnect', async () => {
    const a = await createOwner(api, 'wa-owner-a', 'Secret Tenant A')
    const b = await createOwner(api, 'wa-owner-b')
    const ids = await seedNumber()
    const first = await connect(a, ids)
    expect(first.status).toBe(201)

    const taken = await connect(b, ids)
    expect(taken.status).toBe(409)
    expect(taken.body.error.code).toBe('PHONE_NUMBER_ALREADY_CONNECTED')
    expect(taken.text).not.toContain('Secret Tenant A')
    expect(taken.text).not.toContain(a.tenantId)
    expect(taken.text).not.toContain(first.body.data.id)

    expect((await a.client.delete(`/whatsapp/connections/${first.body.data.id}`)).status).toBe(204)
    const now = await connect(b, ids)
    expect(now.status).toBe(201)
    expect(now.body.data.status).toBe('CONNECTED')
  })
})

describe('managing a connection', () => {
  it('disconnect unsubscribes webhooks and wipes the credential', async () => {
    const owner = await createOwner(api, 'wa-disconnect')
    const ids = await seedNumber()
    const { id } = (await connect(owner, ids)).body.data
    expect((await owner.client.delete(`/whatsapp/connections/${id}`)).status).toBe(204)
    expect(
      mock.state.calls.some(
        (c) => c.method === 'DELETE' && c.path === `${ids.wabaId}/subscribed_apps`,
      ),
    ).toBe(true)
    const creds = await credentialsOf(owner.tenantId, id)
    expect(creds.every((c) => c.status === 'REVOKED' && c.tokenCiphertext === null)).toBe(true)
    const subs = await db.withTenant(owner.tenantId, (tx) => tx.webhookSubscription.findMany())
    expect(subs.map((s) => s.status)).toEqual(['REMOVED'])
    expect((await owner.client.get('/whatsapp/connections')).body.data).toEqual([])
    expect((await owner.client.post(`/whatsapp/connections/${id}/sync`)).status).toBe(404)
  })

  it('tests the connection, optionally sending hello_world; a revoked token is reported', async () => {
    const owner = await createOwner(api, 'wa-test')
    const ids = await seedNumber()
    const { id } = (await connect(owner, ids)).body.data
    const live = track(await owner.client.post(`/whatsapp/connections/${id}/test`, {}))
    expect(live.body.data).toMatchObject({ ok: true, status: 'CONNECTED' })
    // Connecting imported the WABA's templates; Meta's hello_world is approved everywhere.
    await waitForTemplate(owner, 'hello_world')
    // Test messages go through MessagingService (a hello_world template via POST /conversations).
    const sent = track(
      await owner.client.post(
        '/conversations',
        {
          to: '+91 98765 43210',
          phoneNumberId: id,
          content: { type: 'TEMPLATE', name: 'hello_world', language: 'en_US' },
        },
        { 'Idempotency-Key': `test-send-${id}` },
      ),
    )
    expect(sent.status, sent.text).toBe(201)
    const deadline = Date.now() + 10_000
    while (
      !mock.state.sent.some((m) => m.phoneNumberId === ids.phoneNumberId) &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 100))
    const msg = mock.state.sent.filter((m) => m.phoneNumberId === ids.phoneNumberId).at(-1)
    expect(msg?.payload).toMatchObject({ to: '919876543210', template: { name: 'hello_world' } })

    const token = mock.state.calls
      .filter((c) => c.path.startsWith(ids.phoneNumberId))
      .at(-1)!
      .authorization!.replace('Bearer ', '')
    await control('revoke', { token })
    const revoked = track(await owner.client.post(`/whatsapp/connections/${id}/test`, {}))
    expect(revoked.body.data).toMatchObject({ ok: false, error: { code: 'META_TOKEN_INVALID' } })
    const list = await owner.client.get('/whatsapp/connections')
    expect(list.body.data[0].credential.status).toBe('INVALID')

    // Rotating re-runs the exchange and restores a valid credential.
    const rotated = track(
      await owner.client.post(`/whatsapp/connections/${id}/rotate-token`, {
        code: `code-for:${ids.wabaId}`,
      }),
    )
    expect(rotated.status, rotated.text).toBe(200)
    expect(rotated.body.data.credential.status).toBe('VALID')
    expect(rotated.body.data.credential.maskedToken).not.toBe(
      list.body.data[0].credential.maskedToken,
    )
  })

  it('renames and moves the default between numbers', async () => {
    const owner = await createOwner(api, 'wa-default')
    const first = (await connect(owner, await seedNumber())).body.data
    const second = (await connect(owner, await seedNumber())).body.data
    expect([first.isDefault, second.isDefault]).toEqual([true, false])
    const updated = track(
      await owner.client.patch(`/whatsapp/connections/${second.id}`, {
        isDefault: true,
        label: 'Support line',
      }),
    )
    expect(updated.body.data).toMatchObject({ isDefault: true, label: 'Support line' })
    const list = (await owner.client.get('/whatsapp/connections')).body.data
    expect(list.map((c: { id: string; isDefault: boolean }) => [c.id, c.isDefault])).toEqual([
      [second.id, true],
      [first.id, false],
    ])
    // Disconnecting the default promotes the remaining number.
    await owner.client.delete(`/whatsapp/connections/${second.id}`)
    const after = (await owner.client.get('/whatsapp/connections')).body.data
    expect(after).toMatchObject([{ id: first.id, isDefault: true }])
  })

  it('lets only whatsapp.manage roles change connections', async () => {
    const owner = await createOwner(api, 'wa-rbac')
    const { id } = (await connect(owner, await seedNumber())).body.data
    const manager = await addMember(api, owner, 'MANAGER')
    expect((await manager.client.get('/whatsapp/connections')).status).toBe(200)
    expect((await manager.client.delete(`/whatsapp/connections/${id}`)).status).toBe(403)
    const agent = await addMember(api, owner, 'AGENT')
    expect((await agent.client.post(`/whatsapp/connections/${id}/test`, {})).status).toBe(403)
    expect((await agent.client.get('/config/whatsapp-signup')).status).toBe(403)
  })
})

describe('dev connect', () => {
  it('connects the Meta test number with a pasted token when the flag is on', async () => {
    const owner = await createOwner(api, 'wa-dev')
    const ids = await seedNumber()
    const res = track(
      await owner.client.post('/whatsapp/connections/dev', {
        ...ids,
        accessToken: `mock-dev:${ids.wabaId}:expiring`,
      }),
    )
    expect(res.status, res.text).toBe(201)
    expect(res.body.data).toMatchObject({
      status: 'CONNECTED',
      credential: { tokenType: 'DEV', status: 'EXPIRING' },
    })
    const steps = Object.fromEntries(
      res.body.data.steps.map((s: { key: string; status: string }) => [s.key, s.status]),
    )
    expect(steps).toMatchObject({ EXCHANGE: 'SKIPPED', REGISTER: 'SKIPPED', VALIDATE: 'DONE' })
  })

  it('is absent when the flag is off', async () => {
    const owner = await createOwner(apiNoDev, 'wa-nodev')
    const ids = await seedNumber()
    const res = await owner.client.post('/whatsapp/connections/dev', {
      ...ids,
      accessToken: `mock-dev:${ids.wabaId}`,
    })
    expect(res.status).toBe(404)
    const config = await owner.client.get('/config/whatsapp-signup')
    expect(config.body.data).toMatchObject({ devConnect: false, embeddedSignup: false })
    const connect = await owner.client.post('/whatsapp/connections', {
      code: `code-for:${ids.wabaId}`,
      ...ids,
    })
    expect(connect.status).toBe(422)
  })
})

describe('background sync (whatsapp.sync)', () => {
  it('refreshes quality and tier from Meta on schedule', async () => {
    const owner = await createOwner(api, 'wa-sync')
    const ids = await seedNumber()
    const res = await owner.client.post('/whatsapp/connections/dev', {
      ...ids,
      accessToken: `mock-dev:${ids.wabaId}`,
    })
    const { id } = res.body.data
    await control('quality', { phoneId: ids.phoneNumberId, quality: 'RED', tier: 'TIER_10K' })

    {
      // Pretend 7 hours have passed so this number is due. Each run takes up to 500 due numbers,
      // oldest first; the long-lived test database holds many, so keep running it as the
      // scheduler would until this one is reached.
      const deadline = Date.now() + 90_000
      let conn: { qualityRating: string; messagingLimitTier: string } | undefined
      let lastFanOut = 0
      while (Date.now() < deadline) {
        if (Date.now() - lastFanOut > 3000) {
          const queued = await worker
            .get(WhatsAppSyncProcessor)
            .fanOut(Date.now() + 7 * 3600 * 1000)
          expect(queued).toBeGreaterThan(0)
          lastFanOut = Date.now()
        }
        conn = (await owner.client.get('/whatsapp/connections')).body.data[0]
        if (conn?.qualityRating === 'RED') break
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(conn).toMatchObject({ qualityRating: 'RED', messagingLimitTier: 'TIER_10K' })
    }
    const audit = await owner.client.get('/audit-logs?action=whatsapp.status_changed')
    expect(audit.body.data[0]).toMatchObject({
      actorType: 'SYSTEM',
      changes: { qualityRating: ['GREEN', 'RED'] },
    })
    expect((await owner.client.post(`/whatsapp/connections/${id}/sync`)).status).toBe(200)
  }, 120_000)
})

describe('token hygiene', () => {
  it('never exposes a raw token in responses, logs or audit entries', async () => {
    expect(responses.length).toBeGreaterThan(10)
    for (const body of responses) expect(body).not.toMatch(TOKEN_MARKERS)
    expect(logs.length).toBeGreaterThan(10)
    expect(logs.join('\n')).not.toMatch(TOKEN_MARKERS)
    // Audit entries are covered by the tracked /audit-logs responses above.
    expect(responses.some((r) => r.includes('whatsapp.connected'))).toBe(true)
  })
})
