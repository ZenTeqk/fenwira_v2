import { type PipeTransform } from '@nestjs/common'
import { type z } from 'zod'
import { AppError } from './app-error'

/** Validates a param/body/query with a schema from @fenwira/contracts (ADR-0003). */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw AppError.validation(
        result.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      )
    }
    return result.data
  }
}
