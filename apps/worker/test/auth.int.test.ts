import { totpAt } from '@fenwira/api/modules/identity'
import { type INestApplication } from '@nestjs/common'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  bootApi,
  bootWorker,
  Client,
  emailCount,
  linkFromEmail,
  PASSWORD,
  tokenFrom,
  uniqueEmail,
} from './support/harness'
import { createOwner } from './support/workspace'

let api: INestApplication
let worker: INestApplication

beforeAll(async () => {
  api = await bootApi()
  worker = await bootWorker()
})
afterAll(async () => {
  await worker?.close()
  await api?.close()
})

const cookieValue = (res: { headers: Record<string, unknown> }, name: string) =>
  ((res.headers['set-cookie'] as string[] | undefined) ?? [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.split('=')[1]

describe('register → verify email → create workspace (PRD AU-1)', () => {
  it('runs the whole onboarding flow with the email delivered through Mailpit', async () => {
    const client = new Client(api)
    const email = uniqueEmail('onboard')
    const reg = await client.register(email, 'Priya Sharma')
    expect(reg.body.data.status).toBe('AUTHENTICATED')
    const cookies = (reg.headers['set-cookie'] as unknown as string[]).join('\n')
    expect(cookies).toMatch(/fw_at=.*HttpOnly.*SameSite=Lax/)
    expect(cookies).toMatch(/fw_rt=.*Path=\/api\/v1\/auth.*HttpOnly.*SameSite=Strict/)

    let me = await client.me()
    expect(me.body.data.user).toMatchObject({ email, name: 'Priya Sharma', emailVerified: false })
    expect(me.body.data.memberships).toEqual([])

    const blocked = await client.post('/tenants', { name: 'Too Early' })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('EMAIL_NOT_VERIFIED')

    const link = await linkFromEmail(email, '/verify-email')
    expect(link).toMatch(/^http:\/\/localhost:3000\/verify-email\?token=/)
    expect((await client.post('/auth/email/verify', { token: tokenFrom(link) })).status).toBe(204)
    // Single use.
    expect(
      (await client.post('/auth/email/verify', { token: tokenFrom(link) })).body.error.code,
    ).toBe('TOKEN_INVALID')

    const created = await client.post('/tenants', { name: 'Urban Leaf Home' })
    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({
      name: 'Urban Leaf Home',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    })

    me = await client.me()
    expect(me.body.data.user.emailVerified).toBe(true)
    expect(me.body.data.memberships).toEqual([
      expect.objectContaining({
        tenantId: created.body.data.id,
        tenantName: 'Urban Leaf Home',
        role: 'OWNER',
      }),
    ])
  })

  it('rejects duplicate emails, breached and short passwords', async () => {
    const email = uniqueEmail('dup')
    await new Client(api).register(email)
    const dup = await new Client(api).post('/auth/register', {
      name: 'x',
      email,
      password: PASSWORD,
    })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('EMAIL_TAKEN')
    const breached = await new Client(api).post('/auth/register', {
      name: 'x',
      email: uniqueEmail('b'),
      password: 'password123',
    })
    expect(breached.status).toBe(400)
    expect(breached.body.error.fieldErrors[0].code).toBe('breached')
    const short = await new Client(api).post('/auth/register', {
      name: 'x',
      email: uniqueEmail('s'),
      password: 'short',
    })
    expect(short.body.error.fieldErrors[0].path).toBe('password')
  })
})

describe('login, logout and sessions', () => {
  it('uses one generic error for unknown email and wrong password', async () => {
    const { email } = await createOwner(api, 'login')
    const wrong = await new Client(api).login(email, 'not-the-password!!')
    const unknown = await new Client(api).login(uniqueEmail('nobody'), 'not-the-password!!')
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401)
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        // The shared error copy (core/http/error-copy.ts) words it for both cases alike.
        message: 'The email or password is not correct.',
      })
    }
  })

  it('logs in, lists sessions, and logout ends the session immediately', async () => {
    const { email } = await createOwner(api, 'logout')
    const client = new Client(api)
    expect((await client.login(email)).status).toBe(200)
    const sessions = await client.get('/me/sessions')
    expect(sessions.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1)
    expect((await client.post('/auth/logout')).status).toBe(204)
    expect((await client.me()).status).toBe(401)
  })

  it('revoking another session kills its access token without waiting for expiry', async () => {
    const { email } = await createOwner(api, 'revoke')
    const laptop = new Client(api)
    const phone = new Client(api)
    await laptop.login(email)
    await phone.login(email)
    const phoneSession = (await phone.get('/me/sessions')).body.data.find(
      (s: { current: boolean }) => s.current,
    ).id
    expect((await laptop.delete(`/me/sessions/${phoneSession}`)).status).toBe(204)
    expect((await phone.me()).status).toBe(401) // Redis deny-set, not token expiry
    expect((await laptop.me()).status).toBe(200)
  })

  it('rotates the refresh token and revokes the whole family when a rotated token is reused', async () => {
    const { email } = await createOwner(api, 'rotate')
    const client = new Client(api)
    const login = await client.login(email)
    const firstRefresh = cookieValue(login, 'fw_rt')!

    const rotated = await client.post('/auth/refresh')
    expect(rotated.status).toBe(200)
    const secondRefresh = cookieValue(rotated, 'fw_rt')!
    expect(secondRefresh).not.toBe(firstRefresh)

    // Attacker replays the first (already rotated) token.
    const attacker = new Client(api)
    const replay = await attacker.agent
      .post('/api/v1/auth/refresh')
      .set('Cookie', `fw_rt=${firstRefresh}`)
    expect(replay.status).toBe(401)

    // The legitimate holder's newer token and access token are dead too.
    expect((await client.me()).status).toBe(401)
    const legit = await attacker.agent
      .post('/api/v1/auth/refresh')
      .set('Cookie', `fw_rt=${secondRefresh}`)
    expect(legit.status).toBe(401)

    const relogin = new Client(api)
    await relogin.login(email)
    const events = (await relogin.get('/me/security-events')).body.data.map(
      (e: { type: string }) => e.type,
    )
    expect(events).toContain('REFRESH_TOKEN_REUSE')
  })
})

