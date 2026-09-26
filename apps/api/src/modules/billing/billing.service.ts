import { type Wallet } from '@fenwira/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { currentTenant } from '../tenancy'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import { billingEnforcedFor, lockWallet, toWallet } from './wallet.core'

@Injectable()
export class BillingService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(BILLING_OPTIONS) private readonly options: BillingOptions,
  ) {}

  /** Balance, holds and whether this tenant's sends are enforced (its billing mode, P9-D1). */
  wallet(): Promise<Wallet> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const w = await lockWallet(tx, tenantId, this.options)
      const t = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { billingMode: true },
      })
      return toWallet(w, await billingEnforcedFor(tx, tenantId, this.options), t.billingMode)
    })
  }
}
