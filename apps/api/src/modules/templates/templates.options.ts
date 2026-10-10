import { type KeyRing } from '@fenwira/config'

/** Meta config the templates module needs (docs/TEMPLATE_ENGINE.md). */
export type TemplatesOptions = {
  keyRing: KeyRing
  /** The Meta app id: resumable uploads (header samples) are addressed to it. */
  appId?: string
  graphVersion: string
  graphBaseUrl: string
  /** Worker only: how stale a WABA's templates may get before the sync job refreshes them. */
  syncIntervalHours?: number
}

export const TEMPLATES_OPTIONS = Symbol('TEMPLATES_OPTIONS')
export const TEMPLATES_GRAPH = Symbol('TEMPLATES_GRAPH')