describe('CSRF (double submit + Origin)', () => {
  it('requires X-CSRF-Token on cookie-authenticated mutations', async () => {
    const owner = await createOwner(api, 'csrf')
    const csrf = owner.client.csrf
    owner.client.csrf = ''
    const missing = await owner.client.patch('/me', { name: 'x' })
    expect(missing.status).toBe(403)
    expect(missing.body.error.code).toBe('CSRF_FAILED')
    const wrong = await owner.client.patch('/me', { name: 'x' }, { 'X-CSRF-Token': 'forged' })
    expect(wrong.body.error.code).toBe('CSRF_FAILED')
    owner.client.csrf = csrf
    expect((await owner.client.patch('/me', { name: 'Renamed' })).status).toBe(200)
  })

  it('rejects mutations from a foreign Origin even with a valid token', async () => {
    const owner = await createOwner(api, 'origin')
    const res = await owner.client.patch('/me', { name: 'x' }, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('CSRF_FAILED')
    const login = await new Client(api).post(
      '/auth/login',
      { email: owner.email, password: PASSWORD },
      { Origin: 'https://evil.example' },
    )
    expect(login.status).toBe(403)
  })

  it('/auth/me hands the CSRF token back after a reload', async () => {
    const owner = await createOwner(api, 'csrfme')
    const before = owner.client.csrf
    owner.client.csrf = ''
    const me = await owner.client.me()
    expect(me.body.data.csrfToken).toBe(before)
  })
})

describe('forgot / reset password (PRD AU-3)', () => {
  it('emails a single-use link, sets the new password and ends other sessions', async () => {
    const { email } = await createOwner(api, 'reset')
    const other = new Client(api)
    await other.login(email)
    expect((await new Client(api).post('/auth/password/forgot', { email })).status).toBe(202)
    const token = tokenFrom(await linkFromEmail(email, '/reset-password'))
    expect(
      (
        await new Client(api).post('/auth/password/reset', {
          token,
          password: 'a-brand-new-passphrase',
        })
      ).status,
    ).toBe(204)
    expect(
      (
        await new Client(api).post('/auth/password/reset', {
          token,
          password: 'another-new-passphrase',
        })
      ).body.error.code,
    ).toBe('TOKEN_INVALID')
    expect((await other.me()).status).toBe(401)
    expect((await new Client(api).login(email)).status).toBe(401)
    expect((await new Client(api).login(email, 'a-brand-new-passphrase')).status).toBe(200)
  })

  it('answers identically for unknown emails and sends nothing', async () => {
    const email = uniqueEmail('ghost')
    const res = await new Client(api).post('/auth/password/forgot', { email })
    expect(res.status).toBe(202)
    await new Promise((r) => setTimeout(r, 1000))
    expect(await emailCount(email)).toBe(0)
  })
})

describe('two-factor authentication (PRD AU-2)', () => {
  it('enrolls with TOTP, then requires a code at login; backup codes work once', async () => {
    const { email, client } = await createOwner(api, 'totp')
    const setup = await client.post('/me/2fa/setup')
    const secret: string = setup.body.data.secret
    expect(setup.body.data.otpauthUri).toContain('otpauth://totp/Fenwira')
    const step = Math.floor(Date.now() / 30_000)
    const enabled = await client.post('/me/2fa/enable', { code: totpAt(secret, step) })
    expect(enabled.status).toBe(200)
    const backupCodes: string[] = enabled.body.data.backupCodes
    expect(backupCodes).toHaveLength(10)

    const browser = new Client(api)
    const first = await browser.login(email)
    expect(first.status).toBe(202)
    expect(first.body.data.status).toBe('TOTP_REQUIRED')
    expect(first.headers['set-cookie']).toBeUndefined() // no session before the second factor
    const bad = await browser.post('/auth/2fa/verify', {
      challengeToken: first.body.data.challengeToken,
      code: '000000',
    })
    expect(bad.body.error.code).toBe('INVALID_CODE')
    const ok = await browser.post('/auth/2fa/verify', {
      challengeToken: first.body.data.challengeToken,
      code: totpAt(secret, step + 1),
    })
    expect(ok.status).toBe(200)
    browser.csrf = ok.body.data.csrfToken
    expect((await browser.me()).body.data.user.twoFactorEnabled).toBe(true)

    const second = await new Client(api).login(email)
    const withBackup = await new Client(api).post('/auth/2fa/verify', {
      challengeToken: second.body.data.challengeToken,
      code: backupCodes[0],
    })
    expect(withBackup.status).toBe(200)
    const third = await new Client(api).login(email)
    const reused = await new Client(api).post('/auth/2fa/verify', {
      challengeToken: third.body.data.challengeToken,
      code: backupCodes[0],
    })
    expect(reused.body.error.code).toBe('INVALID_CODE')
  })

  it('stores the TOTP secret encrypted, never in plaintext', async () => {
    const { client } = await createOwner(api, 'totpenc')
    const setup = await client.post('/me/2fa/setup')
    const { Database } = await import('@fenwira/database')
    const db = Database.connect({ url: process.env.DATABASE_URL! })
    try {
      const me = await client.me()
      const row = await db.withGlobal((tx) =>
        tx.twoFactorCredential.findUniqueOrThrow({ where: { userId: me.body.data.user.id } }),
      )
      const stored = Buffer.from(row.secretCiphertext).toString()
      expect(stored.startsWith('v1.k1.')).toBe(true)
      expect(stored).not.toContain(setup.body.data.secret)
    } finally {
      await db.disconnect()
    }
  })
})

describe('rate limits (docs/SECURITY.md)', () => {
  it('limits login attempts per email to 5 per minute with Retry-After', async () => {
    const email = uniqueEmail('ratelimit')
    const statuses: number[] = []
    let last
    for (let i = 0; i < 7; i++) {
      last = await new Client(api).post('/auth/login', { email, password: 'wrong-password-123' })
      statuses.push(last.status)
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(statuses.slice(5)).toEqual([429, 429])
    expect(last!.body.error.code).toBe('RATE_LIMITED')
    expect(Number(last!.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('limits password reset requests per email to 3 per hour', async () => {
    const email = uniqueEmail('forgotlimit')
    const statuses = []
    for (let i = 0; i < 4; i++)
      statuses.push((await new Client(api).post('/auth/password/forgot', { email })).status)
    expect(statuses).toEqual([202, 202, 202, 429])
  })
})
