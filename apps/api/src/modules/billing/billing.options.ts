/** Billing switches (docs/BILLING.md → Balance enforcement). */
export type BillingOptions = {
  /** When true, billable sends reserve funds (B3/B4). Off until billing launches (see ROADMAP). */
  enforced: boolean
}
export const BILLING_OPTIONS = Symbol('BILLING_OPTIONS')
