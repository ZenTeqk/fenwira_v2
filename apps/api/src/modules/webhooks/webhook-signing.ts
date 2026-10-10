import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Outbound webhook signing (docs/WEBHOOKS.md → Signing). The signed string is
 * `{timestampMs}.{rawBody}`, so the timestamp itself is authenticated (replay protection):
 * an attacker who captured one delivery can't replay it with a forged, later timestamp without
 * also forging the signature. Receivers verify the signature and then reject stale timestamps.
 */
export function signWebhookBody(secret: string, timestampMs: string, rawBody: string): string {
  const digest = createHmac('sha256', secret).update(`${timestampMs}.${rawBody}`).digest('hex')
  return `sha256=${digest}`
}

export function verifyWebhookSignature(
  secret: string,
  timestampMs: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signWebhookBody(secret, timestampMs, rawBody))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** `whsec_<32 random bytes>`, shown once at creation or rotation (docs/WEBHOOKS.md → Storage). */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`
}
