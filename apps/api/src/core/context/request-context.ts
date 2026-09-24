import { AsyncLocalStorage } from 'node:async_hooks'

import { type Permission, type Role } from '@fenwira/contracts'

/** Authenticated caller, set by AuthGuard. */
export type AuthContext = { userId: string; sessionId: string }

/** Active tenant for the request, set by TenantGuard after verifying membership. */
export type TenantContext = {
  tenantId: string
  membershipId: string
  role: Role
  permissions: readonly Permission[]
}

/**
 * Per-request / per-job context. The logger mixin reads correlationId/tenantId/userId; guards fill
 * `auth` and `tenant`; services read them instead of taking ids as arguments (MULTI_TENANCY.md).
 */
export type RequestContext = {
  correlationId: string
  tenantId?: string | null
  userId?: string
  jobId?: string
  queue?: string
  ip?: string
  userAgent?: string
  auth?: AuthContext
  tenant?: TenantContext
}

const storage = new AsyncLocalStorage<RequestContext>()

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn)
  },
  get(): RequestContext | undefined {
    return storage.getStore()
  },
  correlationId(): string | undefined {
    return storage.getStore()?.correlationId
  },
  /** Mutates the current store (guards enrich the context as the request is authorized). */
  patch(fields: Partial<RequestContext>): void {
    const store = storage.getStore()
    if (store) Object.assign(store, fields)
  },
}
