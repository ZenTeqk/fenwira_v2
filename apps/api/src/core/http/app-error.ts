import { type ErrorCode, type FieldError } from '@fenwira/contracts'

/** Domain/API error rendered as the standard envelope (docs/API_SPEC.md → Errors). */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly fieldErrors?: FieldError[],
  ) {
    super(message)
    this.name = 'AppError'
  }

  static notFound(message = 'Resource not found.'): AppError {
    return new AppError('NOT_FOUND', 404, message)
  }

  static validation(fieldErrors: FieldError[], message = 'The request is invalid.'): AppError {
    return new AppError('VALIDATION_FAILED', 400, message, undefined, fieldErrors)
  }
}
