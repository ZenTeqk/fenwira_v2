import { encryptSecret, randomToken, sha256 } from '@fenwira/config'
import {
  canAssignRole,
  type CreateInvitationRequest,
  type Invitation,
  type InvitationPreview,
  type Role,
} from '@fenwira/contracts'
import { Database, type RoleKey, type TenantTx } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import { requestContext } from '../../core/context/request-context'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RateLimitService } from '../../core/security/rate-limit.service'
import { AuditService } from '../audit'
import {
  currentAuth,
  IDENTITY_OPTIONS,
  type IdentityOptions,
  IdentityService,
  type SessionTokens,
} from '../identity'
import { currentTenant } from './permission.guard'
import { EntitlementsService } from '../entitlements'

/** ADR-0027 step 4: one-time invitation links live 72 hours. */
export const INVITATION_LINK_TTL_MS = 72 * 3600 * 1000

const invalidLink = () =>
  new AppError(
    'TOKEN_INVALID',
    404,
    'This invitation is invalid or has expired. Ask for a new one.',
  )

type Row = {
  id: string
  email: string
  role: string
  status: Invitation['status']
  expiresAt: Date | null
  createdAt: Date
  invitedBy: { name: string }
}
const toDto = (r: Row): Invitation => ({
  id: r.id,
  email: r.email,
  role: r.role as Role,
  status: r.status === 'PENDING' && r.expiresAt && r.expiresAt <= new Date() ? 'EXPIRED' : r.status,
  invitedByName: r.invitedBy.name,
  expiresAt: r.expiresAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
})

