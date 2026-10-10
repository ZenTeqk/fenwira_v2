import { type KeyRing } from '@fenwira/config'

export type WebhooksOptions = {
  /** Secret encryption (the same ring used for Meta tokens); AES-256-GCM. */
  keyRing: KeyRing
  /** Host names allowed over http:/private addresses in development (local test receivers). */
  devHosts?: readonly string[]
  backoffMs: number
  maxRetryHours: number
  disableAfterFailures: number
}
export const WEBHOOKS_OPTIONS = Symbol('WEBHOOKS_OPTIONS')
