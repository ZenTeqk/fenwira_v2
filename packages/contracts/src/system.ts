import { z } from 'zod'

export const systemPingAcceptedSchema = z.object({
  eventId: z.uuid(),
  correlationId: z.string(),
})
export type SystemPingAccepted = z.infer<typeof systemPingAcceptedSchema>

export const systemPingStatusSchema = z.object({
  eventId: z.uuid(),
  status: z.enum(['PENDING', 'PROCESSED']),
  processedAt: z.iso.datetime({ offset: true }).optional(),
  correlationId: z.string().optional(),
})
export type SystemPingStatus = z.infer<typeof systemPingStatusSchema>
