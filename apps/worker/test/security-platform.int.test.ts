/**
 * ADR-0027 item E — launch hardening for the operator console and the new customer routes.
 *
 * Tenant routes (invoices, payment proofs, invitations, connection status) are already covered by
 * the generated CSRF/Origin matrix (security-session), the cross-tenant matrix (security-matrix,
 * security-idor) and the flow suites (manual-billing, managed-connection, provisioning). This suite
 * generates the same guarantees over EVERY /platform route from Nest metadata, so a new operator
 * route can't ship without them, and pins rate limits and the SMTP-credential leak check.
 */
import { PLATFORM_PERMISSION_KEY } from '@fenwira/api/core'
import { Database } from '@fenwira/database'
import { RequestMethod, type INestApplication } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ModulesContainer } from '@nestjs/core'
import { randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { waitFor } from './support/campaigns'
import { bootApi, bootWorker, Client, uniqueEmail } from './support/harness'
import { createOperator } from './support/platform'
import { type Member } from './support/workspace'

type Route = { method: string; path: string }
const VERBS: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
}

/** Every route that needs an operator session (it carries a @PlatformAccess permission). */
function platformRoutes(app: INestApplication): Route[] {
  const routes: Route[] = []
  for (const module of app.get(ModulesContainer).values())
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined
      if (!controller) continue
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '')
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name] as unknown
        if (typeof handler !== 'function' || name === 'constructor') continue
        if (!Reflect.getMetadata(PLATFORM_PERMISSION_KEY, handler)) continue
        const verb = VERBS[Reflect.getMetadata(METHOD_METADATA, handler) as number]
        if (!verb) continue
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '')
        routes.push({
          method: verb,
          path: `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/'),
        })
      }
    }
  return routes
}

const fill = (path: string) => path.replace(/:[a-zA-Z]+/g, '0192a8f0-0000-7000-8000-00000000abcd')
function call(client: Client, route: Route, headers: Record<string, string> = {}) {
  const path = fill(route.path)
  if (route.method === 'GET') return client.get(path, headers)
  if (route.method === 'DELETE') return client.delete(path, headers)
  if (route.method === 'PATCH') return client.patch(path, {}, headers)
  return client.post(path, {}, headers)
}

const SMTP_PASSWORD = 'never-log-this-smtp-password-42'
let api: INestApplication
let worker: INestApplication
let db: Database
let migration: Database
let operator: Client
let owner: Member
const workerLogs: string[] = []

beforeAll(async () => {
  api = await bootApi({
    BILLING_SUBSCRIPTIONS_ENFORCED: 'true',
    UPI_VPA: 'sec@okaxis',
    UPI_PAYEE_NAME: 'Sec',
  })
  // SMTP points nowhere reachable: every send fails, and the failure must not leak the password.
  worker = await bootWorker(
    { SMTP_URL: `smtp://user:${SMTP_PASSWORD}@127.0.0.1:9/` },
    {
      logDestination: new Writable({
        write(chunk: Buffer, _enc, done) {
          workerLogs.push(chunk.toString('utf8'))
          done()
        },
      }),
    },
  )
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 2 })
  migration = Database.connect({ url: process.env.MIGRATION_DATABASE_URL! })
  ;({ client: operator } = await createOperator(api, db, migration, 'sec-operator'))
  // The owner is provisioned through the console (this worker can't deliver verification email).
  const ownerEmail = uniqueEmail('sec-owner')
  const p = await operator.post('/platform/workspaces/provision', {
    workspaceName: 'Sec Co',
    ownerName: 'Sec Owner',
    ownerEmail,
  })
  expect(p.status, p.text).toBe(201)
  const token = new URL(p.body.data.setupLink).searchParams.get('token')!
  const password = 'sec-owner-password-123'
  expect((await new Client(api).post('/auth/password/reset', { token, password })).status).toBe(204)
  const client = new Client(api)
  expect((await client.login(ownerEmail, password)).status).toBe(200)
  client.tenantId = p.body.data.workspaceId
  owner = {
    client,
    email: ownerEmail,
    tenantId: p.body.data.workspaceId,
    membershipId: '',
    role: 'OWNER',
  }
}, 120_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await db?.disconnect()
  await migration?.disconnect()
})

