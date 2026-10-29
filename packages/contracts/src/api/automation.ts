import { z } from 'zod'
import { PROPERTY_KEY_RE } from '../contacts/filter'
import { draftGraphSchema, EDGE_HANDLES, TRIGGER_TYPES } from '../automation/graph'
import { idSchema } from './common'

/** Automation API shapes (docs/API_SPEC.md → Automation, decisions P10-D1–D4). */

export const FLOW_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const
export const FLOW_VERSION_STATES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const
export const REENTRY_POLICIES = ['ALWAYS', 'ONCE_PER_CONTACT', 'AFTER_COMPLETION'] as const
export const EXECUTION_STATUSES = [
  'RUNNING',
  'WAITING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'STOPPED_TAKEOVER',
] as const
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number]
export const STEP_STATUSES = ['SUCCEEDED', 'FAILED', 'SKIPPED', 'WAITING'] as const
/** Per-flow outcome inside one triggering event's plan (AE3, P10-D2, P10-D3). */
export const RUN_ENTRY_STATUSES = [
  'PENDING',
  'STARTED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'STOPPED_TAKEOVER',
  'SKIPPED_TAKEOVER',
  'SKIPPED',
  'SKIPPED_ENTITLEMENT',
] as const
export type RunEntryStatus = (typeof RUN_ENTRY_STATUSES)[number]

const flowTriggerSchema = z.object({
  type: z.enum(TRIGGER_TYPES),
  config: z.record(z.string(), z.unknown()),
})

