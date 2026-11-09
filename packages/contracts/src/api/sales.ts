import { z } from 'zod'
import { businessHoursSchema } from '../automation/reply-studio'
import { idSchema } from './common'

/**
 * Follow-ups, sales stages and opportunities, and response alerts (docs/FOLLOW_UPS_AND_SALES.md,
 * docs/RESPONSE_ALERTS.md). Money is integer minor units (paise for INR), never floating point.
 */

const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true')
const iso = z.iso.datetime({ offset: true })

// ------------------------------------------------------------------------------- sales stages

export const SALES_OUTCOMES = ['OPEN', 'WON', 'LOST'] as const
export type SalesOutcome = (typeof SALES_OUTCOMES)[number]
export const salesOutcomeSchema = z.enum(SALES_OUTCOMES)

/** The default stages every workspace starts with (stable keys; names are editable). */
export const DEFAULT_SALES_STAGES: ReadonlyArray<{
  key: string
  name: string
  outcome: SalesOutcome
}> = [
  { key: 'new_enquiry', name: 'New enquiry', outcome: 'OPEN' },
  { key: 'interested', name: 'Interested', outcome: 'OPEN' },
  { key: 'quote_sent', name: 'Quote sent', outcome: 'OPEN' },
  { key: 'won', name: 'Won', outcome: 'WON' },
  { key: 'lost', name: 'Lost', outcome: 'LOST' },
]

const stageName = z.string().trim().min(1, 'Enter a stage name.').max(40)

export const salesStageSchema = z.object({
  id: idSchema,
  name: z.string(),
  outcome: salesOutcomeSchema,
  position: z.number().int(),
  archived: z.boolean(),
  /** Opportunities currently in this stage (archived stages keep their history). */
  opportunityCount: z.number().int(),
})
export type SalesStage = z.infer<typeof salesStageSchema>
export const salesStageRefSchema = z.object({
  id: idSchema,
  name: z.string(),
  outcome: salesOutcomeSchema,
})
export type SalesStageRef = z.infer<typeof salesStageRefSchema>

