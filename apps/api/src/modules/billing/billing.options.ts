import { type BillingPlatform } from './wallet.core'

/** Billing platform configuration (docs/BILLING.md → Billing modes, P9-D1, P11-D12). */
export type BillingOptions = BillingPlatform & {
  /** Worker: minutes after which a final message's unsettled reservation is recovered. */
  reservationGraceMinutes?: number
}
export const BILLING_OPTIONS = Symbol('BILLING_OPTIONS')

/** The platform billing settings every module shares, from the validated environment. */
export function billingPlatformFromEnv(env: {
  BILLING_ENFORCED: boolean
  TRIAL_CREDIT_MINOR: number
  BILLING_LOW_BALANCE_THRESHOLD_MINOR: number
}): BillingPlatform {
  return {
    enforced: env.BILLING_ENFORCED,
    trialCreditMinor: env.TRIAL_CREDIT_MINOR,
    lowBalanceThresholdMinor: env.BILLING_LOW_BALANCE_THRESHOLD_MINOR,
  }
}
