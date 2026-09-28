import 'server-only'
import { z } from 'zod'

/** Server-side env for the web tier. It holds no secrets (docs/ARCHITECTURE.md). */
const serverEnvSchema = z.object({
  API_INTERNAL_URL: z.url().default('http://fenwira-api:4000'),
  /** Public URL of the web app: absolute links in link previews (Open Graph images). */
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
})

export const serverEnv = serverEnvSchema.parse({
  API_INTERNAL_URL: process.env.API_INTERNAL_URL,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
})
