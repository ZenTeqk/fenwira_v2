import { z } from 'zod'

/**
 * Plans, entitlements and subscriptions (Phase 11 Step 4, docs/BILLING.md → Plans). Feature code
 * asks about entitlement keys — never plan keys. Plans are rows; the seeds below are launch
 * defaults inserted only when missing, so operators can change them as data.
 */
export const CAPABILITY_KEYS = ['automation_enabled', 'api_enabled', 'webhooks_enabled'] as const
export const LIMIT_KEYS = [
  'max_users',
  'max_contacts',
  'max_active_flows',
  'automation_execution_limit',
  'analytics_retention',
] as const
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number]
export type LimitKey = (typeof LIMIT_KEYS)[number]
export type EntitlementKey = CapabilityKey | LimitKey
export const ENTITLEMENT_KEYS = [...CAPABILITY_KEYS, ...LIMIT_KEYS] as const

export const ENTITLEMENT_LABELS: Record<EntitlementKey, string> = {
  automation_enabled: 'Automations',
  api_enabled: 'API access',
  webhooks_enabled: 'Webhooks',
  max_users: 'Team members',
  max_contacts: 'Contacts',
  max_active_flows: 'Active automations',
  automation_execution_limit: 'Automation runs per month',
  analytics_retention: 'Analytics history (days)',
}

/** Launch defaults (P11-D2, D15, D18). Unset limits resolve to unlimited (null). */
export const PLAN_SEEDS: ReadonlyArray<{
  key: string
  name: string
  sort: number
  entitlements: Partial<Record<EntitlementKey, boolean | number | null>>
}> = [
  {
    key: 'STARTER',
    name: 'Starter',
    sort: 10,
    entitlements: {
      automation_enabled: true,
      api_enabled: false,
      webhooks_enabled: false,
      max_users: 3,
      max_contacts: 5_000,
      max_active_flows: 5,
      analytics_retention: 30,
    },
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    sort: 20,
    entitlements: {
      automation_enabled: true,
      api_enabled: true,
      webhooks_enabled: true,
      max_users: 10,
      max_contacts: 25_000,
      max_active_flows: 20,
      analytics_retention: 90,
    },
  },
  {
    key: 'BUSINESS',
    name: 'Business',
    sort: 30,
    entitlements: {
      automation_enabled: true,
      api_enabled: true,
      webhooks_enabled: true,
      max_users: 25,
      max_contacts: 100_000,
      max_active_flows: 100,
      analytics_retention: 365,
    },
  },
]

/** PAST_DUE (grace) and SUSPENDED come from manual billing (ADR-0027, ML-D2). */
export const SUBSCRIPTION_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
  'PAST_DUE',
  'SUSPENDED',
] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

export const planSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  /** Prices are not approved (P11-D4): null until configured; the UI shows "Contact us". */
  price: z
    .object({ amountMinor: z.number().int(), currency: z.string(), interval: z.string() })
    .nullable(),
  entitlements: z.record(z.string(), z.union([z.boolean(), z.number(), z.null()])),
})
export type Plan = z.infer<typeof planSchema>

export const subscriptionSchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),
  plan: z.object({ id: z.uuid(), key: z.string(), name: z.string() }).nullable(),
  requestedPlan: z.object({ id: z.uuid(), key: z.string(), name: z.string() }).nullable(),
  requestedAt: z.string().nullable(),
  interval: z.enum(['MONTH', 'YEAR']),
  trialEndsAt: z.string().nullable(),
  trialDaysLeft: z.number().int().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
})
export type Subscription = z.infer<typeof subscriptionSchema>

export const entitlementStatusSchema = z.object({
  key: z.enum(ENTITLEMENT_KEYS),
  label: z.string(),
  kind: z.enum(['capability', 'limit']),
  enabled: z.boolean().nullable(),
  limit: z.number().nullable(),
  usage: z.number().nullable(),
  overLimit: z.boolean(),
})
export type EntitlementStatus = z.infer<typeof entitlementStatusSchema>

/** P11-D24: the OWNER requests a plan; an operator activates it (no gateway, no prices). */
export const requestPlanSchema = z.object({ planId: z.uuid() })
export type RequestPlan = z.infer<typeof requestPlanSchema>
