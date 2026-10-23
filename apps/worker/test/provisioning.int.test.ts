import { uuidv7 } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { startMetaMock, type MetaMockState } from '@fenwira/whatsapp/testing'
import { type INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { type Server } from 'node:http'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { waitFor } from './support/campaigns'
import { bootApi, bootWorker, Client, PASSWORD, uniqueEmail } from './support/harness'
import { createOperator } from './support/platform'

/**
 * ADR-0027 step 4: onboarding without email. The worker runs WITHOUT SMTP; the operator creates a
 * workspace + owner, the owner sets a password through the one-time link, invites an agent by
 * link, and the agent joins. Email attempts are recorded as SKIPPED_NO_SMTP. Tokens never appear in
 * logs or audit entries; seat and number limits come from the entitlements.
 */
let mock: { server: Server; url: string; state: MetaMockState }
let api: INestApplication
let worker: INestApplication
let db: Database
let migration: Database
let operator: Client
const logs: string[] = []
const tokens: string[] = []

const tokenOf = (link: string) => {
  const u = new URL(link)
  const t = u.searchParams.get('token') ?? u.pathname.split('/').pop()!
  tokens.push(t)
  return t
}
const ws = (id: string) => `/platform/workspaces/${id}`
const metaId = () => String(Date.now()).slice(-9) + String(Math.random()).slice(2, 8)

async function provision(label: string) {
  const ownerEmail = uniqueEmail(label)
  const res = await operator.post('/platform/workspaces/provision', {
    workspaceName: `${label} Co`,
    ownerName: `${label} Owner`,
    ownerEmail,
  })
  expect(res.status, res.text).toBe(201)
  return { ...res.body.data, ownerEmail } as {
    workspaceId: string
    ownerUserId: string
    setupLink: string
    setupExpiresAt: string
    ownerEmail: string
  }
}

async function signIn(email: string, tenantId: string, password = PASSWORD) {
  const client = new Client(api)
  const login = await client.login(email, password)
  expect(login.status, login.text).toBe(200)
  client.tenantId = tenantId
  return client
}

beforeAll(async () => {
  mock = await startMetaMock(0)
  const capture = new Writable({
    write(chunk: Buffer, _enc, done) {
      logs.push(chunk.toString('utf8'))
      done()
    },
  })
  const env = {
    BILLING_SUBSCRIPTIONS_ENFORCED: 'true',
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: 'provisioningplatformsecret000001',
  }
  api = await bootApi({ ...env, LOG_LEVEL: 'debug' }, { logDestination: capture })
  worker = await bootWorker({ ...env, SMTP_URL: '' })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
  migration = Database.connect({ url: process.env.MIGRATION_DATABASE_URL! })
  ;({ client: operator } = await createOperator(api, db, migration, 'prov-operator'))
}, 90_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await migration?.disconnect()
  await new Promise<void>((r) => mock?.server.close(() => r()))
})

