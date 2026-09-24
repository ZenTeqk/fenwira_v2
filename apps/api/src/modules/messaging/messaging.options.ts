import { type KeyRing } from '@fenwira/config'

export type MessagingOptions = {
  keyRing: KeyRing
  graphBaseUrl: string
  graphVersion: string
  /** API only: verifies X-Hub-Signature-256. Webhooks are refused (401) while unset. */
  appSecret?: string
  /** API only: GET /webhooks/whatsapp handshake. */
  verifyToken?: string
  /** Worker only: outbound retry base delay (2^attempt × base, ±20 %). Default 1000. */
  outboundBackoffBaseMs?: number
  /** Worker only: wait for a status webhook before resending an interrupted send. Default 60 s. */
  crashGraceMs?: number
}

export const MESSAGING_OPTIONS = Symbol('MESSAGING_OPTIONS')
