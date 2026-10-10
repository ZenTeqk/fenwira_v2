import { z } from 'zod'
import { CONSENT_STATES, contactFilterSchema, PROPERTY_KEY_RE } from '../contacts/filter'
import { emailSchema, idSchema } from './common'

/** Contacts, properties, tags, notes, consent, segments, imports and exports (API_SPEC → P6). */
export const CONTACT_SOURCES = [
  'INBOUND',
  'MANUAL',
  'IMPORT',
  'API',
  'CAMPAIGN',
  'AUTOMATION',
] as const
export const CONTACT_STATUSES = ['ACTIVE', 'BLOCKED'] as const
export const TAG_COLORS = ['NEUTRAL', 'PRIMARY', 'INFO', 'WARNING', 'DANGER', 'SUCCESS'] as const
export type TagColor = (typeof TAG_COLORS)[number]
export const PROPERTY_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]
export const CONSENT_PURPOSES = ['MARKETING', 'UTILITY', 'SERVICE'] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]
export const CONSENT_SOURCES = [
  'INBOUND_KEYWORD',
  'MANUAL',
  'IMPORT',
  'API',
  'FORM',
  'META_OPT_OUT',
] as const
export type ConsentState = (typeof CONSENT_STATES)[number]

export const tagSchema = z.object({ id: idSchema, name: z.string(), color: z.enum(TAG_COLORS) })
export type Tag = z.infer<typeof tagSchema>
export const tagWithCountSchema = tagSchema.extend({ contactCount: z.number().int() })
export const createTagRequestSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(TAG_COLORS).default('NEUTRAL'),
})
export const updateTagRequestSchema = createTagRequestSchema.partial()

/** A property value as the API shows it: text/select as string, date as YYYY-MM-DD. */
export const propertyValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type PropertyValue = z.infer<typeof propertyValueSchema>

