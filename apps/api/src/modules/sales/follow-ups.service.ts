import {
  type CreateFollowUpRequest,
  type FollowUp,
  type FollowUpCounts,
  type FollowUpsQuery,
  type FollowUpSummary,
  type FollowUpTab,
  localDayBounds,
  type Notification,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { likeLiteral } from '../../core/database/like'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { conversationVisibility } from '../messaging'
import { createNotification } from '../notifications'
import { currentTenant } from '../tenancy'
import { decodeOffset, offsetPage } from './opportunities.service'
import {
  assertSalesEnabled,
  customerLabel,
  FOLLOW_UP_INCLUDE,
  followUpLink,
  requireMember,
  toFollowUp,
} from './sales.core'

type Actor = { userId: string; manager: boolean }
type Action = 'complete' | 'reschedule' | 'reassign' | 'cancel' | 'edit' | 'reviewed'

/**
 * Follow-ups (docs/FOLLOW_UPS_AND_SALES.md → Follow-ups): internal reminders, never WhatsApp
 * messages. Every change bumps `version` and re-arms the due reminder through the outbox
 * (`follow_up.scheduled`), so a reminder job armed for an older version is a harmless no-op.
 * Members see their own follow-ups (assigned to or created by them); followups.manage sees the team.
 */
@Injectable()
export class FollowUpsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  // ------------------------------------------------------------------------------- reading

  async list(q: FollowUpsQuery) {
    const actor = this.actor()
    const offset = decodeOffset(q.cursor)
    return this.db.run(async (tx) => {
      const now = new Date()
      const where = this.filter(actor, q)
      where.push(await this.tabFilter(tx, q.tab, now))
      const orderBy: Prisma.FollowUpOrderByWithRelationInput[] =
        q.tab === 'completed'
          ? [{ completedAt: 'desc' }, { id: 'desc' }]
          : [{ dueAt: 'asc' }, { id: 'asc' }]
      const rows = await tx.followUp.findMany({
        where: { AND: where },
        include: FOLLOW_UP_INCLUDE,
        orderBy,
        skip: offset,
        take: q.limit + 1,
      })
      return offsetPage(
        rows.map((r) => toFollowUp(r, now)),
        offset,
        q.limit,
      )
    })
  }

  async counts(q: FollowUpsQuery): Promise<FollowUpCounts> {
    const actor = this.actor()
    return this.db.run(async (tx) => {
      const now = new Date()
      const where = this.filter(actor, q)
      const count = async (tab: FollowUpTab) =>
        tx.followUp.count({ where: { AND: [...where, await this.tabFilter(tx, tab, now)] } })
      return {
        today: await count('today'),
        overdue: await count('overdue'),
        upcoming: await count('upcoming'),
        completed: await count('completed'),
      }
    })
  }

  /** The sidebar badge (overdue) and inbox hints, for the current user's own follow-ups. */
  async summary(): Promise<FollowUpSummary> {
    const { userId } = currentAuth()
    return this.db.run(async (tx) => {
      const now = new Date()
      const mine: Prisma.FollowUpWhereInput = { assigneeId: userId, status: 'PENDING' }
      const today = await this.tabFilter(tx, 'today', now)
      const [overdue, dueToday, needsReview] = [
        await tx.followUp.count({ where: { ...mine, dueAt: { lte: now } } }),
        await tx.followUp.count({ where: { AND: [mine, today] } }),
        await tx.followUp.count({ where: { ...mine, needsReviewAt: { not: null } } }),
      ]
      return { overdue, today: dueToday, needsReview }
    })
  }

  async get(id: string): Promise<FollowUp> {
    const actor = this.actor()
    return this.db.run(async (tx) => toFollowUp(await this.find(tx, id, actor)))
  }

  // ------------------------------------------------------------------------------- writing

  async create(input: CreateFollowUpRequest): Promise<FollowUp> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const { dto, notice } = await this.db.run(async (tx) => {
      await assertSalesEnabled(tx, tenantId)
      const contact = await tx.contact.findFirst({
        where: { id: input.contactId, deletedAt: null },
        select: { id: true, name: true, waProfileName: true, phoneE164: true },
      })
      if (!contact) throw AppError.notFound('Contact not found.')
      let conversationAssignee: string | null = null
      if (input.conversationId) {
        const c = await tx.conversation.findFirst({
          where: {
            AND: [
              { id: input.conversationId, contactId: contact.id },
              await conversationVisibility(tx, userId),
            ],
          },
          select: { assigneeId: true },
        })
        if (!c) throw AppError.notFound('Conversation not found.')
        conversationAssignee = c.assigneeId
      }
      if (input.opportunityId) {
        const o = await tx.opportunity.findFirst({
          where: { id: input.opportunityId, contactId: contact.id },
          select: { id: true },
        })
        if (!o) throw AppError.notFound('Opportunity not found.')
      }
      // Default: the conversation's owner, else the person creating it.
      const assigneeId = input.assigneeId ?? conversationAssignee ?? userId
      const assignee = await requireMember(tx, assigneeId, 'followups.write', 'assigneeId')
      const row = await tx.followUp.create({
        data: {
          tenantId,
          contactId: contact.id,
          conversationId: input.conversationId ?? null,
          opportunityId: input.opportunityId ?? null,
          title: input.title,
          note: input.note || null,
          assigneeId: assignee.id,
          createdBy: userId,
          dueAt: new Date(input.dueAt),
        },
        include: FOLLOW_UP_INCLUDE,
      })
      await this.arm(tx, tenantId, row.id, row.version)
      await this.audit.write(tx, {
        action: 'follow_up.created',
        targetType: 'follow_up',
        targetId: row.id,
        changes: {
          contactId: contact.id,
          conversationId: row.conversationId,
          opportunityId: row.opportunityId,
          assigneeId: assignee.id,
          dueAt: row.dueAt.toISOString(),
        },
      })
      const notice =
        assignee.id !== userId
          ? await this.assignedNotice(tx, tenantId, row, contact, assignee.id)
          : null
      return { dto: toFollowUp(row), notice }
    })
    this.emit(tenantId, dto, notice)
    return dto
  }

  async edit(id: string, input: { title?: string; note?: string | null; version?: number }) {
    return this.act(id, 'edit', input.version, async (tx, f) => {
      const data: Prisma.FollowUpUpdateInput = {}
      const changes: Record<string, unknown> = {}
      if (input.title !== undefined && input.title !== f.title) {
        data.title = input.title
        changes.title = [f.title, input.title]
      }
      if (input.note !== undefined && (input.note || null) !== f.note) {
        data.note = input.note || null
        changes.note = 'changed'
      }
      return { data, changes, audit: 'follow_up.updated', rearm: true }
    })
  }

  async complete(id: string, version?: number) {
    const { userId } = currentAuth()
    return this.act(id, 'complete', version, async () => ({
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedBy: userId,
        needsReviewAt: null,
      },
      changes: { status: ['PENDING', 'COMPLETED'] },
      audit: 'follow_up.completed',
      rearm: false,
    }))
  }

  async cancel(id: string, version?: number) {
    const { userId } = currentAuth()
    return this.act(id, 'cancel', version, async () => ({
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: userId },
      changes: { status: ['PENDING', 'CANCELLED'] },
      audit: 'follow_up.cancelled',
      rearm: false,
    }))
  }

  async reschedule(id: string, dueAt: string, version?: number) {
    return this.act(id, 'reschedule', version, async (_tx, f) => ({
      data: { dueAt: new Date(dueAt), dueNotifiedAt: null, needsReviewAt: null },
      changes: { dueAt: [f.dueAt.toISOString(), new Date(dueAt).toISOString()] },
      audit: 'follow_up.rescheduled',
      rearm: true,
    }))
  }

  async reassign(id: string, assigneeId: string, version?: number) {
    return this.act(id, 'reassign', version, async (tx, f) => {
      if (assigneeId === f.assigneeId) return null
      const assignee = await requireMember(tx, assigneeId, 'followups.write', 'assigneeId')
      // A new assignee of an already-due follow-up is told right away (the reminder re-arms).
      return {
        data: { assignee: { connect: { id: assignee.id } }, dueNotifiedAt: null },
        changes: { assigneeId: [f.assigneeId, assignee.id] },
        audit: 'follow_up.reassigned',
        rearm: true,
        notifyAssignee: assignee.id,
      }
    })
  }

  /** The assignee has seen the customer's reply; clears the review flag. */
  async reviewed(id: string, version?: number) {
    return this.act(id, 'reviewed', version, async (_tx, f) =>
      f.needsReviewAt
        ? {
            data: { needsReviewAt: null },
            changes: { needsReview: [true, false] },
            audit: 'follow_up.reviewed',
            rearm: true,
          }
        : null,
    )
  }

  // ------------------------------------------------------------------------------- helpers

  /**
   * One locked read-modify-write. Rejects stale versions (409 VERSION_CONFLICT) and anything
   * but PENDING; bumps the version, audits, and re-arms the reminder when it is still pending.
   */
  private async act(
    id: string,
    action: Action,
    expected: number | undefined,
    change: (
      tx: TenantTx,
      f: Awaited<ReturnType<FollowUpsService['find']>>,
    ) => Promise<{
      data: Prisma.FollowUpUpdateInput
      changes: Record<string, unknown>
      audit: string
      rearm: boolean
      notifyAssignee?: string
    } | null>,
  ): Promise<FollowUp> {
    const { tenantId } = currentTenant()
    const actor = this.actor()
    const { dto, notice } = await this.db.run(async (tx) => {
      await assertSalesEnabled(tx, tenantId)
      await this.find(tx, id, actor)
      await tx.$executeRaw`SELECT id FROM follow_ups WHERE id = ${id}::uuid FOR UPDATE`
      const f = await this.find(tx, id, actor)
      this.authorize(actor, f, action)
      if (expected !== undefined && expected !== f.version)
        throw new AppError(
          'VERSION_CONFLICT',
          409,
          'This follow-up changed in the meantime. Refresh to see the latest version.',
        )
      if (f.status !== 'PENDING')
        throw new AppError(
          'CONFLICT',
          409,
          `This follow-up is already ${f.status === 'COMPLETED' ? 'completed' : 'cancelled'}.`,
        )
      const next = await change(tx, f)
      if (!next || !Object.keys(next.changes).length) return { dto: toFollowUp(f), notice: null }
      const row = await tx.followUp.update({
        where: { id },
        data: { ...next.data, version: { increment: 1 } },
        include: FOLLOW_UP_INCLUDE,
      })
      if (next.rearm && row.status === 'PENDING') await this.arm(tx, tenantId, id, row.version)
      await this.audit.write(tx, {
        action: next.audit,
        targetType: 'follow_up',
        targetId: id,
        changes: next.changes,
      })
      const notice =
        next.notifyAssignee && next.notifyAssignee !== actor.userId
          ? await this.assignedNotice(tx, tenantId, row, row.contact, next.notifyAssignee)
          : null
      return { dto: toFollowUp(row), notice }
    })
    this.emit(tenantId, dto, notice)
    return dto
  }

  /**
   * Object-level access. Managers (followups.manage) act on any follow-up; others on follow-ups
   * assigned to or created by them, and only the assignee (or a manager) reassigns.
   */
  private authorize(actor: Actor, f: { assigneeId: string; createdBy: string | null }, a: Action) {
    if (actor.manager) return
    const mine = f.assigneeId === actor.userId
    if (a === 'reassign' ? mine : mine || f.createdBy === actor.userId) return
    throw new AppError(
      'FORBIDDEN',
      403,
      a === 'reassign'
        ? 'Only the assignee or a manager can reassign this follow-up.'
        : 'Only the assignee, its creator or a manager can change this follow-up.',
    )
  }

  private async find(tx: TenantTx, id: string, actor: Actor) {
    const f = await tx.followUp.findFirst({
      where: { AND: [{ id }, this.visible(actor)] },
      include: FOLLOW_UP_INCLUDE,
    })
    if (!f) throw AppError.notFound('Follow-up not found.')
    return f
  }

  private visible(actor: Actor): Prisma.FollowUpWhereInput {
    return actor.manager ? {} : { OR: [{ assigneeId: actor.userId }, { createdBy: actor.userId }] }
  }

  private actor(): Actor {
    return {
      userId: currentAuth().userId,
      manager: currentTenant().permissions.includes('followups.manage'),
    }
  }

  private filter(actor: Actor, q: FollowUpsQuery): Prisma.FollowUpWhereInput[] {
    if (q.scope === 'team' && !actor.manager)
      throw new AppError('FORBIDDEN', 403, 'Only managers can see the team’s follow-ups.')
    const where: Prisma.FollowUpWhereInput[] = [this.visible(actor)]
    if (q.scope === 'mine') where.push({ assigneeId: actor.userId })
    else if (q.assigneeId) where.push({ assigneeId: q.assigneeId })
    if (q.contactId) where.push({ contactId: q.contactId })
    if (q.conversationId) where.push({ conversationId: q.conversationId })
    if (q.needsReview) where.push({ needsReviewAt: { not: null }, status: 'PENDING' })
    if (q.stageId)
      where.push({
        OR: [
          { opportunity: { stageId: q.stageId } },
          {
            opportunityId: null,
            contact: { opportunities: { some: { status: 'OPEN', stageId: q.stageId } } },
          },
        ],
      })
    if (q.q) {
      const like = likeLiteral(q.q)
      const digits = q.q.replace(/\D/g, '')
      where.push({
        OR: [
          { title: { contains: like, mode: 'insensitive' } },
          { contact: { name: { contains: like, mode: 'insensitive' } } },
          { contact: { waProfileName: { contains: like, mode: 'insensitive' } } },
          ...(digits.length >= 3 ? [{ contact: { phoneE164: { contains: digits } } }] : []),
        ],
      })
    }
    return where
  }

  /** Today and Upcoming use the workspace timezone's calendar day. */
  private async tabFilter(
    tx: TenantTx,
    tab: FollowUpTab | 'pending',
    now: Date,
  ): Promise<Prisma.FollowUpWhereInput> {
    if (tab === 'completed') return { status: 'COMPLETED' }
    if (tab === 'pending') return { status: 'PENDING' }
    if (tab === 'overdue') return { status: 'PENDING', dueAt: { lte: now } }
    const { timezone } = await tx.tenant.findUniqueOrThrow({
      where: { id: currentTenant().tenantId },
      select: { timezone: true },
    })
    const day = localDayBounds(timezone, now)
    return tab === 'today'
      ? { status: 'PENDING', dueAt: { gte: day.start, lt: day.end } }
      : { status: 'PENDING', dueAt: { gte: day.end } }
  }

  /** Re-arms the due reminder for this exact version (outbox → sales.events). */
  private arm(tx: TenantTx, tenantId: string, followUpId: string, version: number) {
    return tx.outboxEvent.create({
      data: {
        tenantId,
        eventType: 'follow_up.scheduled',
        aggregateType: 'follow_up',
        aggregateId: followUpId,
        payload: { followUpId, version },
      },
    })
  }

  private async assignedNotice(
    tx: TenantTx,
    tenantId: string,
    f: { id: string; title: string; conversationId: string | null },
    contact: { name: string | null; waProfileName: string | null; phoneE164: string },
    userId: string,
  ): Promise<{ userId: string; notification: Notification }> {
    return {
      userId,
      notification: await createNotification(tx, {
        tenantId,
        userId,
        type: 'follow_up.assigned',
        title: 'Follow-up assigned to you',
        body: `${f.title} · ${customerLabel(contact)}`.slice(0, 200),
        link: followUpLink(tenantId, f),
      }),
    }
  }

  private emit(
    tenantId: string,
    dto: FollowUp,
    notice: { userId: string; notification: Notification } | null,
  ) {
    if (notice) this.realtime.toUser(notice.userId, 'notification.created', notice.notification)
    // IDs only: every member's browser refreshes the lists it shows.
    this.realtime.toTenant(tenantId, 'follow_up.changed', {
      id: dto.id,
      contactId: dto.contact.id,
      conversationId: dto.conversationId,
    })
  }
}