export const createSalesStageSchema = z.object({ name: stageName, outcome: salesOutcomeSchema })
export const updateSalesStageSchema = z
  .object({ name: stageName, archived: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.')
/** The full order of active stages, first to last. */
export const reorderSalesStagesSchema = z.object({ ids: z.array(idSchema).min(1).max(50) })

// ------------------------------------------------------------------------------- opportunities

export const OPPORTUNITY_STATUSES = SALES_OUTCOMES
export type OpportunityStatus = SalesOutcome
/** Integer minor units, up to 10^13 (well inside Number.MAX_SAFE_INTEGER). */
export const moneyMinorSchema = z.number().int().min(0).max(10_000_000_000_000)
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.')

export const opportunitySchema = z.object({
  id: idSchema,
  contactId: idSchema,
  conversationId: idSchema.nullable(),
  title: z.string().nullable(),
  stage: salesStageRefSchema,
  status: salesOutcomeSchema,
  owner: z.object({ id: idSchema, name: z.string() }).nullable(),
  expectedValueMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Pending follow-ups linked to this opportunity. */
  pendingFollowUps: z.number().int(),
})
export type Opportunity = z.infer<typeof opportunitySchema>

const valueFields = {
  expectedValueMinor: moneyMinorSchema.nullable().optional(),
  currency: currencyCodeSchema.optional(),
}
export const createOpportunitySchema = z.object({
  contactId: idSchema,
  conversationId: idSchema.optional(),
  title: z.string().trim().max(120).optional(),
  /** Defaults to the first active open stage. */
  stageId: idSchema.optional(),
  /** Defaults to the current user. */
  ownerId: idSchema.nullable().optional(),
  ...valueFields,
})
export type CreateOpportunityRequest = z.infer<typeof createOpportunitySchema>
export const updateOpportunitySchema = z
  .object({
    stageId: idSchema.optional(),
    ownerId: idSchema.nullable().optional(),
    title: z.string().trim().max(120).nullable().optional(),
    ...valueFields,
    /**
     * Closing (moving to a won or lost stage) never touches follow-ups unless this is true; then
     * the opportunity's pending follow-ups are cancelled in the same transaction.
     */
    cancelPendingFollowUps: z.boolean().optional(),
  })
  .refine(
    (v) => Object.keys(v).some((k) => k !== 'cancelPendingFollowUps'),
    'Provide at least one field.',
  )
export type UpdateOpportunityRequest = z.infer<typeof updateOpportunitySchema>
export const opportunitiesQuerySchema = z.object({
  contactId: idSchema.optional(),
  status: salesOutcomeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
})

// ------------------------------------------------------------------------------- follow-ups

export const FOLLOW_UP_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'] as const
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number]
/**
 * Today: pending and due on the workspace-local date. Overdue: pending and past due (the two can
 * overlap). Upcoming: pending and due after today. Completed: done, newest first.
 */
export const FOLLOW_UP_TABS = ['today', 'overdue', 'upcoming', 'completed'] as const
export type FollowUpTab = (typeof FOLLOW_UP_TABS)[number]

const person = z.object({ id: idSchema, name: z.string() })
export const followUpSchema = z.object({
  id: idSchema,
  title: z.string(),
  note: z.string().nullable(),
  status: z.enum(FOLLOW_UP_STATUSES),
  dueAt: z.string(),
  overdue: z.boolean(),
  /** The customer replied after this was created; the assignee should look again. */
  needsReview: z.boolean(),
  contact: z.object({
    id: idSchema,
    name: z.string().nullable(),
    waProfileName: z.string().nullable(),
    phoneE164: z.string(),
  }),
  conversationId: idSchema.nullable(),
  opportunityId: idSchema.nullable(),
  /** The linked opportunity's stage, else the customer's open opportunity's stage. */
  salesStage: salesStageRefSchema.nullable(),
  assignee: person,
  createdBy: person.nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
})
export type FollowUp = z.infer<typeof followUpSchema>

export const followUpsQuerySchema = z.object({
  /** The page's tabs, plus `pending` (every pending one, soonest first) for inbox panels. */
  tab: z.enum([...FOLLOW_UP_TABS, 'pending']).default('today'),
  /**
   * `mine`: assigned to me. `team`: everyone's (needs followups.manage). `related`: every
   * follow-up I can see (mine and ones I created; a manager's whole team).
   */
  scope: z.enum(['mine', 'team', 'related']).default('mine'),
  assigneeId: idSchema.optional(),
  stageId: idSchema.optional(),
  contactId: idSchema.optional(),
  conversationId: idSchema.optional(),
  needsReview: boolParam.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
})
export type FollowUpsQuery = z.infer<typeof followUpsQuerySchema>
export const followUpCountsSchema = z.object({
  today: z.number().int(),
  overdue: z.number().int(),
  upcoming: z.number().int(),
  completed: z.number().int(),
})
export type FollowUpCounts = z.infer<typeof followUpCountsSchema>
/** Sidebar badge and inbox hints for the current user. */
export const followUpSummarySchema = z.object({
  overdue: z.number().int(),
  today: z.number().int(),
  needsReview: z.number().int(),
})
export type FollowUpSummary = z.infer<typeof followUpSummarySchema>

const title = z.string().trim().min(1, 'Enter what needs doing.').max(200)
const note = z.string().trim().max(2000)
/** Optional optimistic-concurrency check: 409 CONFLICT when the follow-up changed meanwhile. */
const version = z.number().int().min(1).optional()
export const createFollowUpSchema = z.object({
  contactId: idSchema,
  conversationId: idSchema.optional(),
  opportunityId: idSchema.optional(),
  title,
  note: note.optional(),
  /** Defaults to the conversation's assignee, else the current user. */
  assigneeId: idSchema.optional(),
  dueAt: iso,
})
export type CreateFollowUpRequest = z.infer<typeof createFollowUpSchema>
export const updateFollowUpSchema = z
  .object({ title, note: note.nullable(), version })
  .partial()
  .refine((v) => v.title !== undefined || v.note !== undefined, 'Provide at least one field.')
export const rescheduleFollowUpSchema = z.object({ dueAt: iso, version })
export const reassignFollowUpSchema = z.object({ assigneeId: idSchema, version })
export const followUpActionSchema = z.object({ version }).default({})

// ------------------------------------------------------------------------------- response alerts

/** Suggested starting values (editable): business minutes. */
export const RESPONSE_ALERT_DEFAULTS = {
  unassignedMinutes: 5,
  responseMinutes: 15,
  escalationMinutes: 30,
} as const
const minutes = z.number().int().min(1).max(1440)

export const responseAlertIssueSchema = z.object({
  code: z.enum(['NO_ESCALATION_RECIPIENT', 'NO_ASSIGN_RECIPIENT', 'NO_BUSINESS_HOURS']),
  message: z.string(),
  at: z.string(),
})
export const responseAlertSettingsSchema = z.object({
  enabled: z.boolean(),
  unassignedMinutes: z.number().int(),
  responseMinutes: z.number().int(),
  escalationMinutes: z.number().int(),
  escalationUserIds: z.array(idSchema),
  /** Read-only here: the shared schedule from Automations → Reply Studio → Business hours. */
  businessHours: businessHoursSchema,
  businessHoursConfigured: z.boolean(),
  /** The workspace timezone (Settings → Workspace), used for due dates and "today". */
  workspaceTimezone: z.string(),
  enabledAt: z.string().nullable(),
  issue: responseAlertIssueSchema.nullable(),
})
export type ResponseAlertSettings = z.infer<typeof responseAlertSettingsSchema>
export const updateResponseAlertSettingsSchema = z
  .object({
    enabled: z.boolean(),
    unassignedMinutes: minutes,
    responseMinutes: minutes,
    escalationMinutes: minutes,
    escalationUserIds: z.array(idSchema).max(20),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.')
export type UpdateResponseAlertSettings = z.infer<typeof updateResponseAlertSettingsSchema>

/** The conversation's open "waiting for staff" episode, when there is one. */
export const conversationWaitingSchema = z.object({
  /** The oldest customer message still waiting for a staff reply. */
  since: z.string(),
  /** A bot (automation or AI Assistant) is handling it; the staff timer is not running. */
  botHandling: z.boolean(),
})
export type ConversationWaiting = z.infer<typeof conversationWaitingSchema>