export const flowSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(FLOW_STATUSES),
  priority: z.number().int(),
  reentryPolicy: z.enum(REENTRY_POLICIES),
  triggerType: z.enum(TRIGGER_TYPES).nullable(),
  /** The draft's trigger (or the live one when there is no draft): list summaries. */
  trigger: flowTriggerSchema.nullable().default(null),
  /** The published version's trigger: what can match events now (overlap warnings). */
  liveTrigger: flowTriggerSchema.nullable().default(null),
  activeVersion: z.number().int().nullable(),
  draftUpdatedAt: z.string().nullable(),
  hasWebhookToken: z.boolean(),
  /** `AI_ASSISTANT`: created and switched on/off from the AI Assistant page. */
  managedBy: z.enum(['AI_ASSISTANT', 'REPLY_STUDIO']).nullable().default(null),
  replyStudioKind: z.enum(['AUTO_REPLY', 'BOT_FLOW']).optional(),
  executions: z.object({
    running: z.number().int(),
    total: z.number().int(),
    /** Executions started in the last 7 days (the list's "Runs, 7 days"). */
    last7d: z.number().int().default(0),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Flow = z.infer<typeof flowSchema>

export const flowVersionSchema = z.object({
  id: idSchema,
  version: z.number().int(),
  state: z.enum(FLOW_VERSION_STATES),
  graph: draftGraphSchema,
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  /** Send back as If-Match when saving the draft (optimistic concurrency). */
  etag: z.string(),
  /** Result of the last save's validation (drafts); null when never validated. */
  validation: z
    .object({
      valid: z.boolean(),
      errors: z.array(
        z.object({
          code: z.string(),
          message: z.string(),
          nodeId: z.string().optional(),
          edgeId: z.string().optional(),
        }),
      ),
      /** Never block publishing (e.g. the AI reply quota is used up this month). */
      warnings: z
        .array(
          z.object({
            code: z.string(),
            message: z.string(),
            nodeId: z.string().optional(),
          }),
        )
        .optional(),
    })
    .nullable(),
})
export type FlowVersion = z.infer<typeof flowVersionSchema>

export const createFlowSchema = z.object({
  managedBy: z.literal('REPLY_STUDIO').optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  priority: z.number().int().min(0).max(100_000).default(100),
  reentryPolicy: z.enum(REENTRY_POLICIES).default('AFTER_COMPLETION'),
})
export const updateFlowSchema = createFlowSchema.omit({ managedBy: true }).partial()
export const putDraftSchema = z.object({ graph: draftGraphSchema })

export const executionSchema = z.object({
  id: idSchema,
  flowId: idSchema,
  flowVersionId: idSchema,
  flowVersion: z.number().int(),
  contactId: idSchema,
  contactName: z.string().nullable(),
  conversationId: idSchema.nullable(),
  status: z.enum(EXECUTION_STATUSES),
  currentNodeId: z.string().nullable(),
  waitUntil: z.string().nullable(),
  stepCount: z.number().int(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  triggerRunId: idSchema.nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type Execution = z.infer<typeof executionSchema>

export const stepSchema = z.object({
  seq: z.number().int(),
  nodeId: z.string(),
  nodeType: z.string(),
  status: z.enum(STEP_STATUSES),
  input: z.unknown(),
  output: z.unknown(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type ExecutionStep = z.infer<typeof stepSchema>

export const triggerRunSchema = z.object({
  id: idSchema,
  eventId: idSchema,
  triggerType: z.string(),
  status: z.enum(['RUNNING', 'COMPLETED', 'STOPPED']),
  stopReason: z.string().nullable(),
  plan: z.array(
    z.object({
      flowId: idSchema,
      flowName: z.string(),
      flowVersionId: idSchema,
      priority: z.number().int(),
      status: z.enum(RUN_ENTRY_STATUSES),
      reason: z.string().nullable(),
      executionId: idSchema.nullable(),
    }),
  ),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
})
export type TriggerRun = z.infer<typeof triggerRunSchema>

export const executionsQuerySchema = z.object({
  status: z.enum(EXECUTION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
})

export const webhookTokenSchema = z.object({
  token: z.string(),
  /** HMAC-SHA256 key for X-Fenwira-Signature. Shown once. */
  secret: z.string(),
  url: z.string(),
})
export type WebhookToken = z.infer<typeof webhookTokenSchema>

export const flowValidationSchema = flowVersionSchema.shape.validation.unwrap()
export type FlowValidationResult = z.infer<typeof flowValidationSchema>

/**
 * Test run (docs/AUTOMATION_ENGINE.md → Test run): the saved draft runs against a sample contact
 * and event in a transaction that is always rolled back. Nothing is sent, called or stored.
 */
export const flowTestRequestSchema = z
  .object({
    /** An existing contact; otherwise `contact` describes a made-up one. */
    contactId: idSchema.optional(),
    contact: z
      .object({
        name: z.string().trim().max(120).optional(),
        phone: z
          .string()
          .trim()
          .regex(/^\+?[0-9]{8,15}$/, 'Enter a phone number with country code.')
          .optional(),
        properties: z.record(z.string().regex(PROPERTY_KEY_RE), z.string().max(500)).optional(),
        tagIds: z.array(idSchema).max(20).optional(),
      })
      .optional(),
    at: z.iso.datetime().optional(),
    answers: z.record(z.string(), z.string().max(4096)).optional(),
    /** Incoming message text (Message received and Keyword triggers). */
    message: z.string().max(4096).optional(),
    /** Webhook body (Incoming webhook trigger). */
    webhook: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((r) => !(r.contactId && r.contact), {
    message: 'Choose a contact or describe one, not both.',
  })
export type FlowTestRequest = z.infer<typeof flowTestRequestSchema>

export const flowTestStepSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  /** RAN: executed in the rolled-back transaction. SIMULATED: shown, never performed. */
  mode: z.enum(['RAN', 'SIMULATED']),
  status: z.enum(['SUCCEEDED', 'FAILED']),
  handle: z.enum(EDGE_HANDLES).nullable(),
  /** Plain language: "Would send: Hi Asha…", "Yes: the contact has the tag lead". */
  summary: z.string(),
  errorCode: z.string().nullable(),
})
export type FlowTestStep = z.infer<typeof flowTestStepSchema>

export const flowTestResultSchema = z.object({
  /** False when the sample would not start this automation (e.g. no keyword matched). */
  matched: z.boolean(),
  reason: z.string().nullable(),
  steps: z.array(flowTestStepSchema),
  /** True when the run stopped at the step limit (a loop through a delay). */
  truncated: z.boolean(),
})
export type FlowTestResult = z.infer<typeof flowTestResultSchema>

/** Per-step counts across this flow's runs (builder "Step counts" overlay). */
export const flowNodeStatsSchema = z.array(
  z.object({
    nodeId: z.string(),
    entered: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
  }),
)
export type FlowNodeStats = z.infer<typeof flowNodeStatsSchema>
