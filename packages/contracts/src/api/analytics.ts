import { z } from 'zod'

/**
 * Analytics API (docs/ANALYTICS.md). Every view takes the same date range: workspace-local days
 * (YYYY-MM-DD, the workspace timezone, both inclusive). Analytics are derived projections; money
 * comes from usage events and the ledger, never the other way round.
 */
const day = z.iso.date()

export const analyticsRangeQuerySchema = z.object({
  /** Default: 29 days before `to`. */
  from: day.optional(),
  /**
   * Instead of `from`: the last N days ending `to` (presets). The server resolves it in the
   * workspace timezone, so the browser's timezone never shifts the range.
   */
  days: z.coerce.number().int().min(1).max(366).optional(),
  /** Default: today in the workspace timezone. Later days are clamped to today. */
  to: day.optional(),
  /** Compare with the previous period of the same length (default true). */
  compare: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v !== 'false'),
})
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>

export const ANALYTICS_FRESHNESS = ['READY', 'PROCESSING', 'NOT_STARTED', 'DEGRADED'] as const

export const analyticsMetaSchema = z.object({
  range: z.object({ from: day, to: day, days: z.number().int() }),
  /** The previous equivalent period, or null when not requested or outside retained history. */
  previous: z.object({ from: day, to: day }).nullable(),
  timezone: z.string(),
  today: day,
  /** The range includes today, which is still in progress. */
  partial: z.boolean(),
  retention: z.object({
    /** null = unlimited (P11-D15 via entitlements). */
    days: z.number().int().nullable(),
    earliestDay: day.nullable(),
    /** `from` was moved forward to the earliest retained day. */
    clamped: z.boolean(),
  }),
  freshness: z.object({
    status: z.enum(ANALYTICS_FRESHNESS),
    lastProcessedAt: z.iso.datetime().nullable(),
    /** Days or campaigns waiting to be recomputed. */
    pending: z.number().int(),
  }),
})
export type AnalyticsMeta = z.infer<typeof analyticsMetaSchema>

/** A count with its previous-period value (null when there is no comparison). */
export const kpiSchema = z.object({ value: z.number(), previous: z.number().nullable() })
export type Kpi = z.infer<typeof kpiSchema>

/**
 * A rate. `value` is null when the denominator is 0: "no data to compute a rate" is never shown
 * as 0 %. Numerator and denominator are always returned so the UI can explain the figure.
 */
export const rateSchema = z.object({
  value: z.number().nullable(),
  numerator: z.number(),
  denominator: z.number(),
  previous: z.number().nullable(),
})
export type Rate = z.infer<typeof rateSchema>

export const breakdownRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  values: z.record(z.string(), z.number()),
})
export type BreakdownRow = z.infer<typeof breakdownRowSchema>

export const seriesPointSchema = z.object({
  day,
  values: z.record(z.string(), z.number()),
})
export type SeriesPoint = z.infer<typeof seriesPointSchema>

const view = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ meta: analyticsMetaSchema, ...shape })

export const messagingAnalyticsSchema = view({
  kpis: z.object({
    sent: kpiSchema,
    delivered: kpiSchema,
    read: kpiSchema,
    failed: kpiSchema,
    inbound: kpiSchema,
    deliveryRate: rateSchema,
    readRate: rateSchema,
    failureRate: rateSchema,
  }),
  series: z.array(seriesPointSchema),
  byCategory: z.array(breakdownRowSchema),
  bySource: z.array(breakdownRowSchema),
  byPhoneNumber: z.array(breakdownRowSchema),
  failureReasons: z.array(breakdownRowSchema),
})
export type MessagingAnalytics = z.infer<typeof messagingAnalyticsSchema>

export const campaignAnalyticsRowSchema = z.object({
  campaignId: z.uuid(),
  name: z.string(),
  status: z.string(),
  startedDay: day,
  recipients: z.number(),
  sent: z.number(),
  delivered: z.number(),
  read: z.number(),
  failed: z.number(),
  skipped: z.number(),
  inProgress: z.number(),
  deliveryRate: z.number().nullable(),
  readRate: z.number().nullable(),
  failureRate: z.number().nullable(),
})
export type CampaignAnalyticsRow = z.infer<typeof campaignAnalyticsRowSchema>

