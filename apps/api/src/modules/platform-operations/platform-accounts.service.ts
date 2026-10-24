import { encryptSecret, randomToken, sha256, uuidv7 } from '@fenwira/config'
import { CORE_CONFIG, type CoreConfig } from '../../core/config/core-config'
import {
  type DeleteWorkspaceRequest,
  type CreateWorkspaceWithOwner,
  type EmailDelivery,
  type OneTimeLink,
  type PlatformMember,
  type ProvisionedWorkspace,
} from '@fenwira/contracts'
import { Database, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { IDENTITY_OPTIONS, type IdentityOptions, PasswordService } from '../identity'
import { slugify } from '../tenancy'

/** ML-D7 / ADR-0027 step 4: the owner's set-password link lives 72 hours; resets 1 hour. */
export const SETUP_LINK_TTL_MS = 72 * 3600 * 1000
export const RESET_LINK_TTL_MS = 3600 * 1000

/**
 * Operator provisioning without email (ADR-0027 step 4): create a workspace with its OWNER in one
 * step, issue one-time password links (ML-D4: operators only), list members and the email log.
 * Links are returned once; only their SHA-256 is stored, and the email (when SMTP is configured)
 * carries the same token, encrypted in the outbox. Every write is audited on the workspace and in
 * the platform audit; neither records a token.
 */
@Injectable()
export class PlatformAccountsService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(IDENTITY_OPTIONS) private readonly identity: IdentityOptions,
    private readonly passwords: PasswordService,
    private readonly limits: RateLimitService,
    @Inject(CORE_CONFIG) private readonly core: CoreConfig,
  ) {}

  private operator(): string {
    const id = requestContext.get()?.platform?.operatorId
    if (!id) throw new AppError('FORBIDDEN', 403, 'Operator session required.')
    return id
  }

  async createWorkspace(input: CreateWorkspaceWithOwner): Promise<ProvisionedWorkspace> {
    const operatorId = this.operator()
    await this.limits.consume([
      {
        bucket: 'platform-workspace-create:operator',
        key: operatorId,
        limit: 30,
        windowSeconds: 3600,
      },
    ])
    // An existing account keeps its password; a new one gets an unusable random hash until the
    // owner sets a password through the setup link (which also verifies the email, ML-D7).
    const existing = await this.db.withGlobal((tx) =>
      tx.user.findUnique({ where: { email: input.ownerEmail } }),
    )
    const ownerUserId = existing?.id ?? uuidv7()
    const unusable = existing ? null : await this.passwords.hash(randomToken(32))
    const tenantId = uuidv7()
    const plan = await this.db.withGlobal((tx) =>
      tx.plan.findUnique({ where: { key: input.planKey }, select: { id: true } }),
    )
    if (!plan) throw new AppError('VALIDATION_FAILED', 400, `Unknown plan ${input.planKey}.`)
    const token = existing ? null : randomToken()
    const expiresAt = new Date(Date.now() + SETUP_LINK_TTL_MS)
    if (!existing)
      await this.db.withGlobal((tx) =>
        tx.user.create({
          data: {
            id: ownerUserId,
            email: input.ownerEmail,
            name: input.ownerName,
            passwordHash: unusable!,
          },
        }),
      )
    await this.db.withTenant(
      tenantId,
      async (tx) => {
        await tx.tenant.create({
          data: {
            id: tenantId,
            name: input.workspaceName,
            slug: slugify(input.workspaceName),
            defaultCountry: input.country,
            timezone: input.timezone,
            ownerUserId,
            // Managed Launch: no customer wallet (Meta bills messages directly).
            ...(this.core.features?.managedLaunch ? { billingMode: 'FREE' as const } : {}),
          },
        })
        await tx.membership.create({ data: { tenantId, userId: ownerUserId, role: 'OWNER' } })
        // The trial starts now with the chosen plan recorded; the daily job invoices that plan
        // before the trial ends (docs/BILLING.md → Manual invoices).
        await tx.subscription.createMany({
          data: [
            {
              tenantId,
              status: 'TRIALING',
              trialEndsAt: new Date(
                Date.now() + (this.core.entitlements?.trialDays ?? 14) * 86_400_000,
              ),
              requestedPlanId: plan.id,
              requestedAt: new Date(),
            },
          ],
          skipDuplicates: true,
        })
        await this.audit(
          tx,
          tenantId,
          operatorId,
          'workspace.created_by_operator',
          'workspace',
          tenantId,
          {
            name: input.workspaceName,
            ownerUserId,
            newAccount: !existing,
            planKey: input.planKey,
          },
        )
      },
      { userId: ownerUserId },
    )
    if (token)
      await this.db.withGlobal((tx) => this.storeLink(tx, ownerUserId, token, expiresAt, 'SETUP'))
    await this.platformAudit(operatorId, tenantId, 'platform.workspace_created')
    return {
      workspaceId: tenantId,
      ownerUserId,
      setupLink: token ? `${this.identity.webOrigin}/reset-password?token=${token}&setup=1` : null,
      setupExpiresAt: token ? expiresAt.toISOString() : null,
    }
  }

  async members(workspaceId: string): Promise<PlatformMember[]> {
    await this.workspace(workspaceId)
    const rows = await this.db.withTenant(workspaceId, (tx) =>
      tx.membership.findMany({
        where: { tenantId: workspaceId },
        include: { user: { select: { name: true, email: true, emailVerifiedAt: true } } },
        orderBy: { joinedAt: 'asc' },
      }),
    )
    return rows.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      status: m.status,
      emailVerified: Boolean(m.user.emailVerifiedAt),
      joinedAt: m.joinedAt.toISOString(),
    }))
  }

  /** ML-D4: only operators issue reset links, and only for members of the named workspace. */
  async resetLink(workspaceId: string, userId: string): Promise<OneTimeLink> {
    const operatorId = this.operator()
    await this.workspace(workspaceId)
    await this.limits.consume([
      { bucket: 'platform-reset-link:user', key: userId, limit: 10, windowSeconds: 3600 },
    ])
    const member = await this.db.withTenant(workspaceId, (tx) =>
      tx.membership.findFirst({ where: { tenantId: workspaceId, userId, status: 'ACTIVE' } }),
    )
    if (!member) throw AppError.notFound('Member not found.')
    const token = randomToken()
    const expiresAt = new Date(Date.now() + RESET_LINK_TTL_MS)
    await this.db.withGlobal(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } })
      if (!user || user.disabledAt) throw AppError.notFound('Member not found.')
      await this.storeLink(tx, userId, token, expiresAt, 'RESET')
    })
    await this.db.withTenant(workspaceId, (tx) =>
      this.audit(tx, workspaceId, operatorId, 'identity.reset_link_issued', 'user', userId, {}),
    )
    await this.platformAudit(operatorId, workspaceId, 'platform.reset_link_issued')
    return {
      link: `${this.identity.webOrigin}/reset-password?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    }
  }

  /**
   * Soft delete (same as an owner's DELETE /workspace): the workspace disappears for everyone at
   * once and its data is kept. Never the internal workspace; a live WhatsApp number must be
   * disconnected first so it can be connected elsewhere and nothing keeps sending.
   */
  async deleteWorkspace(workspaceId: string, input: DeleteWorkspaceRequest): Promise<void> {
    const operatorId = this.operator()
    await this.workspace(workspaceId)
    await this.db.withTenant(workspaceId, async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { id: workspaceId, deletedAt: null },
        select: { name: true, isInternal: true },
      })
      if (!tenant) throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
      if (tenant.isInternal)
        throw new AppError('CONFLICT', 409, 'The internal workspace cannot be deleted.')
      if (input.confirmName !== tenant.name)
        throw AppError.validation(
          [
            {
              path: 'confirmName',
              code: 'mismatch',
              message: 'Type the workspace name exactly as shown.',
            },
          ],
          'The name does not match this workspace.',
        )
      const live = await tx.whatsAppPhoneNumber.count({
        where: { status: { not: 'DISCONNECTED' } },
      })
      if (live)
        throw new AppError(
          'CONFLICT',
          409,
          'This workspace still has a connected WhatsApp number. Disconnect it in the WhatsApp section first.',
        )
      await tx.tenant.update({ where: { id: workspaceId }, data: { deletedAt: new Date() } })
      await this.audit(tx, workspaceId, operatorId, 'workspace.deleted', 'workspace', workspaceId, {
        reason: input.reason,
        by: 'PLATFORM_OPERATOR',
      })
    })
    await this.platformAudit(operatorId, workspaceId, 'platform.workspace_deleted')
  }

  async emailDeliveries(): Promise<EmailDelivery[]> {
    this.operator()
    const rows = await this.db.withGlobal((tx) =>
      tx.emailDelivery.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
    )
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      recipientHint: r.recipientHint,
      errorCode: r.errorCode,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  /** A newer link invalidates older unused ones; the email job gets the token encrypted. */
  private async storeLink(
    tx: TenantTx,
    userId: string,
    token: string,
    expiresAt: Date,
    kind: 'RESET' | 'SETUP',
  ) {
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    })
    await tx.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } })
    await this.db.system.emitPlatformEvent(
      'identity.password_reset.requested',
      {
        userId,
        kind,
        tokenCiphertext: Buffer.from(encryptSecret(this.identity.keyRing, token)).toString(
          'base64',
        ),
      },
      requestContext.correlationId() ?? null,
      tx,
    )
  }

  private async workspace(workspaceId: string) {
    const found = await this.db.system.platformWorkspaces(this.operator(), workspaceId, 1)
    if (!found.some((w) => w.id === workspaceId))
      throw new AppError('TENANT_NOT_FOUND', 404, 'Workspace not found.')
  }

  private audit(
    tx: TenantTx,
    tenantId: string,
    operatorId: string,
    action: string,
    targetType: string,
    targetId: string,
    changes: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        tenantId,
        actorType: 'PLATFORM_OPERATOR',
        actorId: operatorId,
        action,
        targetType,
        targetId,
        changes: changes as never,
        correlationId: requestContext.correlationId() ?? null,
      },
    })
  }

  /** createMany: platform_audit's read policy forbids the RETURNING a single create needs. */
  private platformAudit(operatorId: string, workspaceId: string, action: string) {
    return this.db.withTenant(workspaceId, (tx) =>
      tx.platformAudit.createMany({
        data: {
          operatorId,
          workspaceId,
          action,
          outcome: 'SUCCESS',
          correlationId: requestContext.correlationId() ?? null,
        },
      }),
    )
  }
}
