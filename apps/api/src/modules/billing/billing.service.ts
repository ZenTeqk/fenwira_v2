import { type Wallet } from '@fenwira/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import { lockWallet, toWallet } from './wallet.core'
import { currentTenant } from '../tenancy'

@Injectable()
export class BillingService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(BILLING_OPTIONS) private readonly options: BillingOptions,
  ) {}

  wallet(): Promise<Wallet> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) =>
      toWallet(await lockWallet(tx, tenantId), this.options.enforced),
    )
  }
}
