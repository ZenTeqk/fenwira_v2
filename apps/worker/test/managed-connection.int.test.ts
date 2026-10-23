import { Database } from '@fenwira/database'
import { signWebhookBody } from '@fenwira/whatsapp'
import { inboundMessageWebhook, type MetaMockState, startMetaMock } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { type Server } from 'node:http'
import { Writable } from 'node:stream'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker, type Client } from './support/harness'
import { createOperator } from './support/platform'
import { createOwner, type Member } from './support/workspace'

/**
 * ADR-0027 Managed Launch Mode step 2: an operator connects a customer's WABA from the platform
 * console with a system-user token and that customer's own app secret (ML-D1); webhooks are
 * routed by WABA + phone number and verified with the matching secret. Every token the mock
 * issues starts with "mock-dev:", and every app secret here contains "appsecret", so a leak
 * anywhere (responses, logs, audit entries) is a plain substring search.
 */
const PLATFORM_SECRET = 'platformappsecret0000000000000001'
const LEAK = /mock-dev:|appsecret/

let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let migration: Database
let operator: Client
let operatorId: string
let ownerA: Member
let ownerB: Member
const logs: string[] = []
const responses: string[] = []

const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)
const seed = (wabaId: string, phoneNumberId: string, display: string) =>
  fetch(`${mock.url}/__mock/seed`, {
    method: 'POST',
    body: JSON.stringify({
      wabaId,
      name: `WABA ${wabaId}`,
      phones: [{ id: phoneNumberId, display, verifiedName: 'Acme Foods' }],
    }),
  })
function track<T extends { text?: string; body?: unknown }>(res: T): T {
  responses.push(res.text ?? JSON.stringify(res.body))
  return res
}
const ws = (tenantId: string) => `/platform/workspaces/${tenantId}/whatsapp`

/** POSTs a Meta webhook signed with `secret` (raw bytes, exactly as Meta does). */
async function deliver(payload: unknown, secret: string) {
  const raw = JSON.stringify(payload)
  return request(api.getHttpServer())
    .post('/api/v1/webhooks/whatsapp')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', signWebhookBody(secret, raw))
    .send(raw)
}

const webhookEventCount = (tenantId: string, wamid: string) =>
  db.withTenant(tenantId, (tx) =>
    tx.webhookEvent.count({ where: { dedupeKey: { contains: wamid } } }),
  )

