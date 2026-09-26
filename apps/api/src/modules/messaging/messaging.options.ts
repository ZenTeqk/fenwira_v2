import { type KeyRing } from '@fenwira/config'
import { type BillingPlatform } from '../billing'

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
  /** B3/B4 + P9-D1: platform billing switch and trial credit; tenants' billing modes decide. */
  billing?: BillingPlatform
}

export const MESSAGING_OPTIONS = Symbol('MESSAGING_OPTIONS')
