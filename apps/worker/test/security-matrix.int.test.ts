import { PERMISSION_KEY, ROLE_KEY, TENANT_SCOPED_KEY } from '@fenwira/api/core'
import { RealtimeGateway } from '@fenwira/api/modules/realtime'
import { type Permission, type Role, roleHasPermission, ROLES } from '@fenwira/contracts'
import { RequestMethod, type INestApplication } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ModulesContainer } from '@nestjs/core'
import { type AddressInfo } from 'node:net'
import { io, type Socket } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker, Client } from './support/harness'
import { addMember, createOwner, type Member } from './support/workspace'

type Route = { method: string; path: string; permission?: Permission; role?: Role; scoped: boolean }

/** Every tenant-scoped route, discovered from the running app's metadata (never hand-listed). */
function discoverTenantRoutes(app: INestApplication): Route[] {
  const methods: Record<number, string> = {
    [RequestMethod.GET]: 'GET',
    [RequestMethod.POST]: 'POST',
    [RequestMethod.PUT]: 'PUT',
    [RequestMethod.PATCH]: 'PATCH',
    [RequestMethod.DELETE]: 'DELETE',
  }
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
        const permission = read(PERMISSION_KEY) as Permission | undefined
        const role = read(ROLE_KEY) as Role | undefined
        const scoped = Boolean(read(TENANT_SCOPED_KEY) || permission || role)
        if (!scoped) continue
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '')
        const path = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/')
        routes.push({ method: methods[verb]!, path, permission, role, scoped })
      }
    }
  }
  return routes
}

const fill = (path: string) => path.replace(/:[a-zA-Z]+/g, '0192a8f0-0000-7000-8000-00000000abcd')

function call(member: Member, route: Route, tenantId = member.tenantId) {
  member.client.tenantId = tenantId
  const path = fill(route.path)
  switch (route.method) {
    case 'GET':
      return member.client.get(path)
    case 'POST':
      return member.client.post(path, {})
    case 'PATCH':
      return member.client.patch(path, {})
    case 'PUT':
      return member.client.put(path, {})
    case 'DELETE':
      return member.client.delete(path)
    default:
      throw new Error(`unsupported ${route.method}`)
  }
}

let api: INestApplication
let worker: INestApplication
let routes: Route[]
let byRole: Record<Role, Member>
let tenantB: Member

beforeAll(async () => {
  api = await bootApi()
  worker = await bootWorker()
  routes = discoverTenantRoutes(api)
  const owner = await createOwner(api, 'matrixA', 'Matrix A')
  const members = await Promise.all(
    (['ADMIN', 'MANAGER', 'AGENT', 'VIEWER'] as const).map((r) => addMember(api, owner, r)),
  )
  byRole = {
    OWNER: owner,
    ADMIN: members[0]!,
    MANAGER: members[1]!,
    AGENT: members[2]!,
    VIEWER: members[3]!,
  }
  tenantB = await createOwner(api, 'matrixB', 'Matrix B')
  await tenantB.client.post('/team/invitations', {
    email: `b-secret-${Date.now()}@fenwira.test`,
    role: 'AGENT',
  })
}, 120_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
})

describe('route discovery', () => {
  it('finds every tenant-scoped route, each guarded by a permission or role', () => {
    expect(routes.length).toBeGreaterThanOrEqual(12)
    for (const r of routes) expect(r.permission ?? r.role, `${r.method} ${r.path}`).toBeDefined()
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /workspace',
        'PATCH /team/members/:id',
        'GET /audit-logs',
        'DELETE /workspace',
        'GET /roles',
        'POST /canned-replies',
        'PATCH /canned-replies/:id',
      ]),
    )
  })
})

describe('RBAC: every role gets 403 for every permission it lacks (generated)', () => {
  it.each(ROLES)('%s', async (role) => {
    const failures: string[] = []
    for (const route of routes) {
      const lacks = route.permission
        ? !roleHasPermission(role, route.permission)
        : route.role !== role
      if (!lacks) continue
      const res = await call(byRole[role], route)
      if (res.status !== 403 || res.body.error?.code !== 'FORBIDDEN')
        failures.push(`${route.method} ${route.path} → ${res.status}`)
    }
    expect(failures).toEqual([])
  })

  it('lets each role through routes it holds the permission for (GET routes)', async () => {
    const failures: string[] = []
    for (const role of ROLES) {
      for (const route of routes.filter(
        (r) => r.method === 'GET' && r.permission && roleHasPermission(role, r.permission),
      )) {
        const res = await call(byRole[role], route)
        // Routes with an :id get a random id: past the permission gate that is a plain 404
        // NOT_FOUND for the unknown resource (never 403, never TENANT_NOT_FOUND).
        const allowed = route.path.includes(':')
          ? res.status === 200 || (res.status === 404 && res.body.error?.code === 'NOT_FOUND')
          : res.status === 200
        if (!allowed) failures.push(`${role} ${route.path} → ${res.status}`)
      }
    }
    expect(failures).toEqual([])
  })
})

