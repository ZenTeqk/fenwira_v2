import { ROLE_PERMISSIONS, type Role } from '@fenwira/contracts'
import { UUID_RE } from '@fenwira/config'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { type TenantContext } from '../../core/context/request-context'

export type TenantAccess =
  { ok: true; context: TenantContext } | { ok: false; reason: 'NOT_FOUND' | 'TWO_FACTOR_REQUIRED' }

/** Single membership check shared by the HTTP TenantGuard and the WebSocket gateway. */
@Injectable()
export class TenantAccessService {
  constructor(@Inject(Database) private readonly db: Database) {}

  async resolve(userId: string, tenantId: string | undefined): Promise<TenantAccess> {
    if (!tenantId || !UUID_RE.test(tenantId)) return { ok: false, reason: 'NOT_FOUND' }
    return this.db.withTenant(
      tenantId,
      async (tx): Promise<TenantAccess> => {
        // Explicit tenantId filter: the self-read policy also exposes the user's other memberships.
        const membership = await tx.membership.findFirst({
          where: { tenantId, userId, status: 'ACTIVE' },
          include: { tenant: true },
        })
        if (!membership || membership.tenant.deletedAt) return { ok: false, reason: 'NOT_FOUND' }
        if (membership.tenant.require2fa) {
          const twoFactor = await tx.twoFactorCredential.findUnique({ where: { userId } })
          if (!twoFactor?.enabledAt) return { ok: false, reason: 'TWO_FACTOR_REQUIRED' }
        }
        const role = membership.role as Role
        return {
          ok: true,
          context: {
            tenantId,
            membershipId: membership.id,
            role,
            permissions: ROLE_PERMISSIONS[role],
          },
        }
      },
      { userId },
    )
  }
}
