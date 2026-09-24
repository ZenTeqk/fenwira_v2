import { type ErrorCode, type ErrorEnvelope } from '@fenwira/contracts'
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { type Response } from 'express'
import { PinoLogger } from 'nestjs-pino'
import { ZodError } from 'zod'
import { requestContext } from '../context/request-context'
import { AppError } from './app-error'

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  502: 'UPSTREAM_UNAVAILABLE',
  503: 'UPSTREAM_UNAVAILABLE',
}

export function toErrorEnvelope(
  exception: unknown,
  correlationId: string,
): { status: number; body: ErrorEnvelope } {
  if (exception instanceof AppError) {
    return {
      status: exception.status,
      body: {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
          ...(exception.fieldErrors ? { fieldErrors: exception.fieldErrors } : {}),
          correlationId,
        },
      },
    }
  }
  if (exception instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The request is invalid.',
          fieldErrors: exception.issues.map((i) => ({
            path: i.path.join('.'),
            code: i.code,
            message: i.message,
          })),
          correlationId,
        },
      },
    }
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus()
    const code = STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED')
    // Only framework messages for client errors; never echo internals for 5xx.
    const message = status < 500 ? exception.message : 'An unexpected error occurred.'
    return { status, body: { error: { code, message, correlationId } } }
  }
  if (isDependencyOutage(exception)) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      body: {
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'A required service is temporarily unavailable. Please try again.',
          correlationId,
        },
      },
    }
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { error: { code: 'INTERNAL', message: 'An unexpected error occurred.', correlationId } },
  }
}

/** Redis/Postgres connectivity failures are outages (503), not bugs (500). */
export function isDependencyOutage(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const text = `${err.name} ${err.message}`
  return /MaxRetriesPerRequestError|Command timed out|Connection is closed|Stream isn't writeable|ECONNREFUSED|Can't reach database server|P1001|P1017/.test(
    text,
  )
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('AllExceptionsFilter')
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>()
    const correlationId = requestContext.correlationId() ?? 'unknown'
    const { status, body } = toErrorEnvelope(exception, correlationId)
    const retryAfter = body.error.details?.retryAfter
    if (status === 429 && typeof retryAfter === 'number')
      res.setHeader('Retry-After', String(retryAfter))
    if (status >= 500)
      this.logger.error({ err: exception, code: body.error.code }, 'request failed')
    res.status(status).json(body)
  }
}
