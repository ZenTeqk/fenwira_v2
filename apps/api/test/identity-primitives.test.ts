import { describe, expect, it } from 'vitest'
import { JwtService } from '../src/modules/identity/jwt.service'
import { PasswordService } from '../src/modules/identity/password.service'
import {
  base32Decode,
  base32Encode,
  generateBackupCodes,
  otpauthUri,
  totpAt,
  verifyTotp,
} from '../src/modules/identity/totp'

const opts = {
  cookies: { secure: false },
  keyRing: undefined as never,
  webOrigin: 'http://localhost:3000',
}

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 Appendix B, SHA-1 secret "12345678901234567890"; the 6-digit codes are the last 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC vector at t=%i', (t, code) => {
    expect(totpAt(secret, Math.floor(t / 30))).toBe(code)
  })

  it('round-trips base32', () => {
    const bytes = Buffer.from('any bytes \x00\xff here')
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true)
  })

  it('accepts ±1 step and returns the matched step, rejects others', () => {
    const now = 1_700_000_000_000
    const step = Math.floor(now / 1000 / 30)
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1)
    expect(verifyTotp(secret, totpAt(secret, step + 1), now)).toBe(step + 1)
    expect(verifyTotp(secret, totpAt(secret, step + 3), now)).toBeNull()
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull()
  })

  it('builds an otpauth URI and unambiguous backup codes', () => {
    expect(otpauthUri('ABC', 'priya@example.com')).toBe(
      'otpauth://totp/Fenwira%3Apriya%40example.com?secret=ABC&issuer=Fenwira&algorithm=SHA1&digits=6&period=30',
    )
    const codes = generateBackupCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/)
  })
})

describe('JwtService (EdDSA)', () => {
  const jwt = new JwtService(opts)

  it('signs and verifies access tokens', () => {
    const token = jwt.signAccess(
      '0192a8f0-0000-7000-8000-000000000001',
      '0192a8f0-0000-7000-8000-000000000002',
    )
    expect(jwt.verifyAccess(token)).toMatchObject({
      sub: '0192a8f0-0000-7000-8000-000000000001',
      sid: '0192a8f0-0000-7000-8000-000000000002',
    })
  })

  it('rejects tampered, expired and foreign-key tokens', () => {
    const token = jwt.signAccess('u', 's')
    const [h, , s] = token.split('.')
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: 'admin', sid: 's', exp: 9e9 })).toString('base64url')}.${s}`
    expect(jwt.verifyAccess(forged)).toBeNull()
    expect(
      jwt.verifyAccess(jwt.signAccess('u', 's', Math.floor(Date.now() / 1000) - 3600)),
    ).toBeNull()
    expect(new JwtService(opts).verifyAccess(token)).toBeNull()
    expect(jwt.verifyAccess('not.a.jwt')).toBeNull()
  })

  it('never accepts an MFA challenge as an access token (or vice versa)', () => {
    const challenge = jwt.signChallenge('u', 'jti-1')
    expect(jwt.verifyAccess(challenge)).toBeNull()
    expect(jwt.verifyChallenge(challenge)).toMatchObject({ sub: 'u', jti: 'jti-1', purpose: 'mfa' })
    expect(jwt.verifyChallenge(jwt.signAccess('u', 's'))).toBeNull()
  })
})

describe('PasswordService', () => {
  it('rejects breached passwords from the bundled list and hashes with Argon2id', async () => {
    const passwords = new PasswordService()
    await passwords.onModuleInit()
    expect(passwords.isBreached('password123')).toBe(true)
    expect(passwords.isBreached('Password123')).toBe(true)
    expect(passwords.isBreached('correct horse battery staple fenwira')).toBe(false)
    const hash = await passwords.hash('a-long-unique-passphrase')
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true)
    expect(await passwords.verify(hash, 'a-long-unique-passphrase')).toBe(true)
    expect(await passwords.verify(hash, 'wrong')).toBe(false)
    expect(await passwords.verify(null, 'anything')).toBe(false) // dummy hash for unknown users
  })
})
