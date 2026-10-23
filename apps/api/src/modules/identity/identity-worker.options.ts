import { type KeyRing } from '@fenwira/config'

export type IdentityWorkerOptions = { webOrigin: string; keyRing?: KeyRing }
export const IDENTITY_WORKER_OPTIONS = Symbol('IDENTITY_WORKER_OPTIONS')
