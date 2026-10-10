import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(app secret, raw body)). Verified on the raw
 * bytes (never re-serialized JSON) with a constant-time compare.
 */
export function signWebhookBody(appSecret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
}

export function verifyWebhookSignature(
  appSecret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header || !header.startsWith('sha256=')) return false
  const expected = Buffer.from(signWebhookBody(appSecret, rawBody))
  const given = Buffer.from(header)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
