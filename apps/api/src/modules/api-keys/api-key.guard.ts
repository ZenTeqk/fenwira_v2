import { safeEqual } from '@fenwira/config'
import { type Permission } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Request } from 'express'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { MetricsService } from '../../core/metrics/metrics.service'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { PERMISSION_KEY, PUBLIC_API_KEY } from '../../core/security/decorators'
import { EntitlementsService } from '../entitlements'
import { hashApiKeySecret, parseApiKeyToken } from './api-key-token'
import { API_KEYS_OPTIONS, type ApiKeysOptions } from './api-keys.options'

const GENERIC_401 = 'Invalid or missing API key.'

/**
 * Authenticates `Authorization: Bearer fw_<prefix>_<secret>` requests (docs/API_KEYS.md,
 * decisions P11-D18, P11-D22, P11-D23). Runs **before** AuthGuard: when no such header is
 * present it does nothing, and the normal cookie-session guards run as usual. When it is
 * present, this guard alone decides the request — cookies are never consulted.
 *
 * A request without the header is untouched. A request with the header:
 * 1. must name a route carrying `@PublicApi()` (with `@RequirePermission`) — every other route,
 *    including ones a signed-in user could reach, answers 404, never 403, so the private surface
 *    is never discoverable through an API key;
 * 2. must present a live, correctly-hashed key whose workspace has the API entitlement enabled;
 * 3. is then rate-limited per key and recorded as used.
 * `tenant.permissions` becomes the key's scopes, so the existing PermissionGuard enforces "the
 * key's scope must include the route's permission" for free, with no separate scope check here.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(Database) private readonly db: Database,
    @Inject(API_KEYS_OPTIONS) private readonly options: ApiKeysOptions,
    private readonly entitlements: EntitlementsService,
    private readonly limits: RateLimitService,
    private readonly metrics: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true
    const req = context.switchToHttp().getRequest<Request>()
    const header = req.header('authorization')
    if (!header?.startsWith('Bearer fw_')) return true // not an API-key request

    try {
      return await this.authenticate(header, context)
    } catch (err) {
      this.metrics.apiKeyRequests.inc({
        result: err instanceof AppError ? err.code.toLowerCase() : 'error',
      })
      throw err
    }
  }

  private async authenticate(header: string, context: ExecutionContext): Promise<boolean> {
    const parsed = parseApiKeyToken(header.slice('Bearer '.length))
    if (!parsed) throw new AppError('UNAUTHENTICATED', 401, GENERIC_401)

    const row = await this.db.system.resolveApiKey(parsed.prefix)
    const now = new Date()
    if (
      !row ||
      row.revokedAt ||
      (row.expiresAt && row.expiresAt < now) ||
      !safeEqual(hashApiKeySecret(this.options.pepper, parsed.secret), row.keyHash)
    )
      throw new AppError('UNAUTHENTICATED', 401, GENERIC_401)

    // The route must be explicitly public; the required scope is its @RequirePermission value.
    const targets = [context.getHandler(), context.getClass()]
    const isPublicApi = Boolean(this.reflector.getAllAndOverride<boolean>(PUBLIC_API_KEY, targets))
    const scope = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, targets)
    if (!isPublicApi || !scope) throw new AppError('NOT_FOUND', 404, 'Not found.')

    const { tenantId, apiKeyId, scopes } = row
    const result = await this.db.withTenant(tenantId, async (tx) => {
      if (!(await this.entitlements.apiEnabled(tx, tenantId))) return null
      return tx.apiKey.update({
        where: { id: apiKeyId },
        data: { lastUsedAt: now },
        select: { name: true },
      })
    })
    if (!result)
      throw new AppError(
        'ENTITLEMENT_REQUIRED',
        403,
        "The API isn't included in this workspace's plan.",
        { key: 'api_enabled' },
      )

    await this.limits.consume([
      {
        bucket: 'api_key',
        key: apiKeyId,
        limit: this.options.rateLimitPerMinute,
        windowSeconds: 60,
      },
    ])

    requestContext.patch({
      apiKey: { id: apiKeyId, name: result.name, tenantId },
      tenant: { tenantId, membershipId: '', permissions: scopes as Permission[] },
    })
    this.metrics.apiKeyRequests.inc({ result: 'ok' })
    return true
  }
}