export const campaignsAnalyticsSchema = view({
  kpis: z.object({
    campaigns: kpiSchema,
    recipients: kpiSchema,
    skipped: kpiSchema,
    sent: kpiSchema,
    delivered: kpiSchema,
    read: kpiSchema,
    failed: kpiSchema,
    deliveryRate: rateSchema,
    readRate: rateSchema,
    failureRate: rateSchema,
  }),
  campaigns: z.array(campaignAnalyticsRowSchema),
  skipReasons: z.array(breakdownRowSchema),
})
export type CampaignsAnalytics = z.infer<typeof campaignsAnalyticsSchema>

/** Durations in seconds; null when no episode in the range has one. */
export const inboxAnalyticsSchema = view({
  kpis: z.object({
    opened: kpiSchema,
    newConversations: kpiSchema,
    resolved: kpiSchema,
    medianFirstResponseSeconds: z.number().nullable(),
    medianResolutionSeconds: z.number().nullable(),
    firstResponses: z.number(),
    awaitingFirstResponse: z.number(),
    openNow: z.number(),
    unassignedNow: z.number(),
  }),
  series: z.array(seriesPointSchema),
  agents: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string(),
      assignedOpenNow: z.number(),
      assigned: z.number(),
      firstResponses: z.number(),
      medianFirstResponseSeconds: z.number().nullable(),
      resolved: z.number(),
    }),
  ),
  /** First day with episode data: opens are recorded from the day analytics started. */
  episodesSince: day.nullable(),
})
export type InboxAnalytics = z.infer<typeof inboxAnalyticsSchema>

export const automationsAnalyticsSchema = view({
  kpis: z.object({
    executions: kpiSchema,
    completed: kpiSchema,
    failed: kpiSchema,
    cancelled: kpiSchema,
    stoppedByTakeover: kpiSchema,
    inProgress: z.number(),
    successRate: rateSchema,
    failureRate: rateSchema,
    averageDurationSeconds: z.number().nullable(),
    stepFailures: kpiSchema,
  }),
  series: z.array(seriesPointSchema),
  flows: z.array(
    z.object({
      flowId: z.uuid(),
      name: z.string(),
      executions: z.number(),
      completed: z.number(),
      failed: z.number(),
      cancelled: z.number(),
      stoppedByTakeover: z.number(),
      inProgress: z.number(),
      successRate: z.number().nullable(),
      averageDurationSeconds: z.number().nullable(),
    }),
  ),
  stepFailuresByType: z.array(breakdownRowSchema),
})
export type AutomationsAnalytics = z.infer<typeof automationsAnalyticsSchema>

/**
 * Usage from usage_events (the source of charges) and promotional credits from the ledger.
 * Provider cost is not shown to workspaces (interim decision for P11-Q25).
 */
export const usageAnalyticsSchema = view({
  currency: z.string(),
  kpis: z.object({
    billableMessages: kpiSchema,
    chargeMinor: kpiSchema,
    promotionalCreditsMinor: kpiSchema,
  }),
  series: z.array(seriesPointSchema),
  byCategory: z.array(breakdownRowSchema),
})
export type UsageAnalytics = z.infer<typeof usageAnalyticsSchema>

export const overviewAnalyticsSchema = view({
  kpis: z.object({
    sent: kpiSchema,
    deliveryRate: rateSchema,
    openConversations: z.number(),
    failed: kpiSchema,
    automationFailures: kpiSchema,
    chargeMinor: kpiSchema.nullable(),
  }),
  currency: z.string().nullable(),
  series: z.array(seriesPointSchema),
  topCampaigns: z.array(campaignAnalyticsRowSchema),
  topFlows: z.array(z.object({ flowId: z.uuid(), name: z.string(), executions: z.number() })),
})
export type OverviewAnalytics = z.infer<typeof overviewAnalyticsSchema>

/** Contact → Campaigns: the contact's campaign recipient rows (the authoritative relation). */
export const contactCampaignSchema = z.object({
  campaignId: z.uuid(),
  name: z.string(),
  campaignStatus: z.string(),
  recipientStatus: z.string(),
  skipReason: z.string().nullable(),
  errorCode: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
  deliveredAt: z.iso.datetime().nullable(),
  readAt: z.iso.datetime().nullable(),
  failedAt: z.iso.datetime().nullable(),
  /** When the contact entered the campaign audience. */
  createdAt: z.iso.datetime(),
})
export type ContactCampaign = z.infer<typeof contactCampaignSchema>
