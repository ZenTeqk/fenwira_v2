import { z } from 'zod'

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`)
    this.name = 'EnvValidationError'
  }
}

/** Parses `source` (default: process.env) against `schema`; throws one readable error listing every problem. */
export function loadEnv<S extends z.ZodType>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source)
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    )
  }
  return result.data
}

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const postgresUrl = z
  .string()
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// or postgresql:// URL')

const redisUrl = z.string().refine((v) => /^rediss?:\/\//.test(v), 'must be a redis:// URL')

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_VERSION: z.string().min(1).default('dev'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export const apiEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: postgresUrl,
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: redisUrl,
  /** Enables POST /api/v1/system/ping (unauthenticated end-to-end probe). Never enable in production. */
  SYSTEM_PING_ENABLED: booleanString.default(false),
})
export type ApiEnv = z.infer<typeof apiEnvSchema>

export const workerEnvSchema = baseEnvSchema.extend({
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),
  DATABASE_URL: postgresUrl,
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: redisUrl,
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(250),
})
export type WorkerEnv = z.infer<typeof workerEnvSchema>

export const migrateEnvSchema = baseEnvSchema.extend({
  MIGRATION_DATABASE_URL: postgresUrl,
})
export type MigrateEnv = z.infer<typeof migrateEnvSchema>
