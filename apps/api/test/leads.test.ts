import { Writable } from 'node:stream'
import { accessRequestSchema } from '@fenwira/contracts'
import { type ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Job } from 'bullmq'
import { type PinoLogger } from 'nestjs-pino'
import { describe, expect, it, vi } from 'vitest'
import { corsOptionsFor } from '../src/bootstrap'
import { type CoreConfig } from '../src/core/config/core-config'
import { requestContext } from '../src/core/context/request-context'
import { AppError } from '../src/core/http/app-error'
import { createRootLogger } from '../src/core/logging/logger'
import { CsrfGuard } from '../src/core/security/csrf.guard'
import { PUBLIC_SITE_KEY } from '../src/core/security/decorators'
import { type RateLimitRule, type RateLimitService } from '../src/core/security/rate-limit.service'
import { LeadsProcessor } from '../src/modules/leads/leads.processor'
import { ACCESS_REQUEST_LIMITS, LeadsService } from '../src/modules/leads/leads.service'
import { type Mailer } from '../src/modules/platform'

const valid = {
  name: 'Asha Rao',
  company: 'Rao Retail',
  email: 'asha.rao@example.com',
  phone: '+91 98765 43210',
  volume: 'Not sure yet' as const,
  website: '',
}
const SITE = ['https://fenwira.com', 'https://www.fenwira.com']
const APP = 'https://app.fenwira.com'

/** In-memory sliding-window stand-in with the real limiter's contract (429 RATE_LIMITED). */
function limiter() {
  const hits = new Map<string, number>()
  const rules: RateLimitRule[] = []
  const service = {
    consume: async (rs: RateLimitRule[]) => {
      for (const r of rs) {
        rules.push(r)
        const k = `${r.bucket}:${r.key}`
        hits.set(k, (hits.get(k) ?? 0) + 1)
        if (hits.get(k)! > r.limit) throw new AppError('RATE_LIMITED', 429, 'Too many attempts.')
      }
    },
  } as unknown as RateLimitService
  return { service, rules }
}

function fakeDb() {
  const rows: Array<Record<string, unknown>> = []
  const events: Array<{ type: string; payload: Record<string, unknown> }> = []
  const tx = {
    accessRequest: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rows.push({ status: 'QUEUED', ...data })
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id),
      ),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => {
        Object.assign(
          rows.find((r) => r.id === where.id)!,
          data,
        )
      }),
    },
  }
  const db = {
    withGlobal: (fn: (t: typeof tx) => unknown) => fn(tx),
    system: {
      emitPlatformEvent: vi.fn(async (type: string, payload: Record<string, unknown>) => {
        events.push({ type, payload })
        return 'e1'
      }),
    },
  }
  return { db, rows, events, tx }
}

function capturedLogger() {
  const lines: string[] = []
  const root = createRootLogger(
    { service: 'api', version: 't', nodeEnv: 'test', logLevel: 'info' },
    new Writable({
      write(chunk, _e, cb) {
        lines.push(String(chunk))
        cb()
      },
    }),
  )
  const logger = {
    setContext: () => undefined,
    info: (...a: unknown[]) => (root.info as (...x: unknown[]) => void)(...a),
  } as unknown as PinoLogger
  return { lines, logger }
}

function service() {
  const db = fakeDb()
  const lim = limiter()
  const log = capturedLogger()
  const leads = new LeadsService(db.db as never, lim.service, log.logger)
  const asIp = (ip: string, fn: () => Promise<void>) =>
    requestContext.run({ correlationId: 'req-1', ip } as never, fn)
  return { leads, asIp, ...db, ...lim, ...log }
}

describe('request access validation', () => {
  it('accepts a complete request and rejects bad or oversized fields', () => {
    expect(accessRequestSchema.safeParse(valid).success).toBe(true)
    for (const bad of [
      { ...valid, email: 'not-an-email' },
      { ...valid, phone: 'call me maybe' },
      { ...valid, name: 'A' },
      { ...valid, company: 'x'.repeat(201) },
      { ...valid, company: 'Rao\r\nBcc: victim@example.com' },
      { ...valid, volume: 'A million' },
      { ...valid, website: 'x'.repeat(201) },
      { ...valid, extra: 'field' },
    ])
      expect(accessRequestSchema.safeParse(bad).success).toBe(false)
  })
})

