import { AsyncLocalStorage } from 'node:async_hooks'

/** Per-request / per-job context read by the logger mixin and (from Phase 3) the tenant layer. */
export type RequestContext = {
  correlationId: string
  tenantId?: string | null
  userId?: string
  jobId?: string
  queue?: string
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
}
