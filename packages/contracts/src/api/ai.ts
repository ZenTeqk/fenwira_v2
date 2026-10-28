import { z } from 'zod'
import { idSchema } from './common'

/** AI Assistant (docs/AI_ASSISTANT.md, docs/API_SPEC.md → AI Assistant). English only. */

export const AI_TONES = ['FRIENDLY', 'PROFESSIONAL', 'CONCISE'] as const
export const aiToneSchema = z.enum(AI_TONES)
export type AiTone = z.infer<typeof aiToneSchema>

export const AI_SOURCE_TYPES = ['FILE', 'FAQ', 'TEXT'] as const
export const AI_SOURCE_STATUSES = ['PROCESSING', 'READY', 'FAILED'] as const
export const AI_OUTCOMES = ['REPLIED', 'NO_ANSWER', 'HANDOFF', 'QUOTA', 'ERROR'] as const
export type AiOutcome = (typeof AI_OUTCOMES)[number]

/** What the browser may upload as a knowledge document, by MIME type (checked again server-side). */
export const AI_KNOWLEDGE_MIME_TYPES = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
} as const
export type AiKnowledgeMimeType = keyof typeof AI_KNOWLEDGE_MIME_TYPES
export const aiKnowledgeMimeSchema = z.enum(
  Object.keys(AI_KNOWLEDGE_MIME_TYPES) as [AiKnowledgeMimeType, ...AiKnowledgeMimeType[]],
)

const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null))

export const aiSettingsSchema = z.object({
  /** Operator-controlled (plan). */
  enabled: z.boolean(),
  monthlyMessageQuota: z.number().int(),
  businessName: z.string().nullable(),
  businessDescription: z.string().nullable(),
  tone: aiToneSchema,
  fallbackMessage: z.string().nullable(),
  handoffMessage: z.string().nullable(),
})
export type AiSettings = z.infer<typeof aiSettingsSchema>

export const updateAiSettingsRequestSchema = z
  .object({
    businessName: optionalText(120),
    businessDescription: optionalText(1000),
    tone: aiToneSchema,
    fallbackMessage: optionalText(500),
    handoffMessage: optionalText(500),
  })
  .partial()
export type UpdateAiSettingsRequest = z.infer<typeof updateAiSettingsRequestSchema>

