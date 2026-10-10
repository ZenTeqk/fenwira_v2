import { type KeyRing } from '@fenwira/config'
import { type CookieSettings } from '../../core/security/cookies'

export type IdentityOptions = {
  /** Base64 PEM Ed25519 keys; generated per process when absent (non-production only). */
  jwtPrivateKey?: string
  jwtPublicKey?: string
  cookies: CookieSettings
  keyRing: KeyRing
  webOrigin: string
}

export const IDENTITY_OPTIONS = Symbol('IDENTITY_OPTIONS')
