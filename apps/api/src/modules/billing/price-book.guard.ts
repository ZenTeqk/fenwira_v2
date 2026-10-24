import { Database } from '@fenwira/database'
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'

/**
 * The price book holds unapproved placeholder prices (docs/BILLING.md → Price book). Charging
 * wallets with them would bill customers made-up amounts, so the api and worker refuse to start
 * with BILLING_ENFORCED=true while any active entry is still a placeholder. Production only:
 * the integration suites exercise enforcement against the seeded placeholder prices.
 */
@Injectable()
export class PriceBookGuard implements OnApplicationBootstrap {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(BILLING_OPTIONS) private readonly options: BillingOptions,
    @Inject(CORE_CONFIG) private readonly core: CoreConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.enforced || this.core.nodeEnv !== 'production') return
    const now = new Date()
    const unapproved = await this.db.withGlobal((tx) =>
      tx.priceBookEntry.count({
        where: {
          isPlaceholder: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
      }),
    )
    if (unapproved > 0)
      throw new Error(
        `BILLING_ENFORCED=true but ${unapproved} active price book entr${unapproved === 1 ? 'y is' : 'ies are'} unapproved placeholders. Approve real prices first (docs/BILLING.md → Price book).`,
      )
  }
}
