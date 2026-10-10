import { API_KEY_TOKEN_RE } from '@fenwira/contracts'
import { randomBytes, randomInt } from 'node:crypto'
import { sha256 } from '@fenwira/config'

const PREFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** An 8-char prefix (the key's public, non-secret identity; shown in lists and audit trails). */
function randomPrefix(): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += PREFIX_ALPHABET[randomInt(PREFIX_ALPHABET.length)]
  return out
}

/** A fresh `fw_<prefix>_<secret>` token. 256 bits of secret entropy. */
export function generateApiKeyToken(): { prefix: string; secret: string; token: string } {
  const prefix = randomPrefix()
  const secret = randomBytes(32).toString('base64url')
  return { prefix, secret, token: `fw_${prefix}_${secret}` }
}

/** Parses `fw_<prefix>_<secret>`; null when the token doesn't even look like one. */
export function parseApiKeyToken(token: string): { prefix: string; secret: string } | null {
  const m = API_KEY_TOKEN_RE.exec(token)
  return m ? { prefix: m[1]!, secret: m[2]! } : null
}

/**
 * The stored hash: sha256(pepper + secret). The pepper is a server-side secret never persisted
 * anywhere, so a leaked `key_hash` column alone can never be brute-forced offline (docs/API_KEYS.md
 * → Storage).
 */
export function hashApiKeySecret(pepper: string, secret: string): Uint8Array<ArrayBuffer> {
  return sha256(`${pepper}:${secret}`)
}
