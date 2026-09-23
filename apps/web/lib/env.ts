import 'server-only'
import { z } from 'zod'

/** Server-side env for the web tier. It holds no secrets (docs/ARCHITECTURE.md). */
const serverEnvSchema = z.object({
  API_INTERNAL_URL: z.url().default('http://fenwira-api:4000'),
})

export const serverEnv = serverEnvSchema.parse({ API_INTERNAL_URL: process.env.API_INTERNAL_URL })