export const contactSchema = z.object({
  id: idSchema,
  phoneE164: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  language: z.string().nullable(),
  country: z.string().nullable(),
  source: z.enum(CONTACT_SOURCES),
  status: z.enum(CONTACT_STATUSES),
  ownerId: z.string().nullable(),
  waProfileName: z.string().nullable(),
  marketingConsent: z.enum(CONSENT_STATES),
  utilityConsent: z.enum(CONSENT_STATES),
  tags: z.array(tagSchema),
  properties: z.record(z.string(), propertyValueSchema),
  lastInboundAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Contact = z.infer<typeof contactSchema>

const consentInput = z.object({
  purpose: z.enum(['MARKETING', 'UTILITY']),
  status: z.enum(['GRANTED', 'REVOKED']),
  /** How the business obtained it; required when granting (docs/CONTACTS_AND_CONSENT.md). */
  source: z.enum(['MANUAL', 'FORM', 'API']),
  note: z.string().trim().max(500).optional(),
})

const contactFields = {
  name: z.string().trim().max(120).nullable(),
  email: emailSchema.nullable(),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Use a language code such as en or pt-BR.')
    .nullable(),
  country: z.string().trim().length(2).toUpperCase().nullable(),
  ownerId: idSchema.nullable(),
  properties: z.record(z.string().regex(PROPERTY_KEY_RE), propertyValueSchema),
}

export const createContactRequestSchema = z
  .object({
    phone: z.string().trim().min(3).max(40),
    tagIds: z.array(idSchema).max(50).optional(),
    consents: z.array(consentInput).max(2).optional(),
  })
  .extend(z.object(contactFields).partial().shape)
export type CreateContactRequest = z.infer<typeof createContactRequestSchema>

export const updateContactRequestSchema = z
  .object({
    ...contactFields,
    status: z.enum(CONTACT_STATUSES),
    phone: z.string().trim().min(3).max(40),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field.')
export type UpdateContactRequest = z.infer<typeof updateContactRequestSchema>

export const CONTACT_SORT_FIELDS = ['createdAt', 'name', 'lastInboundAt'] as const
export const searchContactsRequestSchema = z.object({
  filter: contactFilterSchema.optional(),
  q: z.string().trim().max(120).optional(),
  sort: z
    .object({ field: z.enum(CONTACT_SORT_FIELDS), direction: z.enum(['asc', 'desc']) })
    .default({ field: 'createdAt', direction: 'desc' }),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
})
export type SearchContactsRequest = z.infer<typeof searchContactsRequestSchema>
export const countContactsRequestSchema = z.object({
  filter: contactFilterSchema.optional(),
  q: z.string().trim().max(120).optional(),
})

export const bulkContactsRequestSchema = z
  .object({
    action: z.enum(['TAG', 'UNTAG', 'DELETE']),
    contactIds: z.array(idSchema).min(1).max(1000).optional(),
    filter: contactFilterSchema.optional(),
    tagId: idSchema.optional(),
  })
  .refine((v) => Boolean(v.contactIds) !== Boolean(v.filter), 'Send either contactIds or filter.')
  .refine((v) => v.action === 'DELETE' || Boolean(v.tagId), 'tagId is required to tag or untag.')
export type BulkContactsRequest = z.infer<typeof bulkContactsRequestSchema>

// Consent ------------------------------------------------------------------------------------
export const consentRecordSchema = z.object({
  id: idSchema,
  purpose: z.enum(CONSENT_PURPOSES),
  status: z.enum(['GRANTED', 'REVOKED']),
  source: z.enum(CONSENT_SOURCES),
  capturedAt: z.string(),
  revokedAt: z.string().nullable(),
  revokeSource: z.enum(CONSENT_SOURCES).nullable(),
  evidence: z.record(z.string(), z.unknown()),
})
export type ConsentRecord = z.infer<typeof consentRecordSchema>
export const changeConsentRequestSchema = z.object({
  purpose: z.enum(['MARKETING', 'UTILITY']),
  status: z.enum(['GRANTED', 'REVOKED']),
  note: z.string().trim().min(3, 'Say why (at least a few words).').max(500),
})

// Notes and activities -----------------------------------------------------------------------
export const contactNoteSchema = z.object({
  id: idSchema,
  body: z.string(),
  authorId: idSchema,
  authorName: z.string(),
  createdAt: z.string(),
})
export type ContactNote = z.infer<typeof contactNoteSchema>
export const createNoteRequestSchema = z.object({ body: z.string().trim().min(1).max(5000) })

export const contactActivitySchema = z.object({
  id: idSchema,
  type: z.string(),
  actorType: z.enum(['USER', 'API_KEY', 'SYSTEM', 'PLATFORM_OPERATOR']),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  occurredAt: z.string(),
})
export type ContactActivity = z.infer<typeof contactActivitySchema>

// Custom properties --------------------------------------------------------------------------
export const MAX_PROPERTY_DEFINITIONS = 100
export const propertyDefinitionSchema = z.object({
  id: idSchema,
  key: z.string(),
  label: z.string(),
  type: z.enum(PROPERTY_TYPES),
  options: z.array(z.string()).nullable(),
  required: z.boolean(),
  archived: z.boolean(),
  createdAt: z.string(),
})
export type PropertyDefinition = z.infer<typeof propertyDefinitionSchema>
export const createPropertyRequestSchema = z
  .object({
    key: z.string().regex(PROPERTY_KEY_RE, 'Use lowercase letters, digits and underscores.'),
    label: z.string().trim().min(1).max(60),
    type: z.enum(PROPERTY_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).min(1).max(100).optional(),
    required: z.boolean().default(false),
  })
  .refine((v) => (v.type === 'SELECT') === Boolean(v.options), {
    path: ['options'],
    message: 'SELECT properties need options (and only they do).',
  })
export const updatePropertyRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    options: z.array(z.string().trim().min(1).max(60)).min(1).max(100),
    required: z.boolean(),
    archived: z.boolean(),
  })
  .partial()

// Segments -----------------------------------------------------------------------------------
export const segmentSchema = z.object({
  id: idSchema,
  name: z.string(),
  filter: contactFilterSchema,
  cachedCount: z.number().int().nullable(),
  cachedCountAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Segment = z.infer<typeof segmentSchema>
export const createSegmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filter: contactFilterSchema,
})
export const updateSegmentRequestSchema = createSegmentRequestSchema.partial()

// Imports ------------------------------------------------------------------------------------
export const MAX_IMPORT_ROWS = 100_000
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024
export const IMPORT_STATUSES = [
  'UPLOADED',
  'MAPPING',
  'VALIDATING',
  'PREVIEW_READY',
  'IMPORTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]
/** Where a CSV column goes: a core field, tags, marketing consent, a property, or nowhere. */
export const importTargetSchema = z.union([
  z.enum(['name', 'phone', 'email', 'language', 'country', 'tags', 'consent.marketing', 'ignore']),
  z.string().regex(/^property\.[a-z][a-z0-9_]{0,62}$/),
])
export type ImportTarget = z.infer<typeof importTargetSchema>

export const importRowErrorSchema = z.object({
  row: z.number().int(),
  field: z.string().nullable(),
  code: z.string(),
  message: z.string(),
})
export const importJobSchema = z.object({
  id: idSchema,
  status: z.enum(IMPORT_STATUSES),
  filename: z.string().nullable(),
  headers: z.array(z.string()),
  suggestedMapping: z.record(z.string(), importTargetSchema),
  columnMapping: z.record(z.string(), importTargetSchema).nullable(),
  duplicatePolicy: z.enum(['SKIP', 'UPDATE']),
  defaultConsent: z.object({ marketing: z.enum(['GRANTED', 'REVOKED']).optional() }).nullable(),
  counts: z.object({
    total: z.number().int(),
    valid: z.number().int(),
    invalid: z.number().int(),
    new: z.number().int(),
    existing: z.number().int(),
    processed: z.number().int(),
    created: z.number().int(),
    updated: z.number().int(),
    skipped: z.number().int(),
  }),
  preview: z
    .array(
      z.object({
        row: z.number().int(),
        values: z.record(z.string(), z.string()),
        errors: z.array(importRowErrorSchema),
      }),
    )
    .nullable(),
  hasErrorReport: z.boolean(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})
export type ImportJob = z.infer<typeof importJobSchema>
export const importUploadRequestSchema = z.object({
  mimeType: z.string().min(3).max(127),
  sizeBytes: z.number().int().min(1).max(MAX_IMPORT_BYTES),
  filename: z.string().max(240).optional(),
})
export const createImportRequestSchema = z.object({ fileId: idSchema })
export const configureImportRequestSchema = z.object({
  columnMapping: z.record(z.string().max(200), importTargetSchema),
  duplicatePolicy: z.enum(['SKIP', 'UPDATE']).default('SKIP'),
  defaultConsent: z
    .object({ marketing: z.enum(['GRANTED', 'REVOKED']).optional() })
    .nullable()
    .optional(),
  suppressAutomations: z.boolean().default(true),
})
export type ConfigureImportRequest = z.infer<typeof configureImportRequestSchema>

// Exports ------------------------------------------------------------------------------------
export const exportJobSchema = z.object({
  id: idSchema,
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED']),
  rowCount: z.number().int().nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
})
export type ExportJob = z.infer<typeof exportJobSchema>
export const createExportRequestSchema = z.object({
  filter: contactFilterSchema.optional(),
  q: z.string().trim().max(120).optional(),
})

// Workspace consent settings -----------------------------------------------------------------
export const consentSettingsSchema = z.object({
  optOutKeywords: z.array(z.string().trim().min(1).max(40)).max(20),
  optInKeywords: z.array(z.string().trim().min(1).max(40)).max(20),
  optOutReply: z.string().trim().max(1000).nullable(),
})
export type ConsentSettings = z.infer<typeof consentSettingsSchema>

/**
 * What MessageEligibilityService would allow for this contact right now (read-only; the service
 * stays the only decider, decision C1). Shown in the inbox and on the contact profile.
 */
export const eligibilityVerdictSchema = z.object({
  allowed: z.boolean(),
  /** Error code the send would get (CONSENT_REQUIRED, CONVERSATION_WINDOW_CLOSED, …). */
  code: z.string().nullable(),
  reason: z.string().nullable(),
  optedOut: z.boolean(),
})
export type EligibilityVerdict = z.infer<typeof eligibilityVerdictSchema>
export const contactEligibilitySchema = z.object({
  marketingTemplate: eligibilityVerdictSchema,
  utilityTemplate: eligibilityVerdictSchema,
  /** Free-form (non-template) messages in the conversation's 24-hour window. */
  freeform: eligibilityVerdictSchema,
  serviceWindowExpiresAt: z.string().nullable(),
})
export type ContactEligibility = z.infer<typeof contactEligibilitySchema>
