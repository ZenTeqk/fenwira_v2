import { type KeyRing } from '@fenwira/config'

/** Platform-level Meta config from env (docs/META_INTEGRATION.md → Platform model). */
export type WhatsAppOptions = {
  keyRing: KeyRing
  appId?: string
  appSecret?: string
  configId?: string
  graphVersion: string
  graphBaseUrl: string
  /** API only: POST /whatsapp/connections/dev is enabled. */
  devConnect: boolean
  /** Worker only: how stale a number's data may get before the sync job refreshes it. */
  syncIntervalHours?: number
}

export const WHATSAPP_OPTIONS = Symbol('WHATSAPP_OPTIONS')
