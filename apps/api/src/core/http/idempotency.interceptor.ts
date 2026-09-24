import { sha256 } from '@fenwira/config'
import { type Prisma } from '@fenwira/database'
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import { type Request, type Response } from 'express'
import { from, lastValueFrom, type Observable } from 'rxjs'
import { requestContext } from '../context/request-context'
import { TenantDb } from '../database/tenant-db'
import { AppError } from './app-error'

const KEY_RE = /^[\x21-\x7e]{8,128}$/
const LOCK_MS = 30_000
const TTL_MS = 24 * 3600 * 1000

/**
 * Idempotency-Key for endpoints marked IK (docs/API_SPEC.md → Idempotency). Tenant-scoped routes
 * only. Same key + same body replays the stored response; a different body → 409
 * IDEMPOTENCY_KEY_REUSED; while the first request runs → 409 IDEMPOTENCY_IN_PROGRESS. Failed
 * requests release the key so the client can retry.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly tenantDb: TenantDb) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>()
    const res = context.switchToHttp().getResponse<Response>()
    const key = req.header('idempotency-key')
    if (!key)
      throw AppError.validation(
        [{ path: 'Idempotency-Key', code: 'required', message: 'Send an Idempotency-Key header.' }],
        'This endpoint requires an Idempotency-Key header.',
      )
    if (!KEY_RE.test(key))
      throw AppError.validation([
        { path: 'Idempotency-Key', code: 'invalid', message: 'Use 8–128 printable characters.' },
      ])
    const routePath = (req.route as { path?: string } | undefined)?.path ?? req.path
    const scope = `${req.method} ${routePath}`
    const requestHash = sha256(
      `${req.originalUrl.split('?')[0]}\n${JSON.stringify(req.body ?? {})}`,
    )
    return from(this.handle(scope, key, requestHash, res, next))
  }

  private async handle(
    scope: string,
    key: string,
    requestHash: Uint8Array<ArrayBuffer>,
    res: Response,
    next: CallHandler,
  ): Promise<unknown> {
    const claim = await this.tenantDb
      .run(async (tx) => {
        const now = new Date()
        const existing = await tx.idempotencyKey.findFirst({ where: { scope, key } })
        if (existing && existing.expiresAt > now) {
          if (!Buffer.from(existing.requestHash).equals(Buffer.from(requestHash)))
            throw new AppError(
              'IDEMPOTENCY_KEY_REUSED',
              409,
              'This Idempotency-Key was already used with a different request.',
            )
          if (existing.responseStatus !== null)
            return { replay: { status: existing.responseStatus, body: existing.responseBody } }
          if (existing.lockedUntil && existing.lockedUntil > now)
            throw new AppError(
              'IDEMPOTENCY_IN_PROGRESS',
              409,
              'A request with this Idempotency-Key is still in progress.',
            )
        }
        const lock = { lockedUntil: new Date(now.getTime() + LOCK_MS) }
        if (existing) {
          await tx.idempotencyKey.update({
            where: { id: existing.id },
            data: {
              ...lock,
              requestHash,
              responseStatus: null,
              expiresAt: new Date(now.getTime() + TTL_MS),
            },
          })
          return { id: existing.id }
        }
        const row = await tx.idempotencyKey.create({
          data: {
            tenantId: requestContext.get()!.tenant!.tenantId,
            scope,
            key,
            requestHash,
            ...lock,
            expiresAt: new Date(now.getTime() + TTL_MS),
          },
        })
        return { id: row.id }
      })
      .catch((err: unknown) => {
        // Two first requests raced on the unique (tenant, scope, key).
        if ((err as { code?: string }).code === 'P2002')
          throw new AppError(
            'IDEMPOTENCY_IN_PROGRESS',
            409,
            'A request with this Idempotency-Key is still in progress.',
          )
        throw err
      })

    if ('replay' in claim) {
      res.status(claim.replay!.status)
      res.setHeader('Idempotent-Replayed', 'true')
      return claim.replay!.body
    }
    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined })
      await this.tenantDb.run((tx) =>
        tx.idempotencyKey.update({
          where: { id: claim.id },
          data: {
            responseStatus: res.statusCode,
            responseBody: (body ?? {}) as Prisma.InputJsonValue,
            lockedUntil: null,
          },
        }),
      )
      return body
    } catch (err) {
      await this.tenantDb
        .run((tx) => tx.idempotencyKey.delete({ where: { id: claim.id } }))
        .catch(() => undefined)
      throw err
    }
  }
}
