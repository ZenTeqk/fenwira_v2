import { z } from 'zod'
import { idSchema, listQuerySchema } from './common'

export const auditLogSchema = z.object({
  id: idSchema,
  actorType: z.enum(['USER', 'API_KEY', 'SYSTEM', 'PLATFORM_OPERATOR']),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  changes: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
})
export type AuditLog = z.infer<typeof auditLogSchema>

export const auditQuerySchema = listQuerySchema.extend({
  action: z.string().max(100).optional(),
  actorId: idSchema.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
})
export type AuditQuery = z.infer<typeof auditQuerySchema>
