/** Campaign engine settings (docs/CAMPAIGN_ENGINE.md). */
export type CampaignsOptions = {
  /** B3/B4 enforcement (the Review shows available funds; resume checks them). */
  billingEnforced: boolean
  /** Recipients per dispatch batch. Default 50. */
  batchSize?: number
  /** Concurrent MessagingService sends within a batch. Default 10. */
  parallelSends?: number
  /** Contacts per snapshot page. Default 1,000. */
  snapshotPageSize?: number
}
export const CAMPAIGNS_OPTIONS = Symbol('CAMPAIGNS_OPTIONS')
