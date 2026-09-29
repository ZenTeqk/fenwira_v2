import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Secret encryption (docs/SECURITY.md → Secret encryption): AES-256-GCM, 96-bit random IV,
 * ciphertext `v1.{kid}.{iv}.{tag}.{ct}` (base64url parts). Keys come from
 * ENCRYPTION_KEYS="k1:<base64 32 bytes>,k2:..." with ENCRYPTION_ACTIVE_KEY_ID naming the one used
 * for new ciphertext; old kids stay decryptable for rotation.
 */
export type KeyRing = { activeKeyId: string; keys: Map<string, Buffer> }

export function parseKeyRing(spec: string, activeKeyId: string): KeyRing {
  const keys = new Map<string, Buffer>()
  for (const part of spec
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const idx = part.indexOf(':')
    if (idx <= 0) throw new Error('ENCRYPTION_KEYS entries must look like "kid:base64key"')
    const kid = part.slice(0, idx)
    const key = Buffer.from(part.slice(idx + 1), 'base64')
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid)) throw new Error(`Invalid encryption key id "${kid}"`)
    if (key.length !== 32)
      throw new Error(`Encryption key "${kid}" must be 32 bytes (got ${key.length})`)
    keys.set(kid, key)
  }
  if (!keys.has(activeKeyId))
    throw new Error(`ENCRYPTION_ACTIVE_KEY_ID "${activeKeyId}" is not in ENCRYPTION_KEYS`)
  return { activeKeyId, keys }
}

export function encryptSecret(ring: KeyRing, plaintext: string): Uint8Array<ArrayBuffer> {
  const key = ring.keys.get(ring.activeKeyId)!
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const encoded = [
    'v1',
    ring.activeKeyId,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join('.')
  return Uint8Array.from(Buffer.from(encoded, 'utf8'))
}

export function decryptSecret(ring: KeyRing, ciphertext: Buffer | Uint8Array): string {
  const [version, kid, iv, tag, ct] = Buffer.from(ciphertext).toString('utf8').split('.')
  if (version !== 'v1' || !kid || !iv || !tag || ct === undefined)
    throw new Error('Unrecognized ciphertext format')
  const key = ring.keys.get(kid)
  if (!key) throw new Error(`No key for kid "${kid}"`)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString(
    'utf8',
  )
}

/** Key id a ciphertext was written with (for the re-encryption job). */
export function ciphertextKeyId(ciphertext: Buffer | Uint8Array): string | undefined {
  return Buffer.from(ciphertext).toString('utf8').split('.')[1]
}

/** Returns a plain-ArrayBuffer view (what Prisma `Bytes` columns expect). */
export const sha256 = (value: string | Buffer): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(createHash('sha256').update(value).digest())

/** URL-safe random token with `bytes` of entropy (default 32 = 256 bits). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')

export function safeEqual(
  a: string | Buffer | Uint8Array,
  b: string | Buffer | Uint8Array,
): boolean {
  const x = Buffer.isBuffer(a) ? a : Buffer.from(a)
  const y = Buffer.isBuffer(b) ? b : Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
