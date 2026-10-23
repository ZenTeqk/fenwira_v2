import { z } from 'zod'

/**
 * Wallet state (decision P11-D12), computed by the backend from available funds and the
 * configured threshold (`billing.low_balance_threshold`). The UI renders it; it never compares
 * amounts itself. NOT_ENFORCED: billable sends don't reserve funds for this workspace.
 */
export const WALLET_STATES = [
  'NORMAL',
  'LOW_BALANCE',
  'INSUFFICIENT_FUNDS',
  'NOT_ENFORCED',
] as const
export const walletStateSchema = z.enum(WALLET_STATES)
export type WalletState = z.infer<typeof walletStateSchema>

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
  state: walletStateSchema,
  /** The threshold the state was computed with (P11-D12), for display only. */
  lowBalanceThresholdMinor: z.number().int(),
  /** Usage debits this calendar month (UTC), as a positive amount. */
  spentThisMonthMinor: z.number().int(),
  /** P11-D20: configured billing contact; both null → show the "Contact Fenwira" fallback. */
  support: z.object({ email: z.string().nullable(), url: z.string().nullable() }),
})
export type Wallet = z.infer<typeof walletSchema>

export const WALLET_TRANSACTION_TYPES = ['CREDIT', 'DEBIT', 'ADJUSTMENT', 'REFUND'] as const
export const FUND_TYPES = ['PAID', 'PROMOTIONAL'] as const

/** One ledger row (append-only). `amountMinor` is signed: debits are negative. */
export const walletTransactionSchema = z.object({
  id: z.uuid(),
  type: z.enum(WALLET_TRANSACTION_TYPES),
  fundType: z.enum(FUND_TYPES),
  amountMinor: z.number().int(),
  balanceAfterMinor: z.number().int(),
  currency: z.string(),
  reason: z.string(),
  referenceType: z.string().nullable(),
  referenceId: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type WalletTransaction = z.infer<typeof walletTransactionSchema>

/** A date (whole UTC day) or an ISO timestamp. */
const isoDateOrTime = z.iso.datetime({ offset: true }).or(z.iso.date())

export const walletTransactionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  type: z.enum(WALLET_TRANSACTION_TYPES).optional(),
  /** Inclusive. */
  from: isoDateOrTime.optional(),
  /** Inclusive; a date means the whole day. */
  to: isoDateOrTime.optional(),
})
export type WalletTransactionsQuery = z.infer<typeof walletTransactionsQuerySchema>

/**
 * Workspace status for the shell and dashboard (docs/plans/PHASE_11_PLAN.md §2.3). Every member
 * gets the wallet state; amounts only with `billing.read`.
 */
export const workspaceStatusSchema = z.object({
  /** Phase 11 Step 4: for the shell's trial/expired banner. Independent of the wallet. */
  subscription: z
    .object({
      status: z.enum(['TRIALING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'PAST_DUE', 'SUSPENDED']),
      /** ML-D2 manual billing: an open renewal invoice; `paymentDue` = shown as "Payment due". */
      paymentDue: z.boolean().optional(),
      graceEndsAt: z.string().nullable().optional(),
      trialEndsAt: z.string().nullable(),
      trialDaysLeft: z.number().int().nullable(),
    })
    .optional(),
  wallet: z.object({
    state: walletStateSchema,
    currency: z.string(),
    availableMinor: z.number().int().nullable(),
  }),
})
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>
