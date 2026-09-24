import { apiEnvSchema, loadEnv, uuidv7, workerEnvSchema } from '@fenwira/config'
import { type INestApplication } from '@nestjs/common'
import request from 'supertest'
import { type ApiAppOptions, createApiApp } from '@fenwira/api/bootstrap'
import { createWorkerApp } from '../../src/bootstrap'

/**
 * Boots the real API (and optionally the real worker, for emails) in-process against the compose
 * Postgres/Redis/Mailpit (fenwira-test service). Everything goes through HTTP like a browser would.
 */
export async function bootApi(
  overrides: Record<string, string> = {},
  options: ApiAppOptions = {},
): Promise<INestApplication> {
  // TRUST_PROXY=1 lets each simulated browser present its own IP (X-Forwarded-For), so per-IP
  // rate limits apply per client instead of to the whole test run.
  const env = loadEnv(apiEnvSchema, {
    ...process.env,
    SYSTEM_PING_ENABLED: 'true',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    TRUST_PROXY: '1',
    ...overrides,
  })
  const app = await createApiApp(env, options)
  await app.init()
  return app
}

export async function bootWorker(
  overrides: Record<string, string> = {},
): Promise<INestApplication> {
  const app = await createWorkerApp(
    loadEnv(workerEnvSchema, {
      ...process.env,
      LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
      ...overrides,
    }),
  )
  await app.init()
  return app
}

const rand = () => Math.floor(Math.random() * 254) + 1

/** Lowercase, like the API stores it (emails are normalized). */
export const uniqueEmail = (label: string) =>
  `${label.toLowerCase()}-${uuidv7().slice(-12)}@fenwira.test`
export const PASSWORD = 'correct-horse-battery-fenwira'

type Agent = ReturnType<typeof request.agent>

/** A browser-like client: cookie jar + CSRF header + optional active tenant. */
export class Client {
  readonly agent: Agent
  /** A distinct client IP per simulated browser (see bootApi TRUST_PROXY). */
  readonly ip = `10.${rand()}.${rand()}.${rand()}`
  csrf = ''
  tenantId?: string

  constructor(app: INestApplication) {
    this.agent = request.agent(app.getHttpServer())
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      'X-Forwarded-For': this.ip,
      ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
      ...(this.tenantId ? { 'X-Tenant-Id': this.tenantId } : {}),
      ...extra,
    }
  }

  get(path: string, headers?: Record<string, string>) {
    return this.agent.get(`/api/v1${path}`).set(this.headers(headers))
  }
  post(path: string, body?: object, headers?: Record<string, string>) {
    return this.agent
      .post(`/api/v1${path}`)
      .set(this.headers(headers))
      .send(body ?? {})
  }
  patch(path: string, body?: object, headers?: Record<string, string>) {
    return this.agent
      .patch(`/api/v1${path}`)
      .set(this.headers(headers))
      .send(body ?? {})
  }
  delete(path: string, headers?: Record<string, string>) {
    return this.agent.delete(`/api/v1${path}`).set(this.headers(headers))
  }

  async register(email: string, name = 'Test User', password = PASSWORD) {
    const res = await this.post('/auth/register', { name, email, password })
    if (res.status !== 201) throw new Error(`register ${res.status} ${JSON.stringify(res.body)}`)
    this.csrf = res.body.data.csrfToken
    return res
  }

  async login(email: string, password = PASSWORD) {
    const res = await this.post('/auth/login', { email, password })
    if (res.body?.data?.csrfToken) this.csrf = res.body.data.csrfToken
    return res
  }

  async me() {
    return this.get('/auth/me')
  }
}

/**
 * Reads the newest email to `to` from Mailpit and returns the first link containing `pathPart`.
 * Pass `since` (epoch ms, taken before the action) so an older email to the same address can't win
 * the race against the one being waited for.
 */
export async function linkFromEmail(
  to: string,
  pathPart: string,
  opts: { since?: number; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  // Mailpit and the tests share the host clock, so no skew allowance (it would re-admit older mail).
  const since = opts.since ? new Date(opts.since).toISOString() : ''
  const base = process.env.MAILPIT_API_URL
  if (!base) throw new Error('MAILPIT_API_URL not set')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const search = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    const body = (await search.json()) as { messages?: Array<{ ID: string; Created: string }> }
    const newest = body.messages
      ?.filter((m) => m.Created >= since)
      .sort((a, b) => b.Created.localeCompare(a.Created))[0]
    if (newest) {
      const msg = (await (await fetch(`${base}/api/v1/message/${newest.ID}`)).json()) as {
        Text: string
      }
      const match = msg.Text.match(
        new RegExp(`https?://\\S*${pathPart.replace(/[/?]/g, (c) => `\\${c}`)}\\S+`),
      )
      if (match) return match[0]
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`no email with ${pathPart} for ${to}`)
}

export const tokenFrom = (url: string) =>
  url.includes('token=') ? new URL(url).searchParams.get('token')! : url.split('/').pop()!

/** Count emails sent to an address (to assert that nothing was sent). */
export async function emailCount(to: string): Promise<number> {
  const base = process.env.MAILPIT_API_URL!
  const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)
  return ((await res.json()) as { messages_count?: number; total?: number }).messages_count ?? 0
}
