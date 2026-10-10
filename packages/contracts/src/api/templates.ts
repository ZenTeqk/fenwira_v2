import { z } from 'zod'
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_STATUSES,
  templateComponentsSchema,
  templateDraftSchema,
  templateVariablesSchema,
  variableSamplesSchema,
} from '../templates/components'
import { idSchema } from './common'

/** Template API shapes (docs/API_SPEC.md → Templates, docs/TEMPLATE_ENGINE.md). */

export const templateVersionSchema = z.object({
  id: idSchema,
  version: z.number().int(),
  status: z.enum(TEMPLATE_STATUSES),
  components: templateComponentsSchema,
  samples: variableSamplesSchema,
  metaTemplateId: z.string().nullable(),
  /** META when the content came from a sync (edited outside Fenwira). */
  origin: z.enum(['FENWIRA', 'META']),
  rejectionReason: z.string().nullable(),
  lastError: z.string().nullable(),
  qualityScore: z.string().nullable(),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type TemplateVersion = z.infer<typeof templateVersionSchema>

export const templateSchema = z.object({
  id: idSchema,
  wabaId: idSchema,
  wabaName: z.string(),
  name: z.string(),
  language: z.string(),
  category: z.enum(TEMPLATE_CATEGORIES),
  status: z.enum(TEMPLATE_STATUSES),
  qualityScore: z.string().nullable(),
  currentVersion: templateVersionSchema,
  approvedVersionId: idSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Template = z.infer<typeof templateSchema>

/** A picker entry: the APPROVED version a send will use. */
export const approvedTemplateSchema = z.object({
  templateId: idSchema,
  versionId: idSchema,
  wabaId: idSchema,
  name: z.string(),
  language: z.string(),
  category: z.enum(TEMPLATE_CATEGORIES),
  components: templateComponentsSchema,
  samples: variableSamplesSchema,
})
export type ApprovedTemplate = z.infer<typeof approvedTemplateSchema>

export const templatesQuerySchema = z.object({
  status: z.enum(TEMPLATE_STATUSES).optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  language: z.string().max(15).optional(),
  wabaId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
})
export const approvedTemplatesQuerySchema = z.object({
  language: z.string().max(15).optional(),
  /** Only templates of the WABA this phone number (row id) belongs to. */
  phoneNumberId: idSchema.optional(),
})

export const createTemplateSchema = templateDraftSchema.extend({ wabaId: idSchema })
export type CreateTemplate = z.infer<typeof createTemplateSchema>
/** Edits the current DRAFT version. Name, language and category only before the first submit. */
export const updateTemplateSchema = templateDraftSchema.partial()
export type UpdateTemplate = z.infer<typeof updateTemplateSchema>

/** A WhatsApp Business Account templates can be created on (Fenwira row id). */
export const templateAccountSchema = z.object({
  id: idSchema,
  name: z.string(),
  metaWabaId: z.string(),
})
export type TemplateAccount = z.infer<typeof templateAccountSchema>

/** Header sample upload (JPEG/PNG, MP4 or PDF within Meta's limits; checked by the API). */
export const templateSampleUploadSchema = z.object({
  mimeType: z.string().min(3).max(127),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024),
  filename: z.string().max(240).optional(),
})

export { templateVariablesSchema }
