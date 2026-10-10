import { type BillingPlatform } from '../billing'

/** Campaign engine settings (docs/CAMPAIGN_ENGINE.md). */
export type CampaignsOptions = {
  /** B3/B4 + P9-D1 billing platform (the Review shows available funds; resume checks them). */
  billing: BillingPlatform
  /** Recipients per dispatch batch. Default 50. */
  batchSize?: number
  /** Concurrent MessagingService sends within a batch. Default 10. */
  parallelSends?: number
  /** Contacts per snapshot page. Default 1,000. */
  snapshotPageSize?: number
}
export const CAMPAIGNS_OPTIONS = Symbol('CAMPAIGNS_OPTIONS')
