import { type ErrorCode, type ErrorEnvelope } from '@fenwira/contracts'
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common'
import { type Request, type Response } from 'express'
import { PinoLogger } from 'nestjs-pino'
import { ZodError } from 'zod'
import { Database } from '@fenwira/database'
import { MetricsService } from '../metrics/metrics.service'
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
  const bodyError = bodyParserError(exception)
  if (bodyError) {
    return {
      status: bodyError.status,
      body: {
        error: {
          code: STATUS_TO_CODE[bodyError.status] ?? 'VALIDATION_FAILED',
          message: bodyError.message,
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

/**
 * Express body-parser rejects requests before Nest sees them (too large, malformed JSON, unsupported
 * charset/encoding, aborted). Its errors are not HttpExceptions; without this they surfaced as 500s.
 * The client-safe status is kept; the message is fixed (parse errors can quote the request body).
 */
function bodyParserError(e: unknown): { status: number; message: string } | null {
  if (typeof e !== 'object' || e === null) return null
  const { type, status, expose } = e as { type?: unknown; status?: unknown; expose?: unknown }
  if (typeof type !== 'string' || typeof status !== 'number' || expose !== true) return null
  if (status < 400 || status > 499) return null
  const messages: Record<string, string> = {
    'entity.too.large': 'The request body is too large.',
    'entity.parse.failed': 'The request body is not valid JSON.',
    'entity.verify.failed': 'The request body could not be verified.',
    'request.aborted': 'The request was aborted.',
    'request.size.invalid': 'The request body size does not match its Content-Length.',
  }
  return { status, message: messages[type] ?? 'The request body could not be read.' }
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
  constructor(
    private readonly logger: PinoLogger,
    @Inject(Database) private readonly db: Database,
    private readonly metrics: MetricsService,
  ) {
    this.logger.setContext('AllExceptionsFilter')
  }

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const res = host.switchToHttp().getResponse<Response>()
    const correlationId = requestContext.correlationId() ?? 'unknown'
    const { status, body } = toErrorEnvelope(exception, correlationId)
    const req = host.switchToHttp().getRequest<Request>()
    const platform = req.path.startsWith('/api/v1/platform/')
    if (platform && !requestContext.get()?.platformFailureAudited) {
      const ctx = requestContext.get()
      this.metrics.platformEvents.inc({
        action: 'platform.request_failed',
        outcome: body.error.code,
      })
      try {
        await this.db.withGlobal((tx) =>
          tx.platformAudit.createMany({
            data: {
              operatorId: ctx?.platform?.operatorId,
              action: 'platform.request_failed',
              outcome: body.error.code,
              correlationId,
              details: { method: req.method, route: req.route?.path ?? 'unmatched' },
            },
          }),
        )
      } catch {
        this.logger.error(
          { code: 'PLATFORM_AUDIT_UNAVAILABLE', correlationId },
          'platform failure audit unavailable',
        )
      }
    }
    const retryAfter = body.error.details?.retryAfter
    if (status === 429 && typeof retryAfter === 'number')
      res.setHeader('Retry-After', String(retryAfter))
    if (status >= 500)
      this.logger.error(
        platform ? { code: body.error.code } : { err: exception, code: body.error.code },
        'request failed',
      )
    res.status(status).json(body)
  }
}
