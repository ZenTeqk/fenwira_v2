import { type BillingPlatform } from './wallet.core'

/** Billing platform configuration (docs/BILLING.md → Billing modes, P9-D1, P11-D12). */
/**
 * P11-D20 billing/support contact (`billing.support_email`, `billing.support_url`). Unset values
 * fall back to a non-clickable "Contact Fenwira" line; never hard-coded in components.
 */
export type BillingSupport = { email?: string; url?: string }

/**
 * ADR-0027 manual UPI billing (docs/BILLING.md → Manual invoices). `enabled` = Managed Launch
 * Mode: periods renew only when a renewal invoice is paid (ACTIVE → PAST_DUE → SUSPENDED).
 */
export type ManualBilling = {
  enabled: boolean
  graceDays: number
  leadDays: number
  payee?: { vpa: string; name: string }
  gst?: { gstin: string; rateBps: number }
}

export type BillingOptions = BillingPlatform & {
  support?: BillingSupport
  manual?: ManualBilling
  /** Worker: web origin for links in lifecycle emails. */
  webOrigin?: string
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

export function manualBillingFromEnv(env: {
  MANAGED_LAUNCH_MODE: boolean
  BILLING_GRACE_DAYS: number
  BILLING_INVOICE_LEAD_DAYS: number
  UPI_VPA?: string
  UPI_PAYEE_NAME?: string
  BILLING_GSTIN?: string
  BILLING_GST_RATE_BPS?: number
}): ManualBilling {
  return {
    enabled: env.MANAGED_LAUNCH_MODE,
    graceDays: env.BILLING_GRACE_DAYS,
    leadDays: env.BILLING_INVOICE_LEAD_DAYS,
    ...(env.UPI_VPA && env.UPI_PAYEE_NAME
      ? { payee: { vpa: env.UPI_VPA, name: env.UPI_PAYEE_NAME } }
      : {}),
    ...(env.BILLING_GSTIN && env.BILLING_GST_RATE_BPS
      ? { gst: { gstin: env.BILLING_GSTIN, rateBps: env.BILLING_GST_RATE_BPS } }
      : {}),
  }
}

export function billingSupportFromEnv(env: {
  BILLING_SUPPORT_EMAIL?: string
  BILLING_SUPPORT_URL?: string
}): BillingSupport {
  return {
    ...(env.BILLING_SUPPORT_EMAIL ? { email: env.BILLING_SUPPORT_EMAIL } : {}),
    ...(env.BILLING_SUPPORT_URL ? { url: env.BILLING_SUPPORT_URL } : {}),
  }
}
