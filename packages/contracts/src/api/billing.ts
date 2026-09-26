import { z } from 'zod'

/** Wallet summary (docs/BILLING.md → Balance enforcement, Reservations). Minor units. */
export const walletSchema = z.object({
  currency: z.string(),
  balanceMinor: z.number().int(),
  creditLimitMinor: z.number().int(),
  reservedMinor: z.number().int(),
  availableMinor: z.number().int(),
  /** Whether billable sends reserve funds yet (BILLING_ENFORCED). */
  enforced: z.boolean(),
  /** P9-D1: FREE (never enforced), TRIAL (trial credits), PREPAID. */
  billingMode: z.enum(['FREE', 'TRIAL', 'PREPAID']),
})
export type Wallet = z.infer<typeof walletSchema>
