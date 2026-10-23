import { z } from 'zod'

/**
 * Marketing-site Request access (POST /api/v1/public/request-access). The volume options must
 * match fenwira_marketing src/components/company-pages.tsx. `website` is a honeypot: people never
 * see it, so any value means a bot and the API answers 200 without storing anything.
 */
export const ACCESS_REQUEST_VOLUMES = [
  'Under 1,000 messages a month',
  '1,000–10,000 messages a month',
  '10,000–100,000 messages a month',
  'Over 100,000 messages a month',
  'Not sure yet',
] as const

// Single-line text: no control characters (keeps email headers and the console list clean).
const line = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u)

export const accessRequestSchema = z.strictObject({
  name: line(2, 100),
  company: line(2, 200),
  email: z.email().max(254),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/),
  volume: z.enum(ACCESS_REQUEST_VOLUMES),
  website: z.string().max(200).optional(),
})
export type AccessRequestInput = z.infer<typeof accessRequestSchema>

export const accessRequestStatusSchema = z.enum([
  'QUEUED',
  'EMAILED',
  'EMAIL_FAILED',
  'EMAIL_SKIPPED',
])

/** Operator console list item (GET /api/v1/platform/access-requests). */
export const accessRequestItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  company: z.string(),
  email: z.string(),
  phone: z.string(),
  volume: z.string(),
  status: accessRequestStatusSchema,
  createdAt: z.string(),
})
export type AccessRequestItem = z.infer<typeof accessRequestItemSchema>