describe('every /platform route (generated)', () => {
  it('includes the Managed Launch routes', () => {
    const names = platformRoutes(api).map((r) => `${r.method} ${r.path}`)
    expect(names).toEqual(
      expect.arrayContaining([
        'POST /platform/workspaces/provision',
        'POST /platform/workspaces/:workspaceId/members/:userId/reset-link',
        'POST /platform/workspaces/:workspaceId/whatsapp/connections',
        'POST /platform/workspaces/:workspaceId/whatsapp/connections/:id/rotate',
        'POST /platform/workspaces/:workspaceId/invoices',
        'POST /platform/workspaces/:workspaceId/payment-proofs/:proofId/approve',
        'GET /platform/billing/dashboard',
        'GET /platform/email-deliveries',
      ]),
    )
  })

  it('refuses a tenant session (no operator privilege) on every route', async () => {
    // As a browser on /platform pages sends it: tenant cookies, no tenant header. (With a
    // conflicting X-Tenant-Id the guard answers 404 before authenticating, also a refusal.)
    const failures: string[] = []
    const tenantId = owner.client.tenantId
    owner.client.tenantId = undefined
    try {
      for (const route of platformRoutes(api)) {
        const res = await call(owner.client, route)
        if (res.status !== 401) failures.push(`${route.method} ${route.path} → ${res.status}`)
      }
    } finally {
      owner.client.tenantId = tenantId
    }
    expect(failures).toEqual([])
  })

  it('refuses every operator mutation without the platform CSRF token or from a foreign Origin', async () => {
    const failures: string[] = []
    const csrf = operator.csrf
    for (const route of platformRoutes(api).filter((r) => r.method !== 'GET')) {
      operator.csrf = ''
      const noToken = await call(operator, route)
      operator.csrf = csrf
      const foreign = await call(operator, route, { Origin: 'https://evil.example' })
      for (const [label, res] of [
        ['no token', noToken],
        ['foreign origin', foreign],
      ] as const)
        if (res.status !== 403)
          failures.push(`${route.method} ${route.path} (${label}) → ${res.status}`)
    }
    operator.csrf = csrf
    expect(failures).toEqual([])
  })
})

describe('rate limits on the new endpoints', () => {
  it('limits payment-proof submissions per workspace (20 per hour)', async () => {
    const issued = await operator.post(`/platform/workspaces/${owner.tenantId}/invoices`, {
      kind: 'WALLET_TOPUP',
      amountMinor: 1000,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      idempotencyKey: randomUUID(),
    })
    expect(issued.status, issued.text).toBe(201)
    const invoiceId = issued.body.data.result.invoiceId
    let limited = 0
    for (let i = 0; i < 22; i++) {
      // Rejected UTR formats still consume the per-workspace budget only when they reach the
      // service, so use valid UTRs on a missing invoice: 404 until the limit, then 429.
      const res = await owner.client.post(
        `/billing/invoices/${i === 0 ? invoiceId : randomUUID()}/proofs`,
        {
          utr: `${Date.now()}${i}`.slice(-12),
        },
      )
      if (res.status === 429) limited++
    }
    expect(limited).toBeGreaterThan(0)
  })

  it('limits operator reset links per member (10 per hour)', async () => {
    const members = await operator.get(`/platform/workspaces/${owner.tenantId}/members`)
    const userId = members.body.data[0].userId
    const statuses: number[] = []
    for (let i = 0; i < 11; i++)
      statuses.push(
        (await operator.post(`/platform/workspaces/${owner.tenantId}/members/${userId}/reset-link`))
          .status,
      )
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})

describe('secrets', () => {
  it('a failing SMTP send is recorded and never logs the SMTP credentials', async () => {
    const res = await owner.client.post('/team/invitations', {
      email: uniqueEmail('sec-agent'),
      role: 'AGENT',
    })
    expect(res.status, res.text).toBe(201)
    const rows = await waitFor(
      async () =>
        (await operator.get('/platform/email-deliveries')).body.data as Array<{
          kind: string
          status: string
        }>,
      (r) => r.some((d) => d.kind === 'invitation' && d.status === 'FAILED'),
      45_000,
    )
    expect(JSON.stringify(rows)).not.toContain(SMTP_PASSWORD)
    expect(workerLogs.join('\n')).not.toContain(SMTP_PASSWORD)
    // The invitation link stays usable even though email failed.
    expect(res.body.data.link).toMatch(/\/invitations\//)
  })
})
