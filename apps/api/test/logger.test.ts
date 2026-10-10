import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { requestContext } from '../src/core/context/request-context'
import { createRootLogger } from '../src/core/logging/logger'
import { pathOnly } from '../src/core/logging/logging.module'

function capture() {
  const lines: Array<Record<string, unknown>> = []
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>)
      cb()
    },
  })
  const logger = createRootLogger(
    { service: 'api', version: 't', nodeEnv: 'test', logLevel: 'info' },
    stream,
  )
  return { lines, logger }
}

describe('root logger', () => {
  it('excludes invitation path credentials and query credentials from access logs', () => {
    expect(
      pathOnly('/api/v1/invitations/live-invitation-credential/accept?token=query-secret'),
    ).toBe('/api/v1/invitations/[REDACTED]/accept')
    expect(pathOnly('/api/v1/invitations/live-invitation-credential')).toBe(
      '/api/v1/invitations/[REDACTED]',
    )
    expect(pathOnly('/API/V1/INVITATIONS/live-invitation-credential/accept')).toBe(
      '/API/V1/INVITATIONS/[REDACTED]/accept',
    )
    expect(pathOnly('/api/v1/platform/auth/me?token=query-secret')).toBe('/api/v1/platform/auth/me')
  })
  it('emits base fields and the level label', () => {
    const { lines, logger } = capture()
    logger.info('hello')
    expect(lines[0]).toMatchObject({
      msg: 'hello',
      level: 'info',
      service: 'api',
      env: 'test',
      version: 't',
    })
  })

  it('adds correlation, tenant and job context from async storage', () => {
    const { lines, logger } = capture()
    requestContext.run(
      { correlationId: 'corr-1', tenantId: 't-1', jobId: 'j1', queue: 'system.ping' },
      () => logger.info('in context'),
    )
    logger.info('outside')
    expect(lines[0]).toMatchObject({
      correlationId: 'corr-1',
      tenantId: 't-1',
      jobId: 'j1',
      queue: 'system.ping',
    })
    expect(lines[1]).not.toHaveProperty('correlationId')
  })

  it('redacts secrets and PII fields', () => {
    const { lines, logger } = capture()
    logger.info(
      {
        user: { email: 'a@b.c', password: 'pw-secret' },
        message: { text: 'hello-body', phone: '+919999999999' },
        meta: { token: 'tok-secret' },
      },
      'x',
    )
    const serialized = JSON.stringify(lines[0])
    for (const leaked of ['a@b.c', '+919999999999', 'hello-body', 'pw-secret', 'tok-secret'])
      expect(serialized).not.toContain(leaked)
    expect(serialized.match(/\[REDACTED\]/g)).toHaveLength(5)
  })
})
