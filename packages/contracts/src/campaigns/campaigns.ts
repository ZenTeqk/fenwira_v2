import { z } from 'zod'
import { idSchema } from '../api/common'
import { contactFilterSchema } from '../contacts/filter'
import { TEMPLATE_CATEGORIES, templateComponentsSchema } from '../templates/components'

/**
 * Campaigns (docs/CAMPAIGN_ENGINE.md): audience, variable mapping, lifecycle and reporting shapes.
 */

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'PREPARING',
  'RUNNING',
  'PAUSED',
  'PAUSED_INSUFFICIENT_FUNDS',
  'PAUSED_TEMPLATE_UNAVAILABLE',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number]

export const RECIPIENT_STATUSES = [
  'PENDING',
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'SKIPPED',
] as const
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number]

/** Machine-readable reasons a recipient was not sent (shown in the UI with human copy). */
export const SKIP_REASONS = [
  'NO_MARKETING_CONSENT',
  'OPTED_OUT',
  'INVALID_PHONE',
  'BLOCKED',
  'TEMPLATE_UNAVAILABLE',
  'TEMPLATE_NOT_APPROVED',
  'MISSING_VARIABLE',
  'OTHER_POLICY_RESTRICTION',
  'CANCELLED',
] as const
export type SkipReason = (typeof SKIP_REASONS)[number]

/** Why a campaign is paused (PAUSED); PAUSED_INSUFFICIENT_FUNDS is its own status. */
export const PAUSE_REASONS = ['MANUAL', 'NUMBER_UNAVAILABLE'] as const
export type PauseReason = (typeof PAUSE_REASONS)[number]

const audienceSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('SEGMENT'), segmentId: idSchema }),
  z.object({ kind: z.literal('FILTER'), filter: contactFilterSchema }),
  z.object({
    kind: z.literal('TAGS'),
    tagIds: z.array(idSchema).min(1).max(50),
    match: z.enum(['ANY', 'ALL']).default('ANY'),
  }),
  z.object({ kind: z.literal('CONTACTS'), contactIds: z.array(idSchema).min(1).max(10_000) }),
  z.object({ kind: z.literal('IMPORT'), importJobId: idSchema }),
])
export type AudienceSource = z.infer<typeof audienceSource>
export const campaignAudienceSchema = z.object({
  include: z.array(audienceSource).max(20).default([]),
  exclude: z.array(audienceSource).max(20).default([]),
})
export type CampaignAudience = z.infer<typeof campaignAudienceSchema>

export const CONTACT_FIELDS = ['name', 'firstName', 'phone', 'email', 'country'] as const
export const variableSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('FIELD'),
    field: z.enum(CONTACT_FIELDS),
    fallback: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal('PROPERTY'),
    key: z.string().min(1).max(63),
    fallback: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal('STATIC'), value: z.string().min(1).max(1000) }),
])
export type VariableSource = z.infer<typeof variableSourceSchema>
/** Positional, like template variables: body[0] fills {{1}} of the body. */
export const variableMappingSchema = z.object({
  header: z.array(variableSourceSchema).max(1).optional(),
  body: z.array(variableSourceSchema).max(100).default([]),
  buttons: z.record(z.string(), z.array(variableSourceSchema).max(1)).optional(),
})
export type VariableMapping = z.infer<typeof variableMappingSchema>

/** What was sent: frozen when the campaign leaves DRAFT, for the audit trail. */
export const templateSnapshotSchema = z.object({
  templateId: idSchema,
  versionId: idSchema,
  name: z.string(),
  language: z.string(),
  category: z.enum(TEMPLATE_CATEGORIES),
  components: templateComponentsSchema,
})

export const campaignSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: z.enum(CAMPAIGN_STATUSES),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  failureReason: z.string().nullable(),
  phoneNumberId: idSchema.nullable(),
  phoneNumberDisplay: z.string().nullable(),
  templateVersionId: idSchema.nullable(),
  template: templateSnapshotSchema.nullable(),
  audience: campaignAudienceSchema,
  variableMapping: variableMappingSchema,
  scheduleAt: z.string().nullable(),
  timezone: z.string(),
  rateLimitPerMinute: z.number().int().nullable(),
  totalRecipients: z.number().int(),
  audienceSnapshotAt: z.string().nullable(),
  launchedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Campaign = z.infer<typeof campaignSchema>

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phoneNumberId: idSchema.optional(),
  templateVersionId: idSchema.optional(),
  audience: campaignAudienceSchema.optional(),
  variableMapping: variableMappingSchema.optional(),
  scheduleAt: z.iso.datetime({ offset: true }).nullable().optional(),
  rateLimitPerMinute: z.number().int().min(1).max(100_000).nullable().optional(),
})
export type CreateCampaign = z.infer<typeof createCampaignSchema>
export const updateCampaignSchema = createCampaignSchema.partial()

export const recipientSchema = z.object({
  id: idSchema,
  contactId: idSchema,
  contactName: z.string().nullable(),
  phoneE164: z.string(),
  status: z.enum(RECIPIENT_STATUSES),
  skipReason: z.enum(SKIP_REASONS).nullable(),
  errorCode: z.string().nullable(),
  messageId: idSchema.nullable(),
  variables: z.unknown(),
  queuedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  readAt: z.string().nullable(),
  failedAt: z.string().nullable(),
})
export type CampaignRecipient = z.infer<typeof recipientSchema>
export const recipientsQuerySchema = z.object({
  status: z.enum(RECIPIENT_STATUSES).optional(),
  skipReason: z.enum(SKIP_REASONS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
})

export const campaignStatsSchema = z.object({
  total: z.number().int(),
  eligible: z.number().int(),
  skipped: z.number().int(),
  pending: z.number().int(),
  queued: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  read: z.number().int(),
  failed: z.number().int(),
  /** Rates in [0, 1], null until there is something to divide by. */
  deliveryRate: z.number().nullable(),
  readRate: z.number().nullable(),
  failureRate: z.number().nullable(),
  skipReasons: z.record(z.string(), z.number().int()),
  failureCodes: z.record(z.string(), z.number().int()),
  durationSeconds: z.number().nullable(),
})
export type CampaignStats = z.infer<typeof campaignStatsSchema>

export const campaignEstimateSchema = z.object({
  total: z.number().int(),
  sendable: z.number().int(),
  skipped: z.record(z.string(), z.number().int()),
  /** Minor units in the wallet currency; null when the price book has no entry. */
  estimatedCostMinor: z.number().int().nullable(),
  currency: z.string(),
  availableFundsMinor: z.number().int().nullable(),
  billingEnforced: z.boolean(),
  samples: z.array(
    z.object({
      contactName: z.string().nullable(),
      phoneE164: z.string(),
      variables: z.unknown(),
    }),
  ),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})
export type CampaignEstimate = z.infer<typeof campaignEstimateSchema>
