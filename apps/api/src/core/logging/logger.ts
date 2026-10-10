import pino, { type DestinationStream, type Logger } from 'pino'
import { requestContext } from '../context/request-context'
import { type CoreConfig } from '../config/core-config'

/**
 * Central redaction list (docs/SECURITY.md → PII and logging, docs/OBSERVABILITY.md).
 * pino wildcards match one path segment; add explicit keys rather than broad patterns.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.access_token',
  '*.input_token',
  '*.tokenCiphertext',
  'token',
  'accessToken',
  'access_token',
  '*.refreshToken',
  '*.secret',
  '*.appSecret',
  '*.code',
  '*.pin',
  '*.phone',
  '*.phoneE164',
  '*.email',
  '*.text',
  '*.body',
  '*.content',
  '*.variables',
]

export function createRootLogger(
  config: Pick<CoreConfig, 'service' | 'version' | 'nodeEnv' | 'logLevel'>,
  destination?: DestinationStream,
): Logger {
  const options: pino.LoggerOptions = {
    level: config.logLevel,
    base: { service: config.service, env: config.nodeEnv, version: config.version },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    mixin() {
      const ctx = requestContext.get()
      if (!ctx) return {}
      const fields: Record<string, unknown> = { correlationId: ctx.correlationId }
      if (ctx.tenantId) fields.tenantId = ctx.tenantId
      if (ctx.userId) fields.userId = ctx.userId
      if (ctx.jobId) fields.jobId = ctx.jobId
      if (ctx.queue) fields.queue = ctx.queue
      return fields
    },
  }
  return destination ? pino(options, destination) : pino(options)
}
