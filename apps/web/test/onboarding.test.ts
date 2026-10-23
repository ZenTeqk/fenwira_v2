import { describe, expect, it } from 'vitest'
import { ownerWelcomeMessage } from '../lib/onboarding'

const base = {
  ownerName: 'Asha Rao',
  workspaceName: 'Rao Retail',
  setupLink: 'https://app.fenwira.com/reset-password?token=abc&setup=1',
  setupExpiresAt: '2026-10-26T10:00:00.000Z',
  appOrigin: 'https://app.fenwira.com',
}

describe('ownerWelcomeMessage', () => {
  it('includes the setup link, its expiry, the app URL and three steps', () => {
    const m = ownerWelcomeMessage(base)
    expect(m).toContain('Hi Asha, welcome to Fenwira!')
    expect(m).toContain('"Rao Retail"')
    expect(m).toContain(base.setupLink)
    expect(m).toContain('Mon, 26 Oct 2026 10:00:00 UTC')
    expect(m).toContain('https://app.fenwira.com/login')
    for (const step of ['1. ', '2. ', '3. ']) expect(m).toContain(step)
  })

  it('tells an existing account holder to sign in instead', () => {
    const m = ownerWelcomeMessage({ ...base, setupLink: null, setupExpiresAt: null })
    expect(m).not.toContain('reset-password')
    expect(m).toContain(
      '1. Sign in with your existing Fenwira password at https://app.fenwira.com/login',
    )
  })
})
