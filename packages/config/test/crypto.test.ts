import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ciphertextKeyId,
  decryptSecret,
  encryptSecret,
  parseKeyRing,
  randomToken,
  safeEqual,
  sha256,
} from '../src/crypto'

const k = (_n: number) => randomBytes(32).toString('base64')

describe('secret encryption', () => {
  const k1 = k(1)
  const k2 = k(2)

  it('round-trips and never contains the plaintext', () => {
    const ring = parseKeyRing(`k1:${k1}`, 'k1')
    const ct = encryptSecret(ring, 'JBSWY3DPEHPK3PXP')
    expect(Buffer.from(ct).toString()).not.toContain('JBSWY3DPEHPK3PXP')
    expect(decryptSecret(ring, ct)).toBe('JBSWY3DPEHPK3PXP')
  })

  it('uses a fresh IV every time', () => {
    const ring = parseKeyRing(`k1:${k1}`, 'k1')
    expect(
      Buffer.from(encryptSecret(ring, 'same')).equals(Buffer.from(encryptSecret(ring, 'same'))),
    ).toBe(false)
  })

  it('decrypts old ciphertext after key rotation', () => {
    const old = encryptSecret(parseKeyRing(`k1:${k1}`, 'k1'), 'secret')
    const rotated = parseKeyRing(`k1:${k1},k2:${k2}`, 'k2')
    expect(decryptSecret(rotated, old)).toBe('secret')
    expect(ciphertextKeyId(encryptSecret(rotated, 'x'))).toBe('k2')
  })

  it('rejects tampered ciphertext (GCM authentication)', () => {
    const ring = parseKeyRing(`k1:${k1}`, 'k1')
    const parts = Buffer.from(encryptSecret(ring, 'secret')).toString().split('.')
    parts[4] = Buffer.from('tampered!').toString('base64url')
    expect(() => decryptSecret(ring, Buffer.from(parts.join('.')))).toThrow()
  })

  it('validates key configuration', () => {
    expect(() => parseKeyRing('k1:c2hvcnQ=', 'k1')).toThrow(/32 bytes/)
    expect(() => parseKeyRing(`k1:${k1}`, 'k2')).toThrow(/not in ENCRYPTION_KEYS/)
  })
})

describe('hashing helpers', () => {
  it('produces 256-bit url-safe tokens and stable hashes', () => {
    const t = randomToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(sha256(t)).equals(Buffer.from(sha256(t)))).toBe(true)
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})
