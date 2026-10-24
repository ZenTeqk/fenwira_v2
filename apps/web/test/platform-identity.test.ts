import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api/client'
import {
  identityLeft,
  needsIdentity,
  verificationFailure,
  verifyIdentity,
  withIdentity,
} from '../lib/platform-identity'

const lapsed = () => new ApiError(403, 'TOTP_REQUIRED', 'Fresh MFA required.')

describe('withIdentity', () => {
  it('opens verification on a lapsed check and retries the action once', async () => {
    const action = vi.fn().mockRejectedValueOnce(lapsed()).mockResolvedValueOnce('done')
    const verify = vi.fn().mockResolvedValue(true)
    await expect(withIdentity(action, verify)).resolves.toBe('done')
    expect(verify).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('retries only once even if the check lapses again', async () => {
    const action = vi.fn().mockRejectedValue(lapsed())
    const verify = vi.fn().mockResolvedValue(true)
    await expect(withIdentity(action, verify)).rejects.toSatisfy(needsIdentity)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('does not retry when verification is cancelled', async () => {
    const action = vi.fn().mockRejectedValue(lapsed())
    const verify = vi.fn().mockResolvedValue(false)
    await expect(withIdentity(action, verify)).rejects.toSatisfy(needsIdentity)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('never asks for verification on other errors', async () => {
    const action = vi.fn().mockRejectedValue(new ApiError(400, 'VALIDATION_FAILED', 'Bad.'))
    const verify = vi.fn()
    await expect(withIdentity(action, verify)).rejects.toBeInstanceOf(ApiError)
    expect(verify).not.toHaveBeenCalled()
  })
})

describe('verifyIdentity', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends password and code once and neither stores nor logs them', async () => {
    const password = 'Operator-Secret-Pw-1',
      code = '123456'
    const stored: string[] = []
    const storage = { setItem: (k: string, v: string) => stored.push(k, v) }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)
    const dispatched = vi.fn()
    vi.stubGlobal('window', { dispatchEvent: dispatched })
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    )
    const me = {
      operatorId: '01a16d47-2b7c-707d-89ae-74fc47f8ace3',
      permissions: [],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      mfaFreshUntil: new Date(Date.now() + 300_000).toISOString(),
      csrfToken: 'csrf',
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: me }))
    vi.stubGlobal('fetch', fetch)
    await expect(verifyIdentity(password, code)).resolves.toMatchObject({
      mfaFreshUntil: me.mfaFreshUntil,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ password, code })
    expect(String(fetch.mock.calls[1]![1].body ?? '')).not.toContain(password)
    expect(stored).toEqual([])
    for (const log of logs) expect(log).not.toHaveBeenCalled()
    expect(dispatched).not.toHaveBeenCalled()
  })

  it('a wrong code keeps the operator signed in', async () => {
    const dispatched = vi.fn()
    vi.stubGlobal('window', { dispatchEvent: dispatched })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: 'INVALID_CODE', message: 'Enter a fresh authenticator code.' } },
            { status: 401 },
          ),
        ),
    )
    const err = await verifyIdentity('pw-123456', '000000').catch((e: unknown) => e)
    expect(verificationFailure(err)).toMatch(/not correct/)
    expect(dispatched).not.toHaveBeenCalled()
  })
})

describe('identityLeft', () => {
  it('counts down to zero', () => {
    const now = Date.now()
    expect(identityLeft(new Date(now + 90_000).toISOString(), now)).toBe(90_000)
    expect(identityLeft(new Date(now - 1).toISOString(), now)).toBe(0)
    expect(identityLeft(undefined, now)).toBe(0)
  })
})
