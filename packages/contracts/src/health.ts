import { z } from 'zod'

export const healthCheckResultSchema = z.object({
  status: z.enum(['up', 'down']),
  latencyMs: z.number().nonnegative().optional(),
  error: z.string().optional(),
})
export type HealthCheckResult = z.infer<typeof healthCheckResultSchema>

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  service: z.enum(['api', 'worker', 'web']),
  version: z.string(),
  checks: z.record(z.string(), healthCheckResultSchema),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>
