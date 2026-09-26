import { type BillingPlatform } from './wallet.core'

/** Billing platform configuration (docs/BILLING.md → Billing modes, P9-D1). */
export type BillingOptions = BillingPlatform
export const BILLING_OPTIONS = Symbol('BILLING_OPTIONS')
