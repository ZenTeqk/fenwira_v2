import { z } from 'zod'
import { CAPABILITY_KEYS, ENTITLEMENT_KEYS } from './subscriptions'
export const PLATFORM_PERMISSIONS = [
  'commercial.read',
  'financial.read',
  'wallet.manage',
  'subscription.manage',
  'entitlements.manage',
  'audit.read',
  /** ADR-0027: connect, verify, sync and rotate customers' Meta connections. */
  'whatsapp.read',
  'whatsapp.manage',
  /** ADR-0027 manual UPI billing: invoices, the payment queue and the billing dashboard. */
  'payments.read',
  'payments.manage',
  /** ADR-0027 step 4: create workspaces + owners, issue reset links, see email deliveries. */
  'workspaces.manage',
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
  /** Idle deadline (last declared activity + 3 h, capped at expiresAt). */
  idleExpiresAt: z.iso.datetime().optional(),
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
      referenceType: z.string().nullable(),
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

const safeNote = (v: string) =>
  !/Bearer\s+|fw_[a-z\d]+_[a-z\d_-]+|(?:password|secret|access_token)\s*[:=]/i.test(v)
const operationBase = z.object({
  reason: z
    .string()
    .trim()
    .min(5)
    .max(500)
    .refine(safeNote, 'Credentials must not be included in commercial notes.'),
  reference: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine(safeNote, 'Credentials must not be included in references.'),
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

export const subscriptionOperationSchema = z.discriminatedUnion('kind', [
  operationBase.extend({ kind: z.literal('activate'), planId: z.uuid() }).strict(),
  operationBase.extend({ kind: z.literal('cancel') }).strict(),
  operationBase
    .extend({ kind: z.literal('billing_mode'), mode: z.enum(['FREE', 'TRIAL', 'PREPAID']) })
    .strict(),
])
export type SubscriptionOperation = z.infer<typeof subscriptionOperationSchema>
export const entitlementOperationSchema = z
  .discriminatedUnion('kind', [
    operationBase
      .extend({
        kind: z.literal('override_set'),
        key: z.enum(ENTITLEMENT_KEYS),
        value: z.union([z.boolean(), z.number().int().safe().nonnegative(), z.null()]),
        expiresAt: z.iso.datetime().optional(),
      })
      .strict(),
    operationBase
      .extend({ kind: z.literal('override_remove'), key: z.enum(ENTITLEMENT_KEYS) })
      .strict(),
  ])
  .superRefine((input, ctx) => {
    if (
      input.kind === 'override_set' &&
      ((CAPABILITY_KEYS as readonly string[]).includes(input.key)
        ? typeof input.value !== 'boolean'
        : typeof input.value === 'boolean')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message:
          'Capabilities require boolean; limits require a nonnegative integer or null (unlimited).',
      })
  })
export type EntitlementOperation = z.infer<typeof entitlementOperationSchema>

export const platformAuditSchema = z.object({
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  id: z.uuid(),
  operatorId: z.uuid().nullable(),
  workspaceId: z.uuid().nullable(),
  action: z.string(),
  outcome: z.string(),
  correlationId: z.string().nullable(),
  createdAt: z.iso.datetime(),
})
export type PlatformAuditEvent = z.infer<typeof platformAuditSchema>

export const commercialPreviewSchema = z.object({
  version: z.string(),
  before: commercialSnapshotSchema,
  after: commercialSnapshotSchema,
  result: z.record(z.string(), z.unknown()),
  entitlements: z.array(
    z.object({ key: z.string(), configured: z.union([z.boolean(), z.number(), z.null()]) }),
  ),
})
export type CommercialPreview = z.infer<typeof commercialPreviewSchema>

export const platformGrantCommandSchema = z.object({
  userId: z.uuid(),
  actor: z.string().trim().min(1).max(120).refine(safeNote),
  reason: z.string().trim().min(5).max(500).refine(safeNote),
})

// ---------------------------------------------------------------------------------------------
// ADR-0027 step 4: provisioning without email. Links are returned once, when issued.
// ---------------------------------------------------------------------------------------------
export const createWorkspaceWithOwnerSchema = z
  .object({
    workspaceName: z.string().trim().min(2).max(80),
    ownerName: z.string().trim().min(1).max(120),
    ownerEmail: z.email().trim().toLowerCase(),
    country: z.string().length(2).toUpperCase().default('IN'),
    timezone: z.string().min(1).max(64).default('Asia/Kolkata'),
  })
  .strict()
export type CreateWorkspaceWithOwner = z.infer<typeof createWorkspaceWithOwnerSchema>
export const provisionedWorkspaceSchema = z.object({
  workspaceId: z.uuid(),
  ownerUserId: z.uuid(),
  /** null when the owner already had a Fenwira account (they sign in as usual). */
  setupLink: z.string().nullable(),
  setupExpiresAt: z.string().nullable(),
})
export type ProvisionedWorkspace = z.infer<typeof provisionedWorkspaceSchema>
export const platformMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  status: z.string(),
  emailVerified: z.boolean(),
  joinedAt: z.string(),
})
export type PlatformMember = z.infer<typeof platformMemberSchema>
export const oneTimeLinkSchema = z.object({ link: z.string(), expiresAt: z.string() })
export type OneTimeLink = z.infer<typeof oneTimeLinkSchema>
export const emailDeliverySchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: z.enum(['SENT', 'FAILED', 'SKIPPED_NO_SMTP', 'SUPPRESSED']),
  recipientHint: z.string(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
})
export type EmailDelivery = z.infer<typeof emailDeliverySchema>

