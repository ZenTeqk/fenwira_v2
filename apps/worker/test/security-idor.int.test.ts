/**
 * Phase 12 — cross-tenant object references (IDOR), generated.
 *
 * security-matrix proves a foreign X-Tenant-Id is refused. This suite covers the other half: Tenant
 * A, acting in its OWN workspace, puts Tenant B's real record ids into every parameterised tenant
 * route. Routes come from the running app's metadata and ids from every tenant table (pg_catalog),
 * so neither list is hand-maintained. A request must never succeed (2xx) or crash (5xx), and B's
 * rows must be byte-identical afterwards.
 */
import { PERMISSION_KEY, ROLE_KEY, TENANT_SCOPED_KEY } from '@fenwira/api/core'
import { Database } from '@fenwira/database'
import {
  deliverWebhook,
  inboundMessageWebhook,
  type MetaMockState,
  startMetaMock,
} from '@fenwira/whatsapp/testing'
import { RequestMethod, type INestApplication } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ModulesContainer } from '@nestjs/core'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chain, createFlow, keyword, text } from './support/automation'
import {
  campaignWorld,
  type CampaignWorld,
  draftCampaign,
  metaId,
  waitFor,
} from './support/campaigns'
import { bootApi, bootWorker } from './support/harness'
import { createOwner, type Member } from './support/workspace'

type Route = { method: string; path: string }

/**
 * Idempotent writes that only ever touch the caller's own rows and answer 2xx whether or not the
 * id matched, so a 2xx here is not a leak. B's rows are still required to be unchanged.
 */
const BLIND_OWN_ROW_WRITES = new Set([
  // inbox.service readNotification: updateMany WHERE userId = caller AND id = :id (plus RLS).
  'POST /notifications/:id/read',
])

const VERBS: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
}

/** Tenant-scoped routes with at least one path parameter. */
function parameterisedRoutes(app: INestApplication): Route[] {
  const routes: Route[] = []
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined
      if (!controller) continue
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '')
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name] as unknown
        if (typeof handler !== 'function' || name === 'constructor') continue
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined
        if (verb === undefined) continue
        const read = (key: string) =>
          Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller)
        if (!(read(TENANT_SCOPED_KEY) || read(PERMISSION_KEY) || read(ROLE_KEY))) continue
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '')
        const path = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/')
        if (path.includes(':')) routes.push({ method: VERBS[verb]!, path })
      }
    }
  }
  return routes
}

function call(m: Member, route: Route, id: string) {
  m.client.tenantId = m.tenantId // A's own workspace, never B's
  const path = route.path.replace(/:[a-zA-Z]+/g, id)
  switch (route.method) {
    case 'GET':
      return m.client.get(path)
    case 'POST':
      return m.client.post(path, {}, { 'Idempotency-Key': `idor-${metaId()}` })
    case 'PATCH':
      return m.client.patch(path, {})
    case 'PUT':
      return m.client.put(path, {})
    case 'DELETE':
      return m.client.delete(path)
  }
  throw new Error(`unsupported ${route.method}`)
}

let api: INestApplication
let worker: INestApplication
const SECRET = 'idor-test-secret'
let mock: { server: Server; url: string; state: MetaMockState }
let db: Database
let a: Member
let b: CampaignWorld
let tables: string[]
const seeded: Record<string, number> = {}