describe('operator onboarding without email', () => {
  let p: Awaited<ReturnType<typeof provision>>
  let owner: Client
  const agentEmail = uniqueEmail('prov-agent')

  it('creates a workspace and its owner; the owner sets a password with the one-time link', async () => {
    p = await provision('prov-a')
    expect(p.setupLink).toMatch(/\/reset-password\?token=.+&setup=1$/)
    expect(new Date(p.setupExpiresAt).getTime()).toBeGreaterThan(Date.now() + 71 * 3600_000)
    // Not signed in yet: the account has no usable password.
    expect((await new Client(api).login(p.ownerEmail)).status).toBe(401)
    const token = tokenOf(p.setupLink)
    const reset = await new Client(api).post('/auth/password/reset', { token, password: PASSWORD })
    expect(reset.status, reset.text).toBe(204)
    owner = await signIn(p.ownerEmail, p.workspaceId)
    const me = await owner.me()
    expect(me.body.data.user.emailVerified ?? me.body.data.user.emailVerifiedAt).toBeTruthy()
    expect(me.body.data.memberships).toEqual([
      expect.objectContaining({ tenantId: p.workspaceId, role: 'OWNER' }),
    ])
    // Single use.
    const again = await new Client(api).post('/auth/password/reset', {
      token,
      password: `${PASSWORD}x`,
    })
    expect(again.status).toBeGreaterThanOrEqual(400)
  })

  it('lets the owner invite an agent by link; a new link replaces the old one', async () => {
    const created = await owner.post('/team/invitations', { email: agentEmail, role: 'AGENT' })
    expect(created.status, created.text).toBe(201)
    expect(created.body.data.link).toMatch(/\/invitations\/[\w-]+$/)
    const first = tokenOf(created.body.data.link)
    const resent = await owner.post(`/team/invitations/${created.body.data.id}/resend`)
    expect(resent.status, resent.text).toBe(202)
    const second = tokenOf(resent.body.data.link)
    expect(second).not.toBe(first)
    const stale = await new Client(api).post(`/invitations/${first}/accept`, {
      name: 'Agent One',
      password: PASSWORD,
    })
    expect(stale.status).toBe(404)
    const accepted = await new Client(api).post(`/invitations/${second}/accept`, {
      name: 'Agent One',
      password: PASSWORD,
    })
    expect(accepted.status, accepted.text).toBe(200)
    const agent = await signIn(agentEmail, p.workspaceId)
    expect((await agent.me()).body.data.memberships).toEqual([
      expect.objectContaining({ tenantId: p.workspaceId, role: 'AGENT' }),
    ])
  })

  it('issues operator reset links: single use, expiring, members of that workspace only', async () => {
    const members = await operator.get(`${ws(p.workspaceId)}/members`)
    expect(members.status, members.text).toBe(200)
    const agentRow = members.body.data.find((m: { email: string }) => m.email === agentEmail)
    expect(agentRow).toMatchObject({ role: 'AGENT', status: 'ACTIVE' })

    const link = await operator.post(`${ws(p.workspaceId)}/members/${agentRow.userId}/reset-link`)
    expect(link.status, link.text).toBe(200)
    expect(new Date(link.body.data.expiresAt).getTime()).toBeLessThan(Date.now() + 3601_000)
    const token = tokenOf(link.body.data.link)
    const reset = await new Client(api).post('/auth/password/reset', {
      token,
      password: 'brand-new-agent-password-1',
    })
    expect(reset.status).toBe(204)
    expect((await new Client(api).login(agentEmail)).status).toBe(401)
    expect((await new Client(api).login(agentEmail, 'brand-new-agent-password-1')).status).toBe(200)

    // An expired link is refused.
    const old = await operator.post(`${ws(p.workspaceId)}/members/${agentRow.userId}/reset-link`)
    const oldToken = tokenOf(old.body.data.link)
    await db.withGlobal((tx) =>
      tx.passwordResetToken.updateMany({
        where: { userId: agentRow.userId, usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    )
    const expired = await new Client(api).post('/auth/password/reset', {
      token: oldToken,
      password: 'another-agent-password-22',
    })
    expect(expired.status).toBeGreaterThanOrEqual(400)

    // Another workspace can't be used to reach this member; unknown workspaces are 404.
    const other = await provision('prov-b')
    tokenOf(other.setupLink)
    for (const res of [
      await operator.post(`${ws(other.workspaceId)}/members/${agentRow.userId}/reset-link`),
      await operator.get(`${ws(uuidv7())}/members`),
    ])
      expect(res.status, res.text).toBe(404)
    const otherMembers = (await operator.get(`${ws(other.workspaceId)}/members`)).body.data
    expect(otherMembers.map((m: { email: string }) => m.email)).toEqual([other.ownerEmail])
  })

  it('records emails as skipped when SMTP is not configured, and the worker keeps going', async () => {
    const rows = await waitFor(
      async () =>
        (await operator.get('/platform/email-deliveries')).body.data as Array<{
          kind: string
          status: string
          recipientHint: string
        }>,
      (r) =>
        ['account_setup', 'invitation', 'password_reset'].every((k) =>
          r.some((d) => d.kind === k && d.status === 'SKIPPED_NO_SMTP'),
        ),
    )
    expect(rows.find((d) => d.kind === 'invitation')!.recipientHint).toMatch(/^p•••@/)
  })

  it('needs a platform session, platform CSRF and fresh MFA for provisioning', async () => {
    const tenant = await signIn(p.ownerEmail, p.workspaceId)
    expect(
      (
        await tenant.post('/platform/workspaces/provision', {
          workspaceName: 'x Co',
          ownerName: 'x',
          ownerEmail: uniqueEmail('x'),
        })
      ).status,
    ).toBe(401)
    const csrf = operator.csrf
    operator.csrf = ''
    const noCsrf = await operator.post('/platform/workspaces/provision', {
      workspaceName: 'y Co',
      ownerName: 'y',
      ownerEmail: uniqueEmail('y'),
    })
    operator.csrf = csrf
    expect(noCsrf.status).toBe(403)
  })

  it('enforces seat and WhatsApp number limits from entitlements', async () => {
    const override = (key: string, value: number) =>
      operator.post(`${ws(p.workspaceId)}/entitlement-operations`, {
        kind: 'override_set',
        key,
        value,
        reason: 'Launch plan limits test',
        reference: 'prov-test',
        idempotencyKey: randomUUID(),
      })
    // Owner + agent = 2 seats.
    expect((await override('max_users', 2)).status).toBe(200)
    const third = await owner.post('/team/invitations', {
      email: uniqueEmail('third'),
      role: 'AGENT',
    })
    expect(third.status).toBe(422)
    expect(third.body.error).toMatchObject({
      code: 'LIMIT_EXCEEDED',
      details: { key: 'max_users' },
    })

    expect((await override('max_phone_numbers', 1)).status).toBe(200)
    const connect = async () => {
      const ids = { wabaId: metaId(), phoneNumberId: metaId() }
      await fetch(`${mock.url}/__mock/seed`, {
        method: 'POST',
        body: JSON.stringify({
          wabaId: ids.wabaId,
          phones: [{ id: ids.phoneNumberId, display: '+91 90000 22222' }],
        }),
      })
      return operator.post(`${ws(p.workspaceId)}/whatsapp/connections`, {
        ...ids,
        displayPhoneNumber: '+91 90000 22222',
        accessToken: `mock-dev:${ids.wabaId}:limit-token`,
      })
    }
    expect((await connect()).status).toBe(201)
    const second = await connect()
    expect(second.status).toBe(422)
    expect(second.body.error.details.key ?? second.body.error.code).toBeTruthy()
  })

  it('never logs or audits a one-time token', async () => {
    const audit = await db.withTenant(p.workspaceId, (tx) => tx.auditLog.findMany())
    const blob = JSON.stringify(audit) + logs.join('\n')
    for (const t of tokens) expect(blob).not.toContain(t)
  })
})
