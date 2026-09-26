import { type KeyRing } from '@fenwira/config'

export const AUTOMATION_OPTIONS = Symbol('AUTOMATION_OPTIONS')

export type AutomationOptions = {
  /** Encrypts inbound-webhook HMAC secrets (API side). */
  keyRing?: KeyRing
  /** Base URL shown for inbound webhook triggers, e.g. https://api.example.com. */
  publicApiUrl?: string
  /** P10-D4 development exception for the webhook action (worker side; empty in production). */
  webhookDevHosts?: readonly string[]
}
