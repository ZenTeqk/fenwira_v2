/** Analytics projection settings (docs/ANALYTICS.md → Freshness). */
export type AnalyticsOptions = {
  /**
   * A recompute mark waits this long before it is processed, so the other consumers of the same
   * event (campaign recipient status, billing settlement) have updated the source rows first.
   */
  settleSeconds: number
}
export const ANALYTICS_OPTIONS = Symbol('ANALYTICS_OPTIONS')
export const DEFAULT_ANALYTICS_OPTIONS: AnalyticsOptions = { settleSeconds: 20 }
