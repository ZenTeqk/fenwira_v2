import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { type Request } from 'express'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { PERMISSION_KEY, ROLE_KEY, TENANT_SCOPED_KEY } from '../../core/security/decorators'
import { TenantAccessService } from './tenant-access.service'

export const TENANT_HEADER = 'x-tenant-id'

/**
 * Resolves the active tenant for @TenantScoped / @RequirePermission / @RequireRole routes
 * (docs/MULTI_TENANCY.md → Tenant selection). A missing, malformed, deleted or foreign tenant is
 * always 404 — never 403 — so tenant existence isn't leaked.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: TenantAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true
    const targets = [context.getHandler(), context.getClass()]
    const scoped =
      this.reflector.getAllAndOverride<boolean>(TENANT_SCOPED_KEY, targets) ||
      Boolean(this.reflector.getAllAndOverride<string>(PERMISSION_KEY, targets)) ||
      Boolean(this.reflector.getAllAndOverride<string>(ROLE_KEY, targets))
    if (!scoped) return true

    const auth = requestContext.get()?.auth
    if (!auth) throw new AppError('UNAUTHENTICATED', 401, 'Please sign in.')
    const result = await this.access.resolve(
      auth.userId,
      context.switchToHttp().getRequest<Request>().header(TENANT_HEADER),
    )
    if (!result.ok && result.reason === 'TWO_FACTOR_REQUIRED') {
      throw new AppError(
        'TWO_FACTOR_ENROLLMENT_REQUIRED',
        403,
        'This workspace requires two-factor authentication. Turn it on in Settings → Security.',
      )
    }
    if (!result.ok) throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
    requestContext.patch({ tenantId: result.context.tenantId, tenant: result.context })
    return true
  }
}
