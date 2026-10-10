import { createHmac, randomBytes } from 'node:crypto'

/** RFC 6238 TOTP: SHA-1, 6 digits, 30 s step, ±1 step tolerance (docs/SECURITY.md → 2FA). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30

export function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char)
    if (idx === -1) throw new Error('Invalid base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20))

export function totpAt(secret: string, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secret)).update(msg).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return code.toString().padStart(6, '0')
}

/** Returns the matched time step (so callers can reject replays of the same step), or null. */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs = Date.now(),
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS)
  for (let drift = -window; drift <= window; drift++) {
    if (totpAt(secret, counter + drift) === code) return counter + drift
  }
  return null
}

export function otpauthUri(secret: string, account: string, issuer = 'Fenwira'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}

/** 10 single-use backup codes, `xxxxx-xxxxx` from an unambiguous alphabet. */
export function generateBackupCodes(count = 10): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(10)
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
    return `${chars.slice(0, 5)}-${chars.slice(5)}`
  })
}
