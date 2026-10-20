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
  REFRESH_PATH,
  SKIP_CSRF_KEY,
} from '@fenwira/api/core'
import { RequestMethod, type INestApplication } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { ModulesContainer } from '@nestjs/core'
import request from 'supertest'
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
        const skipCsrf = Boolean(
          Reflect.getMetadata(SKIP_CSRF_KEY, handler) ??
          Reflect.getMetadata(SKIP_CSRF_KEY, controller),
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
    // Each exemption is reviewed: pre-session logins, the SameSite=Strict refresh, and HMAC-signed
    // webhooks. A new @SkipCsrf route fails here until it is reviewed and listed.
    expect(exempt.sort()).toEqual([
      'POST /auth/refresh',
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