@Injectable()
export class InvitationService {
  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
    private readonly limits: RateLimitService,
    private readonly entitlements: EntitlementsService,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
  ) {}

  /**
   * Issues a fresh single-use link (only its hash is stored; any older link stops working) and
   * queues the email with the same token, encrypted, for when SMTP is configured.
   */
  private async issueLink(
    tx: TenantTx,
    tenantId: string,
    invitationId: string,
  ): Promise<{ link: string; expiresAt: Date }> {
    const token = randomToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + INVITATION_LINK_TTL_MS)
    await tx.invitation.update({
      where: { id: invitationId },
      data: { tokenHash: sha256(token), sentAt: now, expiresAt },
    })
    await this.emitSend(
      tx,
      tenantId,
      invitationId,
      Buffer.from(encryptSecret(this.options.keyRing, token)).toString('base64'),
    )
    return { link: `${this.options.webOrigin}/invitations/${token}`, expiresAt }
  }

  async list(): Promise<Invitation[]> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.invitation.findMany({
        where: { tenantId, status: { in: ['PENDING', 'EXPIRED'] } },
        include: { invitedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
      return rows.map(toDto)
    })
  }

  async create(input: CreateInvitationRequest): Promise<Invitation> {
    const actor = currentTenant()
    await this.limits.consume([
      { bucket: 'invite:tenant', key: actor.tenantId, limit: 50, windowSeconds: 3600 },
    ])
    // team.manage is never a public-API scope, so actor.role is always set here.
    if (!canAssignRole(actor.role!, input.role))
      throw new AppError('FORBIDDEN', 403, 'You cannot invite someone with a role above your own.')
    return this.tenantDb.run(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { email: input.email } })
      if (existingUser) {
        const member = await tx.membership.findFirst({
          where: { tenantId: actor.tenantId, userId: existingUser.id, status: 'ACTIVE' },
        })
        if (member)
          throw new AppError('CONFLICT', 409, 'This person is already a member of the workspace.')
      }
      // Expired pending invitations free the (tenant, email) slot.
      await tx.invitation.updateMany({
        where: {
          tenantId: actor.tenantId,
          email: input.email,
          status: 'PENDING',
          expiresAt: { lte: new Date() },
        },
        data: { status: 'EXPIRED', tokenHash: null },
      })
      const pending = await tx.invitation.findFirst({
        where: { tenantId: actor.tenantId, email: input.email, status: 'PENDING' },
      })
      if (pending)
        throw new AppError(
          'CONFLICT',
          409,
          'This person already has a pending invitation. Resend it instead.',
        )
      // Pending invitations count toward the plan's team-member limit.
      await this.entitlements.assertWithin(tx, actor.tenantId, 'max_users')
      const invitation = await tx.invitation.create({
        data: {
          tenantId: actor.tenantId,
          email: input.email,
          role: input.role,
          invitedById: currentAuth().userId,
        },
        include: { invitedBy: { select: { name: true } } },
      })
      const { link, expiresAt } = await this.issueLink(tx, actor.tenantId, invitation.id)
      await this.audit.write(tx, {
        action: 'team.invitation.sent',
        targetType: 'invitation',
        targetId: invitation.id,
        changes: { role: input.role },
      })
      return { ...toDto({ ...invitation, expiresAt }), link }
    })
  }

  /** A new one-time link (copyable), also emailed when SMTP is configured. */
  async resend(invitationId: string): Promise<{ link: string; expiresAt: string }> {
    const { tenantId } = currentTenant()
    await this.limits.consume([
      { bucket: 'invite-resend:invitation', key: invitationId, limit: 5, windowSeconds: 3600 },
    ])
    return this.tenantDb.run(async (tx) => {
      const inv = await tx.invitation.findFirst({
        where: { id: invitationId, tenantId, status: 'PENDING' },
      })
      if (!inv) throw AppError.notFound('Invitation not found.')
      const issued = await this.issueLink(tx, tenantId, inv.id)
      await this.audit.write(tx, {
        action: 'team.invitation.resent',
        targetType: 'invitation',
        targetId: inv.id,
      })
      return { link: issued.link, expiresAt: issued.expiresAt.toISOString() }
    })
  }

  async revoke(invitationId: string): Promise<void> {
    const { tenantId } = currentTenant()
    await this.tenantDb.run(async (tx) => {
      const updated = await tx.invitation.updateMany({
        where: { id: invitationId, tenantId, status: 'PENDING' },
        data: { status: 'REVOKED', tokenHash: null },
      })
      if (updated.count === 0) throw AppError.notFound('Invitation not found.')
      await this.audit.write(tx, {
        action: 'team.invitation.revoked',
        targetType: 'invitation',
        targetId: invitationId,
      })
    })
  }

  // ------------------------------------------------------------------ public (token holders)

  async preview(token: string): Promise<InvitationPreview> {
    return this.withInvitation(token, async (tx, inv) => {
      const [tenant, inviter, existing] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: inv.tenantId } }),
        tx.user.findUniqueOrThrow({ where: { id: inv.invitedById } }),
        tx.user.findUnique({ where: { email: inv.email } }),
      ])
      return {
        workspaceName: tenant.name,
        inviterName: inviter.name,
        email: inv.email,
        role: inv.role as Role,
        expiresAt: inv.expiresAt!.toISOString(),
        existingAccount: Boolean(existing),
      }
    })
  }

  /**
   * Existing users accept while signed in as the invited email; new users provide name + password
   * and get a verified account (the token proves the mailbox) plus a session.
   */
  async accept(
    token: string,
    input: { name?: string; password?: string },
  ): Promise<{ tenantId: string; tokens?: SessionTokens }> {
    const ip = requestContext.get()?.ip ?? 'unknown'
    await this.limits.consume([
      { bucket: 'invite-accept:ip', key: ip, limit: 20, windowSeconds: 3600 },
    ])
    const auth = requestContext.get()?.auth
    return this.withInvitation(token, async (tx, inv) => {
      let userId: string
      let tokens: SessionTokens | undefined
      const existing = await tx.user.findUnique({ where: { email: inv.email } })
      if (auth) {
        const me = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } })
        if (me.email.toLowerCase() !== inv.email.toLowerCase()) {
          throw new AppError(
            'CONFLICT',
            409,
            `This invitation is for ${inv.email}. Sign in with that account to accept it.`,
            { reason: 'EMAIL_MISMATCH' },
          )
        }
        userId = me.id
      } else if (existing) {
        throw new AppError(
          'CONFLICT',
          409,
          'An account with this email exists. Sign in to accept the invitation.',
          { reason: 'SIGN_IN_REQUIRED' },
        )
      } else {
        if (!input.name || !input.password) {
          throw AppError.validation([
            {
              path: 'password',
              code: 'required',
              message: 'Choose a name and password to create your account.',
            },
          ])
        }
        userId = await this.identity.createVerifiedUser(
          { email: inv.email, name: input.name, password: input.password },
          tx,
        )
        tokens = await this.identity.startSession(userId, tx)
      }
      // This invitation is already counted as pending, so accepting it is net zero — refused only
      // when the workspace is already over its limit (e.g. after a downgrade).
      await this.entitlements.assertWithin(tx, inv.tenantId, 'max_users', 0)
      const membership = await tx.membership.findFirst({
        where: { tenantId: inv.tenantId, userId },
      })
      if (!membership) {
        await tx.membership.create({ data: { tenantId: inv.tenantId, userId, role: inv.role } })
      } else if (membership.status !== 'ACTIVE') {
        await tx.membership.update({
          where: { id: membership.id },
          data: { status: 'ACTIVE', role: inv.role, deactivatedAt: null },
        })
      }
      await tx.invitation.update({
        where: { id: inv.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), tokenHash: null },
      })
      await this.audit.write(tx, {
        tenantId: inv.tenantId,
        actorId: userId,
        action: 'team.invitation.accepted',
        targetType: 'invitation',
        targetId: inv.id,
        changes: { role: inv.role },
      })
      return { tenantId: inv.tenantId, tokens }
    })
  }

  /** X6: token hash → (tenant, invitation) ids, then everything else inside withTenant. */
  private async withInvitation<T>(
    token: string,
    fn: (
      tx: TenantTx,
      inv: {
        id: string
        tenantId: string
        email: string
        role: RoleKey
        invitedById: string
        expiresAt: Date | null
      },
    ) => Promise<T>,
  ): Promise<T> {
    const resolved = await this.db.system.resolveInvitation(sha256(token))
    if (!resolved) throw invalidLink()
    return this.db.withTenant(resolved.tenantId, async (tx) => {
      const inv = await tx.invitation.findFirst({
        where: { id: resolved.invitationId, tenantId: resolved.tenantId },
        include: { tenant: true },
      })
      if (
        !inv ||
        inv.status !== 'PENDING' ||
        !inv.expiresAt ||
        inv.expiresAt <= new Date() ||
        inv.tenant.deletedAt
      )
        throw invalidLink()
      return fn(tx, inv)
    })
  }

  private async emitSend(
    tx: TenantTx,
    tenantId: string,
    invitationId: string,
    tokenCiphertext: string,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: 'tenancy.invitation.sent',
        aggregateType: 'invitation',
        aggregateId: invitationId,
        payload: { invitationId, tokenCiphertext },
        correlationId: requestContext.correlationId() ?? null,
      },
    })
  }
}
