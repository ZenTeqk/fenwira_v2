import { canAssignRole, type Member, type Role } from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from './permission.guard'

@Injectable()
export class TeamService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Member[]> {
    const { tenantId } = currentTenant()
    return this.db.run(async (tx) => {
      const rows = await tx.membership.findMany({
        where: { tenantId },
        include: { user: { include: { twoFactor: true } } },
        orderBy: [{ status: 'asc' }, { joinedAt: 'asc' }],
      })
      return rows.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role as Role,
        status: m.status,
        twoFactorEnabled: Boolean(m.user.twoFactor?.enabledAt),
        joinedAt: m.joinedAt.toISOString(),
      }))
    })
  }

  /** docs/SECURITY.md: never above your own rank, never your own role, OWNER only via transfer. */
  async changeRole(membershipId: string, role: Exclude<Role, 'OWNER'>): Promise<void> {
    const actor = currentTenant()
    // team.manage is never a public-API scope, so actor.role is always set here.
    if (!canAssignRole(actor.role!, role))
      throw new AppError('FORBIDDEN', 403, 'You cannot assign a role above your own.')
    await this.db.run(async (tx) => {
      const target = await this.loadTarget(tx, membershipId, actor.tenantId)
      if (target.role === 'OWNER')
        throw new AppError('CONFLICT', 409, 'Transfer ownership to change the owner’s role.')
      if (target.role === role) return
      await tx.membership.update({ where: { id: target.id }, data: { role } })
      await this.audit.write(tx, {
        action: 'team.member.role_changed',
        targetType: 'membership',
        targetId: target.id,
        changes: { role: [target.role, role] },
      })
    })
  }

  async setActive(membershipId: string, active: boolean): Promise<void> {
    const actor = currentTenant()
    await this.db.run(async (tx) => {
      const target = await this.loadTarget(tx, membershipId, actor.tenantId)
      if (target.role === 'OWNER')
        throw new AppError('CONFLICT', 409, 'The owner cannot be deactivated.')
      const status = active ? 'ACTIVE' : 'DEACTIVATED'
      if (target.status === status) return
      await tx.membership.update({
        where: { id: target.id },
        data: { status, deactivatedAt: active ? null : new Date() },
      })
      await this.audit.write(tx, {
        action: active ? 'team.member.reactivated' : 'team.member.deactivated',
        targetType: 'membership',
        targetId: target.id,
      })
    })
  }

  private async loadTarget(tx: TenantTx, membershipId: string, tenantId: string) {
    const target = await tx.membership.findFirst({ where: { id: membershipId, tenantId } })
    if (!target) throw AppError.notFound('Member not found.')
    if (target.userId === currentAuth().userId)
      throw new AppError('CONFLICT', 409, 'You cannot change your own membership.')
    return target
  }
}
