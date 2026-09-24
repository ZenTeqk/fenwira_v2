import { Database, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../context/request-context'

/**
 * The only way feature code reaches tenant data: a transaction bound to the tenant that
 * TenantGuard verified for this request (and the caller's user id). docs/MULTI_TENANCY.md.
 */
@Injectable()
export class TenantDb {
  constructor(@Inject(Database) private readonly db: Database) {}

  run<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    const ctx = requestContext.get()
    const tenantId = ctx?.tenant?.tenantId
    if (!tenantId) throw new Error('TenantDb used outside a tenant-scoped request')
    return this.db.withTenant(tenantId, fn, { userId: ctx.auth?.userId })
  }
}
