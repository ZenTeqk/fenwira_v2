/**
 * Phase 12 — session and CSRF hardening.
 *
 * auth.int.test.ts covers refresh rotation/reuse, logout, revocation and CSRF on one route. This
 * suite generates the CSRF and Origin checks over every state-changing route (from Nest metadata)
 * and pins the cookie attributes and session-fixation behaviour.
 */
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  REFRESH_COOKIE,
  PUBLIC_SITE_KEY,
  REFRESH_PATH,
  SKIP_CSRF_KEY,
} from '@fenwira/api/core'
import { RequestMethod, type INestApplication } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ModulesContainer } from '@nestjs/core'
import request from 'supertest'
import { Database } from '@fenwira/database'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootApi, bootWorker, PASSWORD } from './support/harness'
import { createOwner, type Member } from './support/workspace'

type Route = { method: string; path: string; skipCsrf: boolean }

const VERBS: Record<number, string> = {
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
}

/** Every state-changing route outside /platform (the operator console has its own cookies/suite). */
function mutatingRoutes(app: INestApplication): Route[] {
  const routes: Route[] = []
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | undefined
      if (!controller) continue
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '')
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name] as unknown
        if (typeof handler !== 'function' || name === 'constructor') continue
        const verb = VERBS[Reflect.getMetadata(METHOD_METADATA, handler) as number]
        if (!verb) continue
        const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '')
        const path = `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(/\/+/g, '/')
        if (path.startsWith('/platform')) continue
        // @PublicSite routes are cookieless by design: CSRF there is the origin allow-list only.
        const skipCsrf = [SKIP_CSRF_KEY, PUBLIC_SITE_KEY].some((key) =>
          Boolean(Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller)),
        )
        routes.push({ method: verb, path, skipCsrf })
      }
    }
  }
  return routes
}

const fill = (path: string) => path.replace(/:[a-zA-Z]+/g, '0192a8f0-0000-7000-8000-00000000abcd')

function send(m: Member, route: Route, headers: Record<string, string>) {
  m.client.tenantId = m.tenantId
  const path = fill(route.path)
  switch (route.method) {
    case 'POST':
      return m.client.post(path, {}, headers)
    case 'PUT':
      return m.client.put(path, {}, headers)
    case 'PATCH':
      return m.client.patch(path, {}, headers)
    default:
      return m.client.delete(path, headers)
  }
}

/** Set-Cookie headers of a response, keyed by cookie name, attributes lower-cased. */
function cookiesOf(res: { headers: Record<string, unknown> }) {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : []
  return Object.fromEntries(
    list.map((c) => {
      const [pair, ...attrs] = c.split(';').map((s) => s.trim())
      const [name, ...value] = pair!.split('=')
      return [name!, { value: value.join('='), attrs: attrs.map((a) => a.toLowerCase()) }]
    }),
  )
}

let api: INestApplication
let worker: INestApplication
let owner: Member

beforeAll(async () => {
  api = await bootApi()
  worker = await bootWorker()
  owner = await createOwner(api, 'session', 'Session Co')
}, 60_000)

afterAll(async () => {
  await worker?.close()
  await api?.close()
})

describe('CSRF over every state-changing route (generated)', () => {
  it('refuses cookie-authenticated mutations without the CSRF token, except documented exemptions', async () => {
    const routes = mutatingRoutes(api)
    expect(routes.length).toBeGreaterThan(80)
    const csrf = owner.client.csrf
    const missing: string[] = []
    const exempt: string[] = []
    try {
      owner.client.csrf = ''
      for (const route of routes) {
        const res = await send(owner, route, {})
        const name = `${route.method} ${route.path}`
        if (route.skipCsrf) exempt.push(name)
        else if (res.status !== 403 || res.body.error?.code !== 'CSRF_FAILED')
          missing.push(`${name} → ${res.status}`)
      }
    } finally {
      owner.client.csrf = csrf
    }
    expect(missing).toEqual([])
    // Each exemption is reviewed: pre-session logins, the SameSite=Strict refresh, HMAC-signed
    // webhooks, and the cookieless marketing-site form (@PublicSite: fenwira.com origins only).
    // A new @SkipCsrf or @PublicSite route fails here until it is reviewed and listed.
    expect(exempt.sort()).toEqual([
      'POST /auth/refresh',
      'POST /public/request-access',
      'POST /webhooks/automation/:token',
      'POST /webhooks/whatsapp',
    ])
  })

  it('refuses every mutation from a foreign Origin, exempt routes included', async () => {
    const failures: string[] = []
    for (const route of mutatingRoutes(api)) {
      const res = await send(owner, route, { Origin: 'https://evil.example' })
      if (res.status !== 403 || res.body.error?.code !== 'CSRF_FAILED')
        failures.push(`${route.method} ${route.path} → ${res.status}`)
    }
    expect(failures).toEqual([])
  })
})

describe('session cookies', () => {
  it('are HttpOnly with the documented SameSite and Path, and Secure when COOKIE_SECURE is on', async () => {
    const secureApi = await bootApi({ COOKIE_SECURE: 'true' })
    try {
      for (const [app, secure] of [
        [api, false],
        [secureApi, true],
      ] as const) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', `10.9.${Math.floor(Math.random() * 250)}.1`)
          .send({ email: owner.email, password: PASSWORD })
        expect(res.status, res.text).toBe(200)
        const jar = cookiesOf(res)
        const expected = {
          [ACCESS_COOKIE]: { sameSite: 'samesite=lax', path: 'path=/' },
          [REFRESH_COOKIE]: { sameSite: 'samesite=strict', path: `path=${REFRESH_PATH}` },
          [CSRF_COOKIE]: { sameSite: 'samesite=lax', path: 'path=/' },
        }
        for (const [name, want] of Object.entries(expected)) {
          const c = jar[name]
          expect(c, name).toBeTruthy()
          expect(c!.attrs, name).toContain('httponly')
          expect(c!.attrs, name).toContain(want.sameSite)
          expect(c!.attrs, name).toContain(want.path)
          expect(c!.attrs.includes('secure'), `${name} secure`).toBe(secure)
        }
      }
    } finally {
      await secureApi.close()
    }
  })

  it('never adopts a planted session (fixation): planted cookies are refused and login issues new ones', async () => {
    const planted = 'attacker-chosen-value'
    const server = api.getHttpServer()
    const cookie = `${ACCESS_COOKIE}=${planted}; ${REFRESH_COOKIE}=${planted}; ${CSRF_COOKIE}=${planted}`
    const ip = `10.8.${Math.floor(Math.random() * 250)}.1`

    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', ip)
    expect(me.status).toBe(401)
    const refresh = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('X-Forwarded-For', ip)
    expect(refresh.status).toBe(401)

    const login = await request(server)
      .post('/api/v1/auth/login')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', planted)
      .set('X-Forwarded-For', ip)
      .send({ email: owner.email, password: PASSWORD })
    expect(login.status, login.text).toBe(200)
    const issued = cookiesOf(login)
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE]) {
      expect(issued[name]?.value, name).toBeTruthy()
      expect(issued[name]!.value, name).not.toBe(planted)
    }
    expect(login.body.data.csrfToken).not.toBe(planted)
  })
})

describe('session timeouts: 12 h absolute, 3 h idle (server-side)', () => {
  const server = () => api.getHttpServer()
  const db = () => Database.connect({ url: process.env.DATABASE_URL! })
  async function signIn(member: Member) {
    const res = await request(server())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', `10.7.${Math.floor(Math.random() * 250)}.1`)
      .send({ email: member.email, password: PASSWORD })
    expect(res.status, res.text).toBe(200)
    return cookiesOf(res)
  }
  const refresh = (jar: ReturnType<typeof cookiesOf>, active: boolean) =>
    request(server())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE}=${jar[REFRESH_COOKIE]!.value}`)
      .set('X-Forwarded-For', `10.6.${Math.floor(Math.random() * 250)}.1`)
      .set(active ? { 'X-Fenwira-Active': '1' } : {})
  const latest = (d: Database, email: string) =>
    d.withGlobal(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { email } })
      return tx.session.findFirstOrThrow({
        where: { userId: user.id, revokedAt: null },
        orderBy: { createdAt: 'desc' },
      })
    })

  it('cookies expire with the server session (absolute 12 h from sign-in)', async () => {
    const member = await createOwner(api, 'timeout-a', 'Timeout A Co')
    const jar = await signIn(member)
    const d = db()
    try {
      const row = await latest(d, member.email)
      expect(row.expiresAt.getTime() - Date.now()).toBeGreaterThan(11.9 * 3600_000)
      expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(12 * 3600_000)
      const expires = jar[REFRESH_COOKIE]!.attrs.find((a) => a.startsWith('expires='))
      expect(Math.abs(Date.parse(expires!.slice(8)) - row.expiresAt.getTime())).toBeLessThan(2000)
    } finally {
      await d.disconnect()
    }
  })

  it('3 h without declared activity ends the session even if the tab keeps refreshing', async () => {
    const member = await createOwner(api, 'timeout-b', 'Timeout B Co')
    const jar = await signIn(member)
    const d = db()
    try {
      const row = await latest(d, member.email)
      await d.withGlobal((tx) =>
        tx.session.update({
          where: { id: row.id },
          data: { lastUsedAt: new Date(Date.now() - (3 * 60 + 1) * 60_000) },
        }),
      )
      const res = await refresh(jar, false)
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('SESSION_EXPIRED')
    } finally {
      await d.disconnect()
    }
  })

  it('activity extends the idle limit but not the absolute one', async () => {
    const member = await createOwner(api, 'timeout-c', 'Timeout C Co')
    const jar = await signIn(member)
    const d = db()
    try {
      const row = await latest(d, member.email)
      await d.withGlobal((tx) =>
        tx.session.update({
          where: { id: row.id },
          data: { lastUsedAt: new Date(Date.now() - 2 * 3600_000) },
        }),
      )
      const passive = await refresh(jar, false)
      expect(passive.status, passive.text).toBe(200)
      // Passive refresh keeps the old activity time: idle ends ~1 h from now.
      expect(Date.parse(passive.body.data.session.idleExpiresAt) - Date.now()).toBeLessThan(
        1.1 * 3600_000,
      )
      const next = cookiesOf(passive)
      const active = await refresh(next, true)
      expect(active.status, active.text).toBe(200)
      expect(Date.parse(active.body.data.session.idleExpiresAt) - Date.now()).toBeGreaterThan(
        2.9 * 3600_000,
      )
      expect(Date.parse(active.body.data.session.expiresAt)).toBe(row.expiresAt.getTime())
      // Past the absolute end, even an active refresh is refused.
      await d.withGlobal((tx) =>
        tx.session.updateMany({
          where: { familyId: row.familyId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      )
      expect((await refresh(cookiesOf(active), true)).status).toBe(401)
    } finally {
      await d.disconnect()
    }
  })
})