describe('LeadsService', () => {
  it('stores the lead and its outbox event together, logging only ids', async () => {
    const s = service()
    await s.asIp('203.0.113.7', () => s.leads.submit(valid))
    expect(s.rows).toHaveLength(1)
    expect(s.events).toEqual([
      { type: 'leads.access_request.submitted', payload: { accessRequestId: s.rows[0]!.id } },
    ])
    const logs = s.lines.join('\n')
    expect(logs).toContain(String(s.rows[0]!.id))
    for (const pii of [valid.name, valid.company, valid.email, valid.phone, '203.0.113.7'])
      expect(logs).not.toContain(pii)
  })

  it('drops a filled honeypot silently: no row, no event, no personal data logged', async () => {
    const s = service()
    await s.asIp('203.0.113.8', () => s.leads.submit({ ...valid, website: 'spam.example' }))
    expect(s.rows).toHaveLength(0)
    expect(s.events).toHaveLength(0)
    expect(s.lines.join('\n')).not.toContain(valid.email)
  })

  it('allows 5 requests per IP per hour, then answers 429 without storing', async () => {
    const s = service()
    expect(ACCESS_REQUEST_LIMITS.perIpPerHour).toBe(5)
    for (let i = 0; i < 5; i++) await s.asIp('198.51.100.1', () => s.leads.submit(valid))
    await expect(s.asIp('198.51.100.1', () => s.leads.submit(valid))).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
    })
    expect(s.rows).toHaveLength(5)
    // Another IP is unaffected; the rule is per IP with a one-hour window.
    await s.asIp('198.51.100.2', () => s.leads.submit(valid))
    expect(s.rows).toHaveLength(6)
    expect(s.rules).toContainEqual({
      bucket: 'access-request:ip',
      key: '198.51.100.1',
      limit: 5,
      windowSeconds: 3600,
    })
  })

  it('counts honeypot hits against the limit too', async () => {
    const s = service()
    for (let i = 0; i < 5; i++)
      await s.asIp('198.51.100.9', () => s.leads.submit({ ...valid, website: 'bot' }))
    await expect(s.asIp('198.51.100.9', () => s.leads.submit(valid))).rejects.toMatchObject({
      status: 429,
    })
  })
})

describe('CORS for the public route', () => {
  const delegate = corsOptionsFor(APP, SITE)
  const optionsFor = (path: string) =>
    new Promise<Record<string, unknown>>((resolve) =>
      delegate({ path } as never, (_e, o) => resolve(o as Record<string, unknown>)),
    )

  it('allows only the marketing origins, without credentials, on /api/v1/public/*', async () => {
    const o = await optionsFor('/api/v1/public/request-access')
    expect(o.origin).toEqual(SITE)
    expect(o.credentials).toBe(false)
    expect(o.methods).toEqual(['POST'])
  })

  it('keeps every other route on the app origin only', async () => {
    for (const path of ['/api/v1/auth/login', '/api/v1/platform/access-requests', '/api/v1/me']) {
      const o = await optionsFor(path)
      expect(o.origin).toBe(APP)
      expect(o.credentials).toBe(true)
    }
  })
})

describe('CSRF guard origin rules', () => {
  const guard = (publicSite: boolean) => {
    const reflector = new Reflector()
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) =>
      key === PUBLIC_SITE_KEY ? publicSite : undefined,
    )
    return new CsrfGuard(reflector, {
      webOrigin: APP,
      publicSiteOrigins: SITE,
    } as CoreConfig)
  }
  const ctx = (origin: string | undefined, path = '/api/v1/public/request-access') =>
    ({
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'POST',
          path,
          cookies: {},
          header: (h: string) => (h === 'origin' ? origin : undefined),
        }),
      }),
    }) as unknown as ExecutionContext

  it('accepts fenwira.com, www and no Origin on the public route', () => {
    for (const o of [...SITE, undefined]) expect(guard(true).canActivate(ctx(o))).toBe(true)
  })

  it('rejects any other origin on the public route, including the app itself', () => {
    for (const o of ['https://evil.example', APP, 'https://fenwira.com.evil.example'])
      expect(() => guard(true).canActivate(ctx(o))).toThrow(AppError)
  })

  it('still rejects marketing origins on ordinary routes', () => {
    expect(() => guard(false).canActivate(ctx(SITE[0], '/api/v1/auth/login'))).toThrow(AppError)
  })
})

describe('LeadsProcessor', () => {
  async function run(outcome: 'SENT' | 'FAILED' | 'SKIPPED_NO_SMTP') {
    const d = fakeDb()
    d.rows.push({ id: '0192a8f0-0000-7000-8000-000000000001', status: 'QUEUED', ...valid })
    const send = vi.fn(async () => outcome)
    const p = new LeadsProcessor(
      d.db as never,
      { teamEmail: 'fenwira@zenteqk.com', webOrigin: APP },
      { send } as unknown as Mailer,
    )
    const job = {
      data: { payload: { accessRequestId: '0192a8f0-0000-7000-8000-000000000001' } },
    } as Job<never>
    await p.process(job)
    return { send, row: d.rows[0]!, again: () => p.process(job) }
  }

  it('emails the team with Reply-To set to the visitor', async () => {
    const { send, row } = await run('SENT')
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'fenwira@zenteqk.com', replyTo: valid.email }),
      'access_request',
    )
    expect(row.status).toBe('EMAILED')
  })

  it('fails soft: a failed or skipped email keeps the lead with its outcome', async () => {
    expect((await run('FAILED')).row).toMatchObject({
      status: 'EMAIL_FAILED',
      emailErrorCode: 'FAILED',
    })
    expect((await run('SKIPPED_NO_SMTP')).row.status).toBe('EMAIL_SKIPPED')
  })

  it('is safe to run twice: an emailed lead is not sent again', async () => {
    const r = await run('SENT')
    await r.again()
    expect(r.send).toHaveBeenCalledTimes(1)
  })
})