/** Operator overview (GET /platform/overview): aggregates and workspace identifiers only. */
export const platformOverviewSchema = z.object({
  statusCounts: z.record(z.string(), z.number()),
  newWorkspaces: z.array(z.object({ month: z.string(), count: z.number() })),
  mrr: z.array(z.object({ currency: z.string(), amountMinor: z.number(), workspaces: z.number() })),
  revenueByMonth: z.array(
    z.object({
      month: z.string(),
      currency: z.string(),
      totalMinor: z.number(),
      payments: z.number(),
    }),
  ),
  pendingPayments: z.number(),
  overdueWorkspaces: z.number(),
  trialsEnding: z.array(
    z.object({ workspaceId: z.uuid(), name: z.string(), trialEndsAt: z.string() }),
  ),
  connections: z.array(
    z.object({
      workspaceId: z.uuid(),
      name: z.string(),
      number: z.string(),
      status: z.string(),
      quality: z.string(),
      messagingLimit: z.string().nullable(),
      webhook: z.string().nullable(),
      lastWebhookAt: z.string().nullable(),
      verifyOk: z.boolean().nullable(),
      verifyErrorCode: z.string().nullable(),
    }),
  ),
  messagesByDay: z.array(z.object({ day: z.string(), inbound: z.number(), outbound: z.number() })),
  failedSends7d: z.number(),
  queueBacklog: z.object({ waiting: z.number(), delayed: z.number(), failed: z.number() }),
  emailFailures7d: z.number(),
  accessRequests: z.object({ new7d: z.number(), unsent: z.number() }),
  attention: z.array(
    z.object({
      kind: z.enum([
        'PENDING_UTR',
        'OVERDUE',
        'UNHEALTHY_CONNECTION',
        'EMAIL_FAILURES',
        'UNSENT_LEADS',
      ]),
      title: z.string(),
      href: z.string(),
    }),
  ),
})
export type PlatformOverview = z.infer<typeof platformOverviewSchema>

/** Workspace detail activity (GET /platform/workspaces/:id/activity): no message content. */
export const platformWorkspaceActivitySchema = z.object({
  messagesByDay: z.array(z.object({ day: z.string(), inbound: z.number(), outbound: z.number() })),
  recentAudit: z.array(
    z.object({ action: z.string(), actorType: z.string(), createdAt: z.string() }),
  ),
})
export type PlatformWorkspaceActivity = z.infer<typeof platformWorkspaceActivitySchema>
