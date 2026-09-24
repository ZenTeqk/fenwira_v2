import { type Permission, type Role } from '@fenwira/contracts'
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { PERMISSION_KEY, ROLE_KEY } from '../../core/security/decorators'

/** Permission keys (never role names) decide access; OWNER-only actions use @RequireRole. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true
    const targets = [context.getHandler(), context.getClass()]
    const permission = this.reflector.getAllAndOverride<Permission>(PERMISSION_KEY, targets)
    const role = this.reflector.getAllAndOverride<Role>(ROLE_KEY, targets)
    if (!permission && !role) return true
    const tenant = requestContext.get()?.tenant
    if (!tenant) throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
    if (permission && !tenant.permissions.includes(permission)) {
      throw new AppError('FORBIDDEN', 403, 'You do not have permission to do this.', { permission })
    }
    if (role && tenant.role !== role) {
      throw new AppError(
        'FORBIDDEN',
        403,
        `Only the workspace ${role.toLowerCase()} can do this.`,
        { role },
      )
    }
    return true
  }
}

/** The verified tenant context; only valid on tenant-scoped routes. */
export function currentTenant() {
  const tenant = requestContext.get()?.tenant
  if (!tenant) throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
  return tenant
}