describe('cross-tenant isolation over HTTP (generated)', () => {
  it('Tenant A’s owner gets 404 TENANT_NOT_FOUND on every tenant route of Tenant B', async () => {
    const failures: string[] = []
    for (const route of routes) {
      const res = await call(byRole.OWNER, route, tenantB.tenantId)
      if (res.status !== 404 || res.body.error?.code !== 'TENANT_NOT_FOUND')
        failures.push(`${route.method} ${route.path} → ${res.status}`)
    }
    expect(failures).toEqual([])
  })

  it('malformed and unknown tenant ids are indistinguishable from foreign ones', async () => {
    for (const tenantId of ['not-a-uuid', '0192a8f0-0000-7000-8000-000000000000', '']) {
      const res = await call(
        byRole.OWNER,
        { method: 'GET', path: '/workspace', scoped: true },
        tenantId,
      )
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('TENANT_NOT_FOUND')
    }
  })

  it('lists in Tenant A never contain Tenant B data (members, invitations, audit)', async () => {
    const owner = byRole.OWNER
    owner.client.tenantId = owner.tenantId
    const payload = JSON.stringify([
      (await owner.client.get('/team/members')).body,
      (await owner.client.get('/team/invitations')).body,
      (await owner.client.get('/audit-logs?limit=100')).body,
    ])
    expect(payload).not.toContain(tenantB.email)
    expect(payload).not.toContain(tenantB.tenantId)
    expect(payload).not.toContain('b-secret-')
  })

  it('cannot act on Tenant B records through Tenant A (ids from B are not found)', async () => {
    tenantB.client.tenantId = tenantB.tenantId
    const bInvitation = (await tenantB.client.get('/team/invitations')).body.data[0].id
    const owner = byRole.OWNER
    owner.client.tenantId = owner.tenantId
    expect((await owner.client.post(`/team/invitations/${bInvitation}/revoke`)).status).toBe(404)
    expect(
      (await owner.client.patch(`/team/members/${tenantB.membershipId}`, { role: 'VIEWER' }))
        .status,
    ).toBe(404)
    expect(
      (await owner.client.post(`/team/members/${tenantB.membershipId}/deactivate`)).status,
    ).toBe(404)
    expect(
      (
        await owner.client.post('/workspace/transfer-ownership', {
          membershipId: tenantB.membershipId,
        })
      ).status,
    ).toBe(404)
    // …and B is untouched.
    const bInvites = (await tenantB.client.get('/team/invitations')).body.data
    expect(bInvites[0].status).toBe('PENDING')
  })
})

describe('cross-tenant isolation over WebSocket', () => {
  let url: string
  beforeAll(async () => {
    await api.listen(0)
    url = `http://127.0.0.1:${(api.getHttpServer().address() as AddressInfo).port}`
  })

  /** A fresh browser session for the member: the Cookie header a real handshake would carry. */
  const cookieOf = async (member: Member) => {
    const res = await new Client(api).login(member.email)
    return ((res.headers['set-cookie'] as unknown as string[]) ?? [])
      .map((c) => c.split(';')[0])
      .join('; ')
  }

  function connect(
    cookie: string,
    tenantId?: string,
  ): Promise<{ socket: Socket; outcome: string }> {
    return new Promise((resolve) => {
      const socket = io(url, {
        path: '/ws',
        transports: ['websocket'],
        extraHeaders: { Cookie: cookie },
        auth: tenantId ? { tenantId } : {},
        reconnection: false,
      })
      socket.on('session.ready', () => resolve({ socket, outcome: 'ready' }))
      socket.on('session.error', (e: { code: string }) => resolve({ socket, outcome: e.code }))
      socket.on('connect_error', () => resolve({ socket, outcome: 'connect_error' }))
    })
  }

  it('rejects sockets without a session', async () => {
    const { socket, outcome } = await connect('')
    expect(outcome).toBe('UNAUTHENTICATED')
    socket.close()
  })

  it('refuses to join a foreign tenant room, at connect and on tenant.switch', async () => {
    const cookie = await cookieOf(byRole.OWNER)
    const foreign = await connect(cookie, tenantB.tenantId)
    expect(foreign.outcome).toBe('TENANT_NOT_FOUND')
    foreign.socket.close()

    const own = await connect(cookie, byRole.OWNER.tenantId)
    expect(own.outcome).toBe('ready')
    const ack = await own.socket.emitWithAck('tenant.switch', { tenantId: tenantB.tenantId })
    expect(ack).toEqual({ ok: false, error: 'TENANT_NOT_FOUND' })

    const received: string[] = []
    own.socket.on('probe', (p: { tenant: string }) => received.push(p.tenant))
    const gateway = api.get(RealtimeGateway)
    gateway.emitToTenant(tenantB.tenantId, 'probe', { tenant: 'B' })
    gateway.emitToTenant(byRole.OWNER.tenantId, 'probe', { tenant: 'A' })
    await new Promise((r) => setTimeout(r, 500))
    expect(received).toEqual(['A'])
    own.socket.close()
  })
})