beforeAll(async () => {
  mock = await startMetaMock(0)
  const capture = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(chunk.toString('utf8'))
      done()
    },
  })
  api = await bootApi(
    {
      META_GRAPH_BASE_URL: mock.url,
      META_APP_SECRET: PLATFORM_SECRET,
      MANAGED_LAUNCH_MODE: 'true',
      WHATSAPP_DEV_CONNECT: 'false',
      LOG_LEVEL: 'debug',
    },
    { logDestination: capture },
  )
  worker = await bootWorker({ META_GRAPH_BASE_URL: mock.url })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
  migration = Database.connect({ url: process.env.MIGRATION_DATABASE_URL! })
  ownerA = await createOwner(api, 'ml-conn-a')
  ownerB = await createOwner(api, 'ml-conn-b')
  // Last: operator writes need MFA within the previous five minutes.
  ;({ client: operator, operatorId } = await createOperator(api, db, migration, 'ml-operator'))
}, 90_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await migration?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('operator-managed connection (ADR-0027)', () => {
  const a = { wabaId: metaId(), phoneNumberId: metaId(), display: '+91 98765 43210' }
  const b = { wabaId: metaId(), phoneNumberId: metaId(), display: '+91 98765 00000' }
  const secretA = 'customeraappsecret000000000000aa'
  const tokenA = `mock-dev:${a.wabaId}:system-user-token-a`
  let phoneA: string
  let phoneB: string

  beforeAll(async () => {
    await seed(a.wabaId, a.phoneNumberId, a.display)
    await seed(b.wabaId, b.phoneNumberId, b.display)
  })

  it('connects a WABA with a system-user token and app secret, returning only masked values', async () => {
    const res = track(
      await operator.post(`${ws(ownerA.tenantId)}/connections`, {
        wabaId: a.wabaId,
        phoneNumberId: a.phoneNumberId,
        displayPhoneNumber: '+91 98765-43210',
        accessToken: tokenA,
        appSecret: secretA,
        appId: '111222333',
        businessId: '999888777',
      }),
    )
    expect(res.status, res.text).toBe(201)
    expect(res.body.data).toMatchObject({
      connectionMode: 'MANAGED',
      status: 'CONNECTED',
      webhookStatus: 'ACTIVE',
      metaAppId: '111222333',
      businessId: '999888777',
      appSecret: { maskedSecret: '••••00aa' },
      credential: { status: 'VALID', tokenType: 'SYSTEM_USER' },
    })
    expect(res.body.data.credential.maskedToken).toMatch(/^mock….{4}$/)
    phoneA = res.body.data.id

    // debug_token was asked with the customer's own app token (ML-D1), not the platform app.
    const debug = mock.state.calls.filter((c) => c.path === 'debug_token').at(-1)
    expect(debug?.authorization).toContain(`111222333|${secretA}`)

    // Stored encrypted.
    const waba = await db.withTenant(ownerA.tenantId, (tx) =>
      tx.whatsAppBusinessAccount.findFirstOrThrow({ where: { wabaId: a.wabaId } }),
    )
    expect(Buffer.from(waba.appSecretCiphertext!).toString('utf8')).not.toContain(secretA)

    // Workspace B: managed too, but on the platform app (no own secret).
    const resB = track(
      await operator.post(`${ws(ownerB.tenantId)}/connections`, {
        wabaId: b.wabaId,
        phoneNumberId: b.phoneNumberId,
        displayPhoneNumber: b.display,
        accessToken: `mock-dev:${b.wabaId}:system-user-token-b`,
      }),
    )
    expect(resB.status, resB.text).toBe(201)
    expect(resB.body.data.appSecret).toBeNull()
    phoneB = resB.body.data.id
  })

  it('refuses a display number that does not match Meta, before storing anything', async () => {
    const other = { wabaId: metaId(), phoneNumberId: metaId() }
    await seed(other.wabaId, other.phoneNumberId, '+1 555-010-7777')
    const res = track(
      await operator.post(`${ws(ownerA.tenantId)}/connections`, {
        ...other,
        displayPhoneNumber: '+1 555-010-0000',
        accessToken: `mock-dev:${other.wabaId}:token-mismatch-0001`,
      }),
    )
    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('WHATSAPP_CONNECT_FAILED')
    expect(res.body.error.details.step).toBe('FETCH')
    const stored = await db.withTenant(ownerA.tenantId, (tx) =>
      tx.whatsAppPhoneNumber.count({ where: { phoneNumberId: other.phoneNumberId } }),
    )
    expect(stored).toBe(0)
  })

  it('shows the owner a read-only status with no secrets', async () => {
    const res = track(await ownerA.client.get('/whatsapp/connections'))
    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([
      expect.objectContaining({
        id: phoneA,
        connectionMode: 'MANAGED',
        qualityRating: 'GREEN',
        status: 'CONNECTED',
      }),
    ])
    expect(res.body.data[0]).not.toHaveProperty('appSecret')
    // Tenants can't reach the operator console, even for their own workspace.
    const denied = await ownerA.client.get(`${ws(ownerA.tenantId)}/connections`)
    expect(denied.status).toBe(401)
  })

  it('verifies the connection live and stores the outcome', async () => {
    const ok = track(await operator.post(`${ws(ownerA.tenantId)}/connections/${phoneA}/verify`))
    expect(ok.status, ok.text).toBe(200)
    expect(ok.body.data).toMatchObject({
      ok: true,
      checks: { token: { ok: true }, phoneNumber: { ok: true }, waba: { ok: true } },
    })
    const listed = track(await operator.get(`${ws(ownerA.tenantId)}/connections/${phoneA}`))
    expect(listed.body.data.credential).toMatchObject({ verifyOk: true, verifyErrorCode: null })
    expect(listed.body.data.credential.verifiedAt).toBe(ok.body.data.verifiedAt)
  })

  it('routes webhooks by WABA + number and verifies them with the matching app secret', async () => {
    const msg = (ids: { wabaId: string; phoneNumberId: string }) => {
      const wamid = `wamid.${randomUUID()}`
      return { wamid, payload: inboundMessageWebhook(ids, { from: '919000000001', wamid }) }
    }

    const good = msg(a)
    const accepted = await deliver(good.payload, secretA)
    expect(accepted.status, accepted.text).toBe(200)
    expect(accepted.body).toMatchObject({ accepted: 1, ignored: 0 })
    expect(await webhookEventCount(ownerA.tenantId, good.wamid)).toBe(1)

    // A's WABA signed with the platform secret: the signature is valid, but not A's app → dropped.
    const platformSigned = msg(a)
    const wrongApp = await deliver(platformSigned.payload, PLATFORM_SECRET)
    expect(wrongApp.body).toMatchObject({ accepted: 0, ignored: 1 })
    expect(await webhookEventCount(ownerA.tenantId, platformSigned.wamid)).toBe(0)

    // A forged signature is refused outright.
    expect((await deliver(msg(a).payload, 'not-the-secret-at-all-000000000')).status).toBe(401)

    // Unknown number under A's WABA: rejected, nothing stored.
    const unknown = msg({ wabaId: a.wabaId, phoneNumberId: metaId() })
    expect((await deliver(unknown.payload, secretA)).body).toMatchObject({
      accepted: 0,
      ignored: 1,
    })

    // Customer A's secret can't reach workspace B: B's number under A's WABA id doesn't resolve,
    // and B's own WABA (platform app) refuses a payload signed with A's secret.
    const smuggled = msg({ wabaId: a.wabaId, phoneNumberId: b.phoneNumberId })
    expect((await deliver(smuggled.payload, secretA)).body).toMatchObject({ accepted: 0 })
    const crossApp = msg(b)
    const crossRes = await deliver(crossApp.payload, secretA)
    expect(crossRes.status).toBe(401)
    expect(await webhookEventCount(ownerB.tenantId, smuggled.wamid)).toBe(0)
    expect(await webhookEventCount(ownerB.tenantId, crossApp.wamid)).toBe(0)

    // B (no own secret) is verified with the platform secret.
    const forB = msg(b)
    expect((await deliver(forB.payload, PLATFORM_SECRET)).body).toMatchObject({ accepted: 1 })
    expect(await webhookEventCount(ownerB.tenantId, forB.wamid)).toBe(1)
  })

  it('syncs phone status and templates on demand', async () => {
    const synced = track(await operator.post(`${ws(ownerA.tenantId)}/connections/${phoneA}/sync`))
    expect(synced.status, synced.text).toBe(200)
    expect(synced.body.data.lastSyncedAt).not.toBeNull()
    const templates = track(
      await operator.post(`${ws(ownerA.tenantId)}/connections/${phoneA}/sync-templates`),
    )
    expect(templates.status, templates.text).toBe(200)
    expect(templates.body.data).toMatchObject({ imported: expect.any(Number), missing: 0 })
    const resub = track(
      await operator.post(`${ws(ownerA.tenantId)}/connections/${phoneA}/subscribe`),
    )
    expect(resub.status, resub.text).toBe(200)
    expect(resub.body.data.webhookStatus).toBe('ACTIVE')
  })

  it('rotates the app secret and token; the old secret stops verifying', async () => {
    const newSecret = 'customeraappsecret000000000000a2'
    const newToken = `mock-dev:${a.wabaId}:system-user-token-a2`
    const res = track(
      await operator.post(`${ws(ownerA.tenantId)}/connections/${phoneA}/rotate`, {
        appSecret: newSecret,
        accessToken: newToken,
      }),
    )
    expect(res.status, res.text).toBe(200)
    expect(res.body.data.appSecret.maskedSecret).toBe('••••00a2')
    expect(res.body.data.appSecret.rotatedAt).not.toBeNull()
    expect(res.body.data.credential.maskedToken).toMatch(/…n-a2$/)

    const wamid = `wamid.${randomUUID()}`
    const payload = inboundMessageWebhook(a, { from: '919000000002', wamid })
    expect((await deliver(payload, secretA)).status).toBe(401)
    expect((await deliver(payload, newSecret)).body).toMatchObject({ accepted: 1 })

    // A token Meta has revoked fails verification and is marked INVALID.
    mock.state.revoked.add(newToken)
    const failed = track(await operator.post(`${ws(ownerA.tenantId)}/connections/${phoneA}/verify`))
    expect(failed.body.data.ok).toBe(false)
    const after = await operator.get(`${ws(ownerA.tenantId)}/connections/${phoneA}`)
    expect(after.body.data.credential).toMatchObject({ status: 'INVALID', verifyOk: false })
    expect(after.body.data.credential.verifyErrorCode).toEqual(expect.any(String))
    mock.state.revoked.delete(newToken)
  })

  it('never lets one workspace id reach another workspace’s connection', async () => {
    for (const call of [
      () => operator.get(`${ws(ownerB.tenantId)}/connections/${phoneA}`),
      () => operator.post(`${ws(ownerB.tenantId)}/connections/${phoneA}/verify`),
      () =>
        operator.post(`${ws(ownerB.tenantId)}/connections/${phoneA}/rotate`, { appId: '12345' }),
      () => operator.delete(`${ws(ownerB.tenantId)}/connections/${phoneA}`),
    ]) {
      const res = await call()
      expect(res.status, res.text).toBe(404)
    }
    const unknownWorkspace = await operator.get(`${ws(randomUUID())}/connections`)
    expect(unknownWorkspace.status).toBe(404)
    const listB = await operator.get(`${ws(ownerB.tenantId)}/connections`)
    expect(listB.body.data.map((c: { id: string }) => c.id)).toEqual([phoneB])
    const ownerBView = await ownerB.client.get('/whatsapp/connections')
    expect(ownerBView.body.data.map((c: { id: string }) => c.id)).toEqual([phoneB])
  })

  it('audits every operator action on the workspace, with the operator as actor and no secret', async () => {
    const entries = await db.withTenant(ownerA.tenantId, (tx) =>
      tx.auditLog.findMany({ where: { actorId: operatorId }, orderBy: { createdAt: 'asc' } }),
    )
    expect(new Set(entries.map((e) => e.actorType))).toEqual(new Set(['PLATFORM_OPERATOR']))
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'whatsapp.connection_started',
        'whatsapp.connected',
        'whatsapp.connection_verified',
        'whatsapp.synced',
        'templates.synced',
        'whatsapp.webhooks_subscribed',
        'whatsapp.credentials_rotated',
      ]),
    )
    expect(JSON.stringify(entries)).not.toMatch(LEAK)

    const platformAudit = await operator.get('/platform/audit')
    expect(platformAudit.status).toBe(200)
    const mine = (platformAudit.body.data as Array<{ workspaceId: string; action: string }>).filter(
      (e) => e.workspaceId === ownerA.tenantId,
    )
    expect(mine.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'platform.whatsapp.managed_connect',
        'platform.whatsapp.verify',
        'platform.whatsapp.rotate',
        'platform.whatsapp.sync_templates',
      ]),
    )
    expect(JSON.stringify(platformAudit.body)).not.toMatch(LEAK)
  })

  it('disconnects; later webhooks for that number are rejected', async () => {
    const res = await operator.delete(`${ws(ownerA.tenantId)}/connections/${phoneA}`)
    expect(res.status, res.text).toBe(204)
    const wamid = `wamid.${randomUUID()}`
    const late = await deliver(
      inboundMessageWebhook(a, { from: '919000000003', wamid }),
      'customeraappsecret000000000000a2',
    )
    expect(late.status).toBe(401)
    expect(await webhookEventCount(ownerA.tenantId, wamid)).toBe(0)
  })

  it('never put a token or app secret in a response or a log line', () => {
    for (const body of responses) expect(body).not.toMatch(LEAK)
    expect(logs.join('\n')).not.toMatch(LEAK)
  })
})
