import { type MembershipSummary, ROLE_PERMISSIONS, type Role } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'

/** The caller's workspaces, before any tenant is chosen (docs/MULTI_TENANCY.md X1: withUser). */
@Injectable()
export class MeService {
  constructor(@Inject(Database) private readonly db: Database) {}

  memberships(userId: string): Promise<MembershipSummary[]> {
    return this.db.withUser(userId, async (tx) => {
      const rows = await tx.membership.findMany({
        where: { userId, status: 'ACTIVE', tenant: { deletedAt: null } },
        include: { tenant: true },
        orderBy: { joinedAt: 'asc' },
      })
      return rows.map((m) => ({
        membershipId: m.id,
        tenantId: m.tenantId,
        tenantName: m.tenant.name,
        tenantSlug: m.tenant.slug,
        role: m.role as Role,
        permissions: [...ROLE_PERMISSIONS[m.role as Role]],
        require2fa: m.tenant.require2fa,
      }))
    })
  }
}