export const aiKnowledgeSourceSchema = z.object({
  id: idSchema,
  type: z.enum(AI_SOURCE_TYPES),
  title: z.string(),
  status: z.enum(AI_SOURCE_STATUSES),
  failureReason: z.string().nullable(),
  chunkCount: z.number().int(),
  sizeBytes: z.number().int(),
  fileName: z.string().nullable(),
  mimeType: z.string().nullable(),
  /** A replacement is being indexed while the previous version keeps answering. */
  replacing: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type AiKnowledgeSource = z.infer<typeof aiKnowledgeSourceSchema>

export const aiKnowledgeUploadUrlRequestSchema = z.object({
  mimeType: aiKnowledgeMimeSchema,
  sizeBytes: z.number().int().min(1),
  filename: text(240).min(1),
})
export type AiKnowledgeUploadUrlRequest = z.infer<typeof aiKnowledgeUploadUrlRequestSchema>

export const createAiFileSourceRequestSchema = z.object({
  fileId: idSchema,
  title: text(120).min(1).optional(),
})
export type CreateAiFileSourceRequest = z.infer<typeof createAiFileSourceRequestSchema>

export const aiFaqPairSchema = z.object({
  question: text(500).min(1, 'Enter a question.'),
  answer: text(2000).min(1, 'Enter an answer.'),
})
export const createAiFaqSourceRequestSchema = z.object({
  title: text(120).min(1, 'Give this FAQ a title.'),
  pairs: z.array(aiFaqPairSchema).min(1, 'Add at least one question.').max(200),
})
export type CreateAiFaqSourceRequest = z.infer<typeof createAiFaqSourceRequestSchema>

export const createAiTextSourceRequestSchema = z.object({
  title: text(120).min(1, 'Give this text a title.'),
  text: text(100_000).min(20, 'Add at least a sentence or two.'),
})
export type CreateAiTextSourceRequest = z.infer<typeof createAiTextSourceRequestSchema>

/** Replace a source's content: a new file (FILE), new pairs (FAQ) or new text (TEXT). */
export const replaceAiSourceRequestSchema = z.union([
  z.object({ fileId: idSchema }),
  z.object({ pairs: createAiFaqSourceRequestSchema.shape.pairs }),
  z.object({ text: createAiTextSourceRequestSchema.shape.text }),
])
export type ReplaceAiSourceRequest = z.infer<typeof replaceAiSourceRequestSchema>

export const aiSourceRefSchema = z.object({
  documentTitle: z.string(),
  page: z.number().int().nullable(),
  snippet: z.string(),
})
export type AiSourceRef = z.infer<typeof aiSourceRefSchema>

export const aiPlaygroundRequestSchema = z.object({
  question: text(1000).min(1, 'Ask a question.'),
})
export type AiPlaygroundRequest = z.infer<typeof aiPlaygroundRequestSchema>
export const aiPlaygroundResponseSchema = z.object({
  outcome: z.enum(AI_OUTCOMES),
  /** What the customer would receive (the answer, or the fallback/handoff message). */
  answer: z.string().nullable(),
  sources: z.array(aiSourceRefSchema),
  tokens: z.object({ input: z.number().int(), output: z.number().int() }),
})
export type AiPlaygroundResponse = z.infer<typeof aiPlaygroundResponseSchema>

export const aiUsageSchema = z.object({
  month: z.string(),
  used: z.number().int(),
  quota: z.number().int(),
  days: z.array(
    z.object({
      date: z.string(),
      replies: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
    }),
  ),
})
export type AiUsage = z.infer<typeof aiUsageSchema>

export const aiReplyLogSchema = z.object({
  id: idSchema,
  createdAt: z.iso.datetime(),
  conversationId: idSchema.nullable(),
  customerExcerpt: z.string(),
  outcome: z.enum(AI_OUTCOMES),
  reply: z.string().nullable(),
  sources: z.array(aiSourceRefSchema),
  playground: z.boolean(),
})
export type AiReplyLog = z.infer<typeof aiReplyLogSchema>

export const AI_READINESS_KEYS = ['knowledge', 'businessInfo', 'whatsapp', 'quota'] as const
export const aiOverviewSchema = z.object({
  enabled: z.boolean(),
  readiness: z.object({
    knowledge: z.boolean(),
    businessInfo: z.boolean(),
    whatsapp: z.boolean(),
    quota: z.boolean(),
  }),
  usage: z.object({ used: z.number().int(), quota: z.number().int() }),
  managedFlow: z
    .object({ id: idSchema, status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']) })
    .nullable(),
  /** Questions taken from ready FAQ sources, for the Test tab. */
  sampleQuestions: z.array(z.string()),
})
export type AiOverview = z.infer<typeof aiOverviewSchema>

/** Operator console (/platform): per-workspace switch, quota and usage. */
export const platformAiSettingsSchema = z.object({
  enabled: z.boolean(),
  monthlyMessageQuota: z.number().int(),
  used: z.number().int(),
  sources: z.number().int(),
})
export type PlatformAiSettings = z.infer<typeof platformAiSettingsSchema>
export const updatePlatformAiSettingsRequestSchema = z
  .object({
    enabled: z.boolean(),
    monthlyMessageQuota: z.number().int().min(0).max(1_000_000),
    reason: z.string().trim().min(3, 'Add a short reason for the audit log.').max(500),
  })
  .partial({ enabled: true, monthlyMessageQuota: true })
export type UpdatePlatformAiSettingsRequest = z.infer<typeof updatePlatformAiSettingsRequestSchema>

// ---------------------------------------------------------------------------------------------
// Activation requests (docs/AI_ASSISTANT.md → Activation requests)
// ---------------------------------------------------------------------------------------------

export const AI_ACTIVATION_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
export const aiActivationStatusSchema = z.enum(AI_ACTIVATION_STATUSES)
export type AiActivationStatus = z.infer<typeof aiActivationStatusSchema>

/** An operator-managed plan. Money in minor units (paise for INR). */
export const aiPlanSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  monthlyPriceMinor: z.number().int().min(0),
  currency: z.string().length(3),
  includedReplies: z.number().int().min(0),
  description: z.string().nullable(),
  active: z.boolean(),
  sortOrder: z.number().int(),
})
export type AiPlan = z.infer<typeof aiPlanSchema>

export const aiActivationRequestSchema = z.object({
  id: z.uuid(),
  status: aiActivationStatusSchema,
  planId: z.uuid().nullable(),
  planName: z.string().nullable(),
  expectedConversations: z.number().int(),
  useCase: z.string(),
  contactEmail: z.string(),
  contactPhone: z.string().nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type AiActivationRequest = z.infer<typeof aiActivationRequestSchema>

/** GET /ai/activation: what the request page needs, readable while the assistant is off. */
export const aiActivationStateSchema = z.object({
  enabled: z.boolean(),
  /** Active plans only, in display order. Empty → "Contact us for pricing". */
  plans: z.array(aiPlanSchema),
  /** The latest request, if any (the page shows its status). */
  request: aiActivationRequestSchema.nullable(),
  /** Prefill for the request dialog. */
  contact: z.object({ email: z.string(), phone: z.string().nullable() }),
})
export type AiActivationState = z.infer<typeof aiActivationStateSchema>

export const createAiActivationRequestSchema = z.object({
  /** Required when active plans exist; null when the workspace asks for pricing. */
  planId: z.uuid().nullable(),
  expectedConversations: z
    .number({ error: 'Enter a number of conversations.' })
    .int('Enter a whole number.')
    .min(1, 'Enter at least 1.')
    .max(10_000_000, 'Enter 10,000,000 or fewer.'),
  useCase: z
    .string()
    .trim()
    .min(10, 'Describe the use case in at least 10 characters.')
    .max(1000, 'Keep it under 1,000 characters.'),
  contactEmail: z.email('Enter a valid email address.').max(254),
  contactPhone: z
    .string()
    .trim()
    .max(20, 'Enter a shorter phone number.')
    .regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number.')
    .nullable(),
})
export type CreateAiActivationRequest = z.infer<typeof createAiActivationRequestSchema>

/** Operator queue row: the request plus the workspace and the plan's included replies. */
export const platformAiActivationRequestSchema = aiActivationRequestSchema.extend({
  workspaceId: z.uuid(),
  workspaceName: z.string(),
  includedReplies: z.number().int().nullable(),
})
export type PlatformAiActivationRequest = z.infer<typeof platformAiActivationRequestSchema>

export const approveAiActivationRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
  /** Required when the request has no plan; otherwise the plan's included replies are used. */
  monthlyMessageQuota: z.number().int().min(0).max(1_000_000).optional(),
})
export type ApproveAiActivationRequest = z.infer<typeof approveAiActivationRequestSchema>

export const rejectAiActivationRequestSchema = z.object({
  note: z
    .string()
    .trim()
    .min(3, 'Tell the workspace why (at least 3 characters).')
    .max(500, 'Keep the note under 500 characters.'),
})
export type RejectAiActivationRequest = z.infer<typeof rejectAiActivationRequestSchema>

export const aiActivationDecisionResultSchema = z.object({
  request: platformAiActivationRequestSchema,
  /** True when approving a workspace that was already enabled (no settings changed). */
  alreadyEnabled: z.boolean(),
})
export type AiActivationDecisionResult = z.infer<typeof aiActivationDecisionResultSchema>

export const upsertAiPlanSchema = z.object({
  name: z.string().trim().min(2, 'Enter a plan name.').max(80),
  monthlyPriceMinor: z
    .number()
    .int('Use minor units (paise).')
    .min(0, 'The price cannot be negative.')
    .max(100_000_000_00),
  currency: z.string().trim().toUpperCase().length(3).default('INR'),
  includedReplies: z.number().int().min(0).max(10_000_000),
  description: z.string().trim().max(300).nullable(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
})
export type UpsertAiPlan = z.infer<typeof upsertAiPlanSchema>
