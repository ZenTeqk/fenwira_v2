import { z } from 'zod'

export const idSchema = z.uuid()
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.trim().toLowerCase())
/** docs/SECURITY.md → Passwords: 10–128 chars, no composition rules. */
export const passwordSchema = z.string().min(10, 'Use at least 10 characters.').max(128)

export const pageSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  limit: z.number().int(),
})
export type Page = z.infer<typeof pageSchema>

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
})

/** `{ data }` envelope for single resources (docs/API_SPEC.md → Responses). */
export const dataOf = <T extends z.ZodType>(schema: T) => z.object({ data: schema })
/** `{ data, page }` envelope for lists. */
export const listOf = <T extends z.ZodType>(schema: T) =>
  z.object({ data: z.array(schema), page: pageSchema })
