import { type PipeTransform } from '@nestjs/common'
import { type z } from 'zod'
import { AppError } from './app-error'
import { plainFieldErrors } from '@fenwira/contracts'

/** Validates a param/body/query with a schema from @fenwira/contracts (ADR-0003). */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    // PostgreSQL text and jsonb cannot store U+0000; letting it through surfaced as a 500.
    const nul = nulPath(value)
    if (nul !== null) {
      throw AppError.validation([
        {
          path: nul,
          code: 'invalid_string',
          message: 'Text must not contain NUL (U+0000) characters.',
        },
      ])
    }
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw AppError.validation(plainFieldErrors(result.error.issues))
    }
    return result.data
  }
}

/** Path of the first string (or object key) containing U+0000, or null when there is none. */
export function nulPath(value: unknown, path: string[] = [], depth = 0): string | null {
  if (typeof value === 'string') return value.includes('\u0000') ? path.join('.') : null
  if (depth > 32 || value === null || typeof value !== 'object') return null
  for (const [key, child] of Object.entries(value)) {
    if (key.includes('\u0000')) return [...path, key].join('.')
    const found = nulPath(child, [...path, key], depth + 1)
    if (found !== null) return found
  }
  return null
}
