import { z } from 'zod'
export const PLATFORM_PERMISSIONS = [
  'commercial.read',
  'financial.read',
  'wallet.manage',
  'subscription.manage',
  'entitlements.manage',
  'audit.read',
] as const
export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number]
export const platformLoginSchema = z
  .object({ email: z.email().toLowerCase(), password: z.string().min(1).max(256) })
  .strict()
export const platformVerifySchema = z
  .object({ challengeToken: z.string().min(20).max(256), code: z.string().regex(/^\d{6}$/) })
  .strict()
export const platformReauthSchema = z
  .object({ password: z.string().min(1).max(256), code: z.string().regex(/^\d{6}$/) })
  .strict()
export const platformMeSchema = z.object({
  operatorId: z.uuid(),
  permissions: z.array(z.enum(PLATFORM_PERMISSIONS)),
  expiresAt: z.iso.datetime(),
  csrfToken: z.string(),
})
export type PlatformMe = z.infer<typeof platformMeSchema>

export const platformSearchSchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
export const platformWorkspaceIdentitySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.iso.datetime(),
})
export const commercialReceiptSchema = z.object({
  id: z.uuid(),
  tenantId: z.uuid(),
  operatorId: z.uuid(),
  operation: z.string(),
  amountMinor: z.string().nullable(),
  currency: z.string().nullable(),
  reason: z.string(),
  reference: z.string(),
  idempotencyKey: z.string(),
  requestHash: z.string(),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
  correlationId: z.string().nullable(),
  createdAt: z.iso.datetime(),
})
export type CommercialReceipt = z.infer<typeof commercialReceiptSchema>
export const commercialSnapshotSchema = z.object({
  workspace: platformWorkspaceIdentitySchema.extend({
    billingMode: z.enum(['FREE', 'TRIAL', 'PREPAID']),
  }),
  subscription: z
    .object({
      id: z.uuid(),
      status: z.string(),
      planId: z.uuid().nullable(),
      trialEndsAt: z.iso.datetime().nullable(),
      currentPeriodStart: z.iso.datetime().nullable(),
      currentPeriodEnd: z.iso.datetime().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      requestedPlanId: z.uuid().nullable(),
    })
    .nullable(),
  wallet: z
    .object({
      id: z.uuid(),
      currency: z.string(),
      balanceMinor: z.string(),
      reservedMinor: z.string(),
      creditLimitMinor: z.string(),
      availableMinor: z.string(),
    })
    .nullable(),
  overrides: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.boolean(), z.number(), z.null()]),
      reason: z.string(),
      expiresAt: z.iso.datetime().nullable(),
    }),
  ),
})
export type CommercialSnapshot = z.infer<typeof commercialSnapshotSchema>
export const platformWorkspaceSchema = z.object({
  snapshot: commercialSnapshotSchema,
  version: z.string(),
  subscriptionsEnforced: z.boolean(),
  plans: z.array(z.object({ id: z.uuid(), key: z.string(), name: z.string() })),
  entitlements: z.array(
    z.object({
      key: z.string(),
      configured: z.union([z.boolean(), z.number(), z.null()]),
      enforced: z.union([z.boolean(), z.number(), z.null()]),
      usage: z.number().nullable(),
      overLimit: z.boolean(),
    }),
  ),
  credits: z.array(z.object({ fundType: z.string(), grantedMinor: z.string() })),
  operations: z.array(commercialReceiptSchema),
  ledger: z.array(
    z.object({
      id: z.uuid(),
      type: z.string(),
      fundType: z.string(),
      amountMinor: z.string(),
      reason: z.string(),
      referenceId: z.string().nullable(),
      expiresAt: z.iso.datetime().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
  reconciliation: z.object({ balanceMatches: z.boolean(), reservationsMatch: z.boolean() }),
})
export type PlatformWorkspace = z.infer<typeof platformWorkspaceSchema>
export const platformFinancialSchema = z.object({
  currency: z.string(),
  customerChargeMinor: z.string(),
  providerCostMinor: z.string().nullable(),
  knownCostCustomerChargeMinor: z.string(),
  recordedContributionMinor: z.string().nullable(),
  messages: z.number(),
  costKnownMessages: z.number(),
  costProvenance: z.string(),
  taxMetadata: z.array(
    z.object({
      category: z.string(),
      taxCode: z.string().nullable(),
      taxBps: z.number().nullable(),
      isPlaceholder: z.boolean(),
    }),
  ),
})
export type PlatformFinancial = z.infer<typeof platformFinancialSchema>

const operationBase = z.object({
  reason: z.string().trim().min(5).max(500),
  reference: z.string().trim().min(1).max(120),
  idempotencyKey: z.string().min(8).max(128),
  expectedVersion: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
})
const moneyFields = { amountMinor: z.number().int().safe().positive(), currency: z.literal('INR') }
export const walletOperationSchema = z.discriminatedUnion('kind', [
  operationBase.extend({ kind: z.literal('paid_credit'), ...moneyFields }).strict(),
  operationBase
    .extend({
      kind: z.literal('promotional_credit'),
      ...moneyFields,
      expiresAt: z.iso.datetime().optional(),
    })
    .strict(),
  operationBase
    .extend({
      kind: z.literal('adjustment'),
      currency: z.literal('INR'),
      amountMinor: z
        .number()
        .int()
        .safe()
        .refine((v) => v !== 0, 'Amount cannot be zero'),
    })
    .strict(),
  operationBase.extend({ kind: z.literal('refund'), ...moneyFields, debitId: z.uuid() }).strict(),
])
export type WalletOperation = z.infer<typeof walletOperationSchema>
