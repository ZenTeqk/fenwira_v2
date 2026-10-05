import { type CanActivate, type ExecutionContext, Injectable, Inject } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Redis } from 'ioredis'
import { PinoLogger } from 'nestjs-pino'
import { MetricsService } from '../../core/metrics/metrics.service'
import { REDIS } from '../../core/redis/redis.provider'
import { type Request } from 'express'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { PLATFORM_PERMISSION_KEY, PUBLIC_API_KEY } from '../../core/security/decorators'
import {
  FRESH_MFA_MS,
  PLATFORM_COOKIE,
  PLATFORM_CSRF_COOKIE,
  PlatformAuthService,
} from './platform-auth.service'

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
    private readonly reflector: Reflector,
    private readonly auth: PlatformAuthService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true
    const targets = [context.getHandler(), context.getClass()]
    const permission = this.reflector.getAllAndOverride<string>(PLATFORM_PERMISSION_KEY, targets)
    if (!permission) return true
    if (
      requestContext.get()?.apiKey ||
      this.reflector.getAllAndOverride<boolean>(PUBLIC_API_KEY, targets)
    )
      throw new AppError('FORBIDDEN', 403, 'Platform access requires an operator session.')
    const req = context.switchToHttp().getRequest<Request>()
    const selected = req.header('x-tenant-id')
    if (selected && req.params.workspaceId && selected !== req.params.workspaceId)
      throw new AppError('TENANT_NOT_FOUND', 404, 'Conflicting workspace selection.')
    try {
      const cookies = req.cookies as Record<string, string | undefined>
      const me = await this.auth.authenticate(
        cookies?.[PLATFORM_COOKIE],
        cookies?.[PLATFORM_CSRF_COOKIE],
      )
      if (!(me.permissions as string[]).includes(permission))
        throw new AppError('FORBIDDEN', 403, 'Platform permission required.')
      if (
        permission.endsWith('.manage') &&
        requestContext.get()!.platform!.mfaAt.getTime() + FRESH_MFA_MS <= Date.now()
      )
        throw new AppError(
          'TOTP_REQUIRED',
          403,
          'Verify password and a fresh authenticator code before this action.',
        )
      if (typeof req.params.workspaceId === 'string') {
        const key = `platform:workspace-access:${me.operatorId}`
        await this.redis.sadd(key, req.params.workspaceId)
        await this.redis.expire(key, 300, 'NX')
        const count = await this.redis.scard(key)
        if (count > 25 && (await this.redis.set(`${key}:alert`, '1', 'EX', 300, 'NX')) === 'OK') {
          this.metrics.opsAlerts.inc({ kind: 'platform.unusual_workspace_access' })
          this.logger.warn(
            { operatorId: me.operatorId, count },
            'unusual platform workspace access',
          )
          await this.auth.audit('platform.unusual_workspace_access', 'FLAGGED', me.operatorId)
        }
      }
      return true
    } catch (err) {
      await this.auth.audit('platform.access', 'DENIED', requestContext.get()?.platform?.operatorId)
      throw err
    }
  }
}
