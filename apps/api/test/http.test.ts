import { HttpException, NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../src/core/http/app-error'
import { resolveCorrelationId } from '../src/core/http/correlation.middleware'
import { toErrorEnvelope } from '../src/core/http/exception.filter'
import { nulPath, ZodValidationPipe } from '../src/core/http/zod-validation.pipe'

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

describe('ZodValidationPipe NUL guard', () => {
  it('refuses U+0000 anywhere in the input with a field path, before the schema runs', () => {
    const pipe = new ZodValidationPipe(z.unknown())
    expect(() => pipe.transform({ a: [{ b: 'x\u0000y' }] })).toThrow(AppError)
    try {
      pipe.transform({ a: [{ b: 'x\u0000y' }] })
    } catch (e) {
      expect((e as AppError).status).toBe(400)
      expect((e as AppError).fieldErrors?.[0]?.path).toBe('a.0.b')
    }
    expect(nulPath({ ['k\u0000']: 1 })).toBe('k\u0000')
    expect(nulPath('plain')).toBeNull()
    expect(pipe.transform({ text: 'Zoë 🚀 \u202E' })).toEqual({ text: 'Zoë 🚀 \u202E' })
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
        hint: 'Refresh the page to see the latest state, then try again.',
        correlationId: 'c1',
        requestId: 'c1',
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
      hint: 'Check the request size and format, then try again.',
      correlationId: 'c',
      requestId: 'c',
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
      message: 'Something went wrong on our side.',
      hint: 'Try again. If it keeps happening, share the request ID with Fenwira support.',
      correlationId: 'c',
      requestId: 'c',
    })
    const http500 = toErrorEnvelope(new HttpException('stack trace here', 500), 'c')
    expect(http500.body.error.message).toBe('Something went wrong on our side.')
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

describe('plain-English error envelope', () => {
  const SECRETS = [
    'postgres://fenwira_owner:hunter2@db.internal:5432/fenwira',
    'EAAGm0PX4ZCpsBAJZCZBexampletoken1234567890',
    'hunter2',
    'SELECT * FROM users',
    'at Object.<anonymous> (/opt/fenwira/app.js:1:1)',
  ]
  const raw = [
    new Error(`connect failed ${SECRETS[0]} ${SECRETS[3]}`),
    Object.assign(new Error(`Graph ${SECRETS[1]}`), { stack: SECRETS[4] }),
    new HttpException(`boom ${SECRETS[2]}`, 500),
    new TypeError(`x is undefined ${SECRETS[4]}`),
  ]

  it('never returns secrets, SQL, stacks, Zod dumps or "Internal error"', () => {
    for (const e of raw) {
      const text = JSON.stringify(toErrorEnvelope(e, 'req-1').body)
      for (const secret of SECRETS) expect(text).not.toContain(secret)
      expect(text).not.toMatch(/internal error/i)
      expect(text).toContain('"requestId":"req-1"')
    }
  })

  it('every response has code, message, hint and requestId', () => {
    for (const e of [...raw, new NotFoundException(), new AppError('TOTP_REQUIRED', 403, 'x')]) {
      const { error } = toErrorEnvelope(e, 'r').body
      expect(error.code).toBeTruthy()
      expect(error.message).toBeTruthy()
      expect(error.hint).toBeTruthy()
      expect(error.requestId).toBe('r')
    }
  })

  it('an expired identity check says what to do', () => {
    const { error } = toErrorEnvelope(
      new AppError('TOTP_REQUIRED', 403, 'Fresh MFA required.'),
      'r',
    ).body
    expect(error.message).toBe('Your identity check has expired.')
    expect(error.hint).toMatch(/Verify your identity/)
    expect(JSON.stringify(error)).not.toMatch(/Commercial operations/)
  })

  it('maps internal-workspace, missing plan/price and UPI cases to a next step', () => {
    const internal = toErrorEnvelope(
      new AppError('UPGRADE_UNAVAILABLE', 409, 'This is an internal workspace; billing is off.'),
      'r',
    ).body.error
    expect(internal.message).toMatch(/internal workspace/)
    expect(internal.hint).toMatch(/Internal workspaces do not need billing/)
    const price = toErrorEnvelope(
      new AppError('PLAN_NOT_PRICED', 422, 'This plan has no price yet. Contact Fenwira.'),
      'r',
    ).body.error
    expect(price.message).toMatch(/no price yet/)
    expect(price.hint).toMatch(/Plans & prices/)
    expect(
      toErrorEnvelope(new AppError('UPI_NOT_CONFIGURED', 422, 'x'), 'r').body.error.hint,
    ).toMatch(/UPI ID/)
    const dup = toErrorEnvelope(new AppError('PHONE_NUMBER_ALREADY_CONNECTED', 409, 'x'), 'r').body
      .error
    expect(dup.message).toMatch(/already connected to another workspace/)
  })

  it.each([
    ['META_TOKEN_INVALID', 'accessToken', /token is invalid or expired/],
    ['META_PERMISSION_DENIED', 'accessToken', /missing WhatsApp permissions/],
    ['META_PHONE_NOT_CONNECTED', 'phoneNumberId', /not registered/],
    ['META_WABA_NOT_GRANTED', 'wabaId', /does not cover this WhatsApp Business Account/],
    ['META_PHONE_NOT_IN_WABA', 'phoneNumberId', /not part of that WhatsApp Business Account/],
    ['META_DISPLAY_NUMBER_MISMATCH', 'displayPhoneNumber', /does not match/],
    ['META_RATE_LIMITED', undefined, /rate-limiting/],
  ])('Meta %s names the field to fix', (reason, field, message) => {
    const { error } = toErrorEnvelope(
      new AppError('WHATSAPP_CONNECT_FAILED', 422, 'Graph: (#190) raw Meta text', {
        step: 'VERIFY',
        reason,
      }),
      'r',
    ).body
    expect(error.message).toMatch(message)
    expect(error.hint).toBeTruthy()
    expect(error.fieldErrors?.map((f) => f.path)).toEqual(field ? [field] : undefined)
  })

  it('validation errors are plain per-field sentences, not Zod output', () => {
    const schema = z
      .object({ name: z.string().min(3), count: z.number().max(5), kind: z.enum(['a', 'b']) })
      .strict()
    const err = schema.safeParse({ name: 'x', count: 9, kind: 'c', extra: 1 }).error!
    const { error } = toErrorEnvelope(err, 'r').body
    expect(error.message).toBe('Some fields need attention.')
    const byPath = Object.fromEntries(error.fieldErrors!.map((f) => [f.path, f.message]))
    expect(byPath).toMatchObject({
      name: 'Must be at least 3 characters.',
      count: 'Must be at most 5.',
      kind: 'Choose one of the allowed options.',
    })
    for (const f of error.fieldErrors!) expect(f.message).not.toMatch(/^(Invalid|Too |Expected)/)
    const missing = z.object({ id: z.string() }).safeParse({}).error!
    expect(toErrorEnvelope(missing, 'r').body.error.fieldErrors?.[0]?.message).toBe(
      'This field is required.',
    )
  })
})