/** Ids of B's rows in every tenant table that has an `id` column, read inside B's RLS context. */
async function idsOfB(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  for (const t of tables) {
    const rows = await db.withTenant(b.owner.tenantId, (tx) =>
      tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id::text AS id FROM "${t}" LIMIT 5`),
    )
    if (rows.length)
      out.set(
        t,
        rows.map((r) => r.id),
      )
  }
  return out
}

/** Content hash per table of B's rows, used to prove nothing of B changed. */
async function snapshotB(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const t of tables) {
    const [row] = await db.withTenant(b.owner.tenantId, (tx) =>
      tx.$queryRawUnsafe<Array<{ h: string | null }>>(
        `SELECT md5(string_agg(x::text, '|' ORDER BY x.id)) AS h FROM "${t}" x`,
      ),
    )
    out[t] = row?.h ?? 'empty'
  }
  return out
}

/** Best-effort seeding: record how many rows each step produced instead of failing the suite. */
async function seed(label: string, step: () => Promise<unknown>) {
  try {
    await step()
    seeded[label] = 1
  } catch (e) {
    seeded[label] = 0
    process.stdout.write(`[idor] seeding ${label} failed: ${(e as Error).message}\n`)
  }
}

beforeAll(async () => {
  mock = await startMetaMock(0)
  api = await bootApi({
    META_GRAPH_BASE_URL: mock.url,
    META_APP_SECRET: SECRET,
    WHATSAPP_DEV_CONNECT: 'true',
  })
  await api.listen(0)
  const apiUrl = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`
  const webhookUrl = `${apiUrl}/api/v1/webhooks/whatsapp`
  mock.state.webhookTarget = {
    url: webhookUrl,
    appSecret: SECRET,
    statuses: [],
    delayMs: 20,
  }
  worker = await bootWorker({
    META_GRAPH_BASE_URL: mock.url,
    AUTOMATION_WEBHOOK_DEV_HOSTS: '127.0.0.1',
  })
  db = Database.connect({ url: process.env.DATABASE_URL!, poolSize: 4 })
  tables = (
    await db.withTenant('00000000-0000-7000-8000-000000000000', (tx) =>
      tx.$queryRawUnsafe<Array<{ t: string }>>(`
        SELECT c.relname AS t FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                      AND a.attname = 'tenant_id' AND NOT a.attisdropped)
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                      AND a.attname = 'id' AND NOT a.attisdropped)
        ORDER BY 1`),
    )
  ).map((r) => r.t)

  a = await createOwner(api, 'idorA', 'IDOR A')
  b = await campaignWorld(api, mock.url, 'idorB')
  const bc = b.owner.client
  bc.tenantId = b.owner.tenantId

  let tagId = ''
  let contactId = ''
  await seed('tag', async () => {
    const r = await bc.post('/tags', { name: `b-${metaId()}` })
    if (r.status !== 201) throw new Error(`${r.status} ${r.text}`)
    tagId = r.body.data.id
  })
  await seed('contact', async () => {
    const r = await bc.post('/contacts', { phone: `+9198${metaId().slice(-8)}`, name: 'B Person' })
    if (r.status !== 201) throw new Error(`${r.status} ${r.text}`)
    contactId = r.body.data.id
    if (tagId) await bc.post('/contacts/bulk', { action: 'TAG', contactIds: [contactId], tagId })
  })
  await seed('contact note', () => bc.post(`/contacts/${contactId}/notes`, { body: 'b note' }))
  await seed('campaign', () => draftCampaign(b, tagId))
  await seed('flow', () => createFlow(b.owner, 'B flow', chain(keyword('bkw'), text('t', 'hi'))))
  await seed('canned reply', () =>
    bc.post('/canned-replies', { shortcut: '/bonly', title: 'B', body: 'B only' }),
  )
  await seed('api key', () => bc.post('/api-keys', { name: 'b key', scopes: ['contacts.read'] }))
  await seed('webhook endpoint', () =>
    bc.post('/webhook-endpoints', {
      name: 'b hook',
      url: 'http://127.0.0.1:9/b',
      events: ['contact.created'],
    }),
  )
  await seed('invitation', () =>
    bc.post('/team/invitations', { email: `b-${metaId()}@x.test`, role: 'AGENT' }),
  )
  await seed('conversation + message', async () => {
    await deliverWebhook(
      webhookUrl,
      SECRET,
      inboundMessageWebhook(b.ids, {
        from: `9197${metaId().slice(-8)}`,
        wamid: `wamid.${metaId()}`,
        text: 'hello from B',
        name: 'B Customer',
      }),
    )
    const convs = await waitFor(
      () => bc.get('/conversations'),
      (r) => (r.body.data?.length ?? 0) > 0,
    )
    const convId = convs.body.data[0].id
    await bc.post(`/conversations/${convId}/notes`, { body: 'b internal note' })
  })
}, 180_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
  await new Promise<void>((r) => (mock ? mock.server.close(() => r()) : r()))
  await db?.disconnect()
})

describe('IDOR: Tenant A with Tenant B record ids (generated)', () => {
  it('never succeeds, never crashes, and leaves every B row unchanged', async () => {
    const routes = parameterisedRoutes(api)
    const pool = await idsOfB()
    const ids = [...new Set([...pool.values()].flat())]
    expect(routes.length).toBeGreaterThan(50)
    expect(ids.length).toBeGreaterThan(10)

    // Background work (outbox relay, analytics, template sync) can still touch B's rows; compare
    // only tables that were stable across two snapshots taken before the attack.
    const s1 = await snapshotB()
    await new Promise((r) => setTimeout(r, 3000))
    const s2 = await snapshotB()
    // analytics_* rollups/episodes are projections the scheduler recomputes from source rows every
    // minute (docs/ANALYTICS.md); their source tables are compared instead.
    const derived = (t: string) => t.startsWith('analytics_')
    const stable = tables.filter((t) => !derived(t) && s1[t] === s2[t])

    const leaks: string[] = []
    const crashes: string[] = []
    const reached = new Set<string>()
    for (const route of routes) {
      for (const id of ids) {
        const res = await call(a, route, id)
        const where = `${route.method} ${route.path} [${id}]`
        const blind = BLIND_OWN_ROW_WRITES.has(`${route.method} ${route.path}`)
        if (res.status >= 200 && res.status < 300 && !blind) leaks.push(`${where} → ${res.status}`)
        else if (res.status >= 500) crashes.push(`${where} → ${res.status}`)
        else if (res.status === 404) reached.add(`${route.method} ${route.path}`)
      }
    }

    const after = await snapshotB()
    const changed = stable.filter((t) => after[t] !== s2[t])

    process.stdout.write(
      `[idor] ${routes.length} routes × ${ids.length} B ids from ${pool.size} tables ` +
        `(${[...pool.keys()].join(', ')}); seeded ${JSON.stringify(seeded)}; ` +
        `${reached.size} routes answered 404 for at least one id; ` +
        `${stable.length}/${tables.length} tables stable and compared.\n`,
    )
    expect(leaks).toEqual([])
    expect(crashes).toEqual([])
    expect(changed).toEqual([])
  }, 600_000)
})
