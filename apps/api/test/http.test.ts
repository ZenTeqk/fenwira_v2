import { HttpException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../src/core/http/app-error'
import { resolveCorrelationId } from '../src/core/http/correlation.middleware'
import { toErrorEnvelope } from '../src/core/http/exception.filter'
import { ZodValidationPipe } from '../src/core/http/zod-validation.pipe'

describe('resolveCorrelationId', () => {
  it('keeps a safe client-supplied id', () => {
    expect(resolveCorrelationId('0192a8f0-0000-7000-8000-000000000000')).toBe(
      '0192a8f0-0000-7000-8000-000000000000',
    )
    expect(resolveCorrelationId('abc.DEF_123:x')).toBe('abc.DEF_123:x')
  })

  it('replaces missing, oversized or unsafe ids with a new UUIDv7', () => {
    for (const bad of [undefined, '', 'a'.repeat(65), 'has space', '<script>', 'line\nbreak']) {
      const id = resolveCorrelationId(bad)
      expect(id).not.toBe(bad)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })
})

describe('toErrorEnvelope', () => {
  it('renders AppError as-is', () => {
    const { status, body } = toErrorEnvelope(
      new AppError('CONFLICT', 409, 'Already exists', { id: '1' }),
      'c1',
    )
    expect(status).toBe(409)
    expect(body).toEqual({
      error: {
        code: 'CONFLICT',
        message: 'Already exists',
        details: { id: '1' },
        correlationId: 'c1',
      },
    })
  })

  it('maps framework HttpExceptions to catalog codes', () => {
    expect(toErrorEnvelope(new NotFoundException(), 'c').body.error.code).toBe('NOT_FOUND')
    expect(toErrorEnvelope(new HttpException('slow down', 429), 'c').body.error.code).toBe(
      'RATE_LIMITED',
    )
  })

  it('keeps body-parser client errors as 4xx with fixed messages (never 500, never the body)', () => {
    const parserError = (status: number, type: string, message: string) =>
      Object.assign(new Error(message), { status, statusCode: status, expose: true, type })
    const tooLarge = toErrorEnvelope(parserError(413, 'entity.too.large', 'too large'), 'c')
    expect(tooLarge.status).toBe(413)
    expect(tooLarge.body.error).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'The request body is too large.',
      correlationId: 'c',
    })
    const badJson = toErrorEnvelope(
      parserError(400, 'entity.parse.failed', 'Unexpected token s in JSON: "secret-body"'),
      'c',
    )
    expect(badJson.status).toBe(400)
    expect(JSON.stringify(badJson.body)).not.toContain('secret-body')
    expect(toErrorEnvelope(parserError(415, 'encoding.unsupported', 'x'), 'c').status).toBe(415)
    // Not exposed or not a client error: still an opaque 500.
    expect(
      toErrorEnvelope(Object.assign(new Error('x'), { type: 'y', status: 413 }), 'c').status,
    ).toBe(500)
  })

  it('never leaks internal messages for 5xx or unknown errors', () => {
    const unknown = toErrorEnvelope(new Error('db password is hunter2'), 'c')
    expect(unknown.status).toBe(500)
    expect(unknown.body.error).toEqual({
      code: 'INTERNAL',
      message: 'An unexpected error occurred.',
      correlationId: 'c',
    })
    const http500 = toErrorEnvelope(new HttpException('stack trace here', 500), 'c')
    expect(http500.body.error.message).toBe('An unexpected error occurred.')
  })

  it('maps dependency outages to 503 UPSTREAM_UNAVAILABLE, not 500', () => {
    const redis = toErrorEnvelope(new Error('Command timed out'), 'c')
    expect(redis.status).toBe(503)
    expect(redis.body.error.code).toBe('UPSTREAM_UNAVAILABLE')
    expect(toErrorEnvelope(new Error("Can't reach database server at db:5432"), 'c').status).toBe(
      503,
    )
    expect(toErrorEnvelope(new Error('TypeError: x is undefined'), 'c').status).toBe(500)
  })

  it('turns ZodErrors into VALIDATION_FAILED with field errors', () => {
    const err = z.object({ name: z.string() }).safeParse({ name: 1 }).error!
    const { status, body } = toErrorEnvelope(err, 'c')
    expect(status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.fieldErrors?.[0]?.path).toBe('name')
  })
})

describe('ZodValidationPipe', () => {
  it('passes valid values through and rejects invalid ones as AppError', () => {
    const pipe = new ZodValidationPipe(z.uuid())
    expect(pipe.transform('0192a8f0-0000-7000-8000-000000000000')).toBe(
      '0192a8f0-0000-7000-8000-000000000000',
    )
    expect(() => pipe.transform('nope')).toThrow(AppError)
  })
})
