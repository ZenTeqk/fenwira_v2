import { randomToken, uuidv7 } from '@fenwira/config'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import { type CreateWorkspaceRequest, type Workspace } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { currentTenant } from './permission.guard'

type TenantRow = {
  id: string
  name: string
  slug: string
  defaultCountry: string
  timezone: string
  currency: string
  require2fa: boolean
  createdAt: Date
}

export const toWorkspace = (t: TenantRow): Workspace => ({
  id: t.id,
  name: t.name,
  slug: t.slug,
  country: t.defaultCountry,
  timezone: t.timezone,
  currency: t.currency,
  require2fa: t.require2fa,
  createdAt: t.createdAt.toISOString(),
})

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `${base || 'workspace'}-${randomToken(4)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, 'x')
    .slice(0, 6)}`
}

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    @Inject(CORE_CONFIG) private readonly core: CoreConfig,
  ) {}

  /** Register → verify email → create workspace → OWNER (PRD AU-1). */
  async create(input: CreateWorkspaceRequest): Promise<Workspace> {
    const { userId } = currentAuth()
    await this.limits.consume([
      { bucket: 'workspace-create:user', key: userId, limit: 10, windowSeconds: 3600 },
    ])
    const user = await this.db.withGlobal((tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    )
    if (!user.emailVerifiedAt)
      throw new AppError(
        'EMAIL_NOT_VERIFIED',
        403,
        'Verify your email before creating a workspace.',
      )
    const tenantId = uuidv7()
    // Bind the new tenant before inserting so the tenants/memberships WITH CHECK policies pass.
    const tenant = await this.db.withTenant(
      tenantId,
      async (tx) => {
        const created = await tx.tenant.create({
          data: {
            id: tenantId,
            name: input.name,
            slug: slugify(input.name),
            defaultCountry: input.country,
            timezone: input.timezone,
            ownerUserId: userId,
            // Managed Launch: no customer wallet (Meta bills messages directly).
            ...(this.core.features?.managedLaunch ? { billingMode: 'FREE' as const } : {}),
          },
        })
        await tx.membership.create({ data: { tenantId, userId, role: 'OWNER' } })
        await this.audit.write(tx, {
          tenantId,
          action: 'workspace.created',
          targetType: 'workspace',
          targetId: tenantId,
          changes: { name: input.name },
        })
        return created
      },
      { userId },
    )
    return toWorkspace(tenant)
  }

  async get(): Promise<Workspace> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) =>
      toWorkspace(await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })),
    )
  }

  async update(input: {
    name?: string
    country?: string
    timezone?: string
    require2fa?: boolean
  }): Promise<Workspace> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      const updated = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          name: input.name,
          defaultCountry: input.country,
          timezone: input.timezone,
          require2fa: input.require2fa,
        },
      })
      await this.audit.write(tx, {
        action: 'workspace.updated',
        targetType: 'workspace',
        targetId: tenantId,
        changes: diff(before, updated),
      })
      return toWorkspace(updated)
    })
  }

  /** OWNER only. Soft delete; the tenant guard treats deleted workspaces as not found. */
  async remove(): Promise<void> {
    const { tenantId } = currentTenant()
    await this.tenantDb.run(async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data: { deletedAt: new Date() } })
      await this.audit.write(tx, {
        action: 'workspace.deleted',
        targetType: 'workspace',
        targetId: tenantId,
      })
    })
  }

  /** OWNER only. Atomic: the old owner becomes ADMIN; there is always exactly one owner. */
  async transferOwnership(membershipId: string): Promise<void> {
    const { tenantId, membershipId: ownMembershipId } = currentTenant()
    if (membershipId === ownMembershipId)
      throw new AppError('CONFLICT', 409, 'You already own this workspace.')
    await this.tenantDb.run(async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id: membershipId, tenantId, status: 'ACTIVE' },
      })
      if (!target) throw AppError.notFound('Member not found.')
      // Demote first: the partial unique index allows only one ACTIVE OWNER at a time.
      await tx.membership.update({ where: { id: ownMembershipId }, data: { role: 'ADMIN' } })
      await tx.membership.update({ where: { id: target.id }, data: { role: 'OWNER' } })
      await tx.tenant.update({ where: { id: tenantId }, data: { ownerUserId: target.userId } })
      await this.audit.write(tx, {
        action: 'workspace.ownership_transferred',
        targetType: 'membership',
        targetId: target.id,
        changes: { from: requestContext.get()?.auth?.userId, to: target.userId },
      })
    })
  }
}

function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ['name', 'defaultCountry', 'timezone', 'require2fa']) {
    if (before[key] !== after[key]) out[key] = [before[key], after[key]]
  }
  return out
}
