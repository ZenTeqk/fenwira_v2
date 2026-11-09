import {
  type CreateOpportunityRequest,
  type Opportunity,
  type SalesOutcome,
  type UpdateOpportunityRequest,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { Injectable } from '@nestjs/common'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { AuditService } from '../audit'
import { currentAuth } from '../identity'
import { conversationVisibility } from '../messaging'
import { currentTenant } from '../tenancy'
import {
  assertSalesEnabled,
  ensureStages,
  OPPORTUNITY_INCLUDE,
  requireMember,
  toOpportunity,
  writeActivity,
} from './sales.core'

const encodeOffset = (n: number) => Buffer.from(JSON.stringify({ o: n })).toString('base64url')
export function decodeOffset(cursor?: string): number {
  if (!cursor) return 0
  try {
    const o = (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o: number }).o
    if (Number.isInteger(o) && o >= 0) return o
  } catch {
    // fall through
  }
  throw new AppError('INVALID_CURSOR', 400, 'The pagination cursor is invalid.')
}
export const offsetPage = <T>(rows: T[], offset: number, limit: number) => {
  const hasMore = rows.length > limit
  return {
    items: rows.slice(0, limit),
    page: { nextCursor: hasMore ? encodeOffset(offset + limit) : null, hasMore, limit },
  }
}

const openConflict = () =>
  new AppError(
    'CONFLICT',
    409,
    'This customer already has an open opportunity. Close it before starting another.',
  )

/**
 * Lightweight opportunities (docs/FOLLOW_UPS_AND_SALES.md → Opportunities). Created explicitly,
 * never inferred from a conversation. One open per contact; closed ones are history, so a repeat
 * purchase is a new opportunity. Stage, owner and outcome changes go to the contact's activity
 * timeline and the audit log. Sales stage is independent of conversation status and assignee.
 */
@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeEmitter,
  ) {}

  async list(q: { contactId?: string; status?: SalesOutcome; limit: number; cursor?: string }) {
    const offset = decodeOffset(q.cursor)
    return this.db.run(async (tx) => {
      const rows = await tx.opportunity.findMany({
        where: {
          ...(q.contactId ? { contactId: q.contactId } : {}),
          ...(q.status ? { status: q.status } : {}),
        },
        include: OPPORTUNITY_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: q.limit + 1,
      })
      return offsetPage(rows.map(toOpportunity), offset, q.limit)
    })
  }

  async get(id: string): Promise<Opportunity> {
    return this.db.run(async (tx) => toOpportunity(await this.find(tx, id)))
  }

  async create(input: CreateOpportunityRequest): Promise<Opportunity> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const result = await this.db.run(async (tx) => {
      await assertSalesEnabled(tx, tenantId)
      await this.lockContact(tx, input.contactId)
      const contact = await tx.contact.findFirst({
        where: { id: input.contactId, deletedAt: null },
      })
      if (!contact) throw AppError.notFound('Contact not found.')
      if (input.conversationId) await this.visibleConversation(tx, input.conversationId, contact.id)
      const stages = await ensureStages(tx, tenantId)
      const stage = input.stageId
        ? stages.find((s) => s.id === input.stageId && !s.archivedAt)
        : stages.find((s) => s.outcome === 'OPEN' && !s.archivedAt)
      if (!stage)
        throw AppError.validation([
          { path: 'stageId', code: 'invalid', message: 'Choose an active stage.' },
        ])
      if (
        stage.outcome === 'OPEN' &&
        (await tx.opportunity.count({ where: { contactId: contact.id, status: 'OPEN' } }))
      )
        throw openConflict()
      const ownerId = input.ownerId === undefined ? userId : input.ownerId
      const owner = ownerId ? await requireMember(tx, ownerId, 'sales.write', 'ownerId') : null
      const value = await this.value(tx, tenantId, input.expectedValueMinor, input.currency)
      const created = await tx.opportunity.create({
        data: {
          tenantId,
          contactId: contact.id,
          conversationId: input.conversationId ?? null,
          stageId: stage.id,
          status: stage.outcome,
          closedAt: stage.outcome === 'OPEN' ? null : new Date(),
          ownerId: owner?.id ?? null,
          title: input.title || null,
          ...value,
          createdBy: userId,
        },
        include: OPPORTUNITY_INCLUDE,
      })
      await writeActivity(tx, {
        tenantId,
        contactId: contact.id,
        type: 'opportunity.created',
        data: {
          opportunityId: created.id,
          stage: stage.name,
          outcome: stage.outcome,
          owner: owner?.name ?? null,
        },
      })
      await this.audit.write(tx, {
        action: 'sales.opportunity_created',
        targetType: 'opportunity',
        targetId: created.id,
        changes: {
          contactId: contact.id,
          stageId: stage.id,
          ownerId: owner?.id ?? null,
          expectedValueMinor: value.expectedValueMinor?.toString() ?? null,
          currency: value.currency,
        },
      })
      return toOpportunity(created)
    })
    this.realtime.toTenant(tenantId, 'sales.updated', { contactId: result.contactId })
    return result
  }

  async update(id: string, input: UpdateOpportunityRequest): Promise<Opportunity> {
    const { tenantId } = currentTenant()
    const { userId } = currentAuth()
    const result = await this.db.run(async (tx) => {
      await assertSalesEnabled(tx, tenantId)
      const before = await this.find(tx, id)
      await this.lockContact(tx, before.contactId)
      await tx.$executeRaw`SELECT id FROM opportunities WHERE id = ${id}::uuid FOR UPDATE`
      const current = await this.find(tx, id)
      const data: Prisma.OpportunityUncheckedUpdateInput = {}
      const changes: Record<string, unknown> = {}
      const activities: Array<{ type: string; data: Record<string, unknown> }> = []
      let cancelled: string[] = []

      if (input.stageId && input.stageId !== current.stageId) {
        const stage = (await ensureStages(tx, tenantId)).find(
          (s) => s.id === input.stageId && !s.archivedAt,
        )
        if (!stage)
          throw AppError.validation([
            { path: 'stageId', code: 'invalid', message: 'Choose an active stage.' },
          ])
        const reopening = current.status !== 'OPEN' && stage.outcome === 'OPEN'
        if (
          reopening &&
          (await tx.opportunity.count({
            where: { contactId: current.contactId, status: 'OPEN', id: { not: id } },
          }))
        )
          throw openConflict()
        data.stageId = stage.id
        data.status = stage.outcome
        if (stage.outcome !== current.status)
          data.closedAt = stage.outcome === 'OPEN' ? null : new Date()
        changes.stage = [current.stage.name, stage.name]
        activities.push({
          type: 'opportunity.stage_changed',
          data: {
            opportunityId: id,
            from: current.stage.name,
            to: stage.name,
            outcome: stage.outcome,
          },
        })
        if (stage.outcome !== current.status) {
          changes.status = [current.status, stage.outcome]
          activities.push({
            type:
              stage.outcome === 'WON'
                ? 'opportunity.won'
                : stage.outcome === 'LOST'
                  ? 'opportunity.lost'
                  : 'opportunity.reopened',
            data: { opportunityId: id, stage: stage.name },
          })
        }
        // Closing never silently cancels follow-ups; only when explicitly asked.
        if (stage.outcome !== 'OPEN' && input.cancelPendingFollowUps) {
          const pending = await tx.followUp.findMany({
            where: { opportunityId: id, status: 'PENDING' },
            select: { id: true },
          })
          cancelled = pending.map((p) => p.id)
          if (cancelled.length)
            await tx.followUp.updateMany({
              where: { id: { in: cancelled }, status: 'PENDING' },
              data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancelledBy: userId,
                version: { increment: 1 },
              },
            })
          for (const followUpId of cancelled)
            await this.audit.write(tx, {
              action: 'follow_up.cancelled',
              targetType: 'follow_up',
              targetId: followUpId,
              changes: { reason: 'opportunity_closed', opportunityId: id },
            })
        }
      }
      if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
        const owner = input.ownerId
          ? await requireMember(tx, input.ownerId, 'sales.write', 'ownerId')
          : null
        data.ownerId = owner?.id ?? null
        changes.ownerId = [current.ownerId, owner?.id ?? null]
        activities.push({
          type: 'opportunity.owner_changed',
          data: { opportunityId: id, from: current.owner?.name ?? null, to: owner?.name ?? null },
        })
      }
      if (input.title !== undefined && (input.title || null) !== current.title) {
        data.title = input.title || null
        changes.title = [current.title, input.title || null]
      }
      if (input.expectedValueMinor !== undefined || input.currency !== undefined) {
        const minor =
          input.expectedValueMinor === undefined
            ? current.expectedValueMinor === null
              ? null
              : Number(current.expectedValueMinor)
            : input.expectedValueMinor
        const value = await this.value(tx, tenantId, minor, input.currency ?? current.currency)
        const was = current.expectedValueMinor?.toString() ?? null
        const now = value.expectedValueMinor?.toString() ?? null
        if (was !== now || current.currency !== value.currency) {
          Object.assign(data, value)
          changes.expectedValue = [
            { minor: was, currency: current.currency },
            { minor: now, currency: value.currency },
          ]
        }
      }
      if (!Object.keys(changes).length) return toOpportunity(current)
      const updated = await tx.opportunity.update({
        where: { id },
        data,
        include: OPPORTUNITY_INCLUDE,
      })
      for (const a of activities)
        await writeActivity(tx, { tenantId, contactId: current.contactId, ...a })
      await this.audit.write(tx, {
        action: 'sales.opportunity_updated',
        targetType: 'opportunity',
        targetId: id,
        changes: { ...changes, ...(cancelled.length ? { cancelledFollowUps: cancelled } : {}) },
      })
      return toOpportunity(updated)
    })
    this.realtime.toTenant(tenantId, 'sales.updated', { contactId: result.contactId })
    return result
  }

  private async find(tx: TenantTx, id: string) {
    const o = await tx.opportunity.findFirst({ where: { id }, include: OPPORTUNITY_INCLUDE })
    if (!o) throw AppError.notFound('Opportunity not found.')
    return o
  }

  /** One writer per contact at a time: the one-open rule and reopen checks stay race-free. */
  private lockContact(tx: TenantTx, contactId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`opportunity:${contactId}`}))`
  }

  private async visibleConversation(tx: TenantTx, conversationId: string, contactId: string) {
    const c = await tx.conversation.findFirst({
      where: {
        AND: [
          { id: conversationId, contactId },
          await conversationVisibility(tx, currentAuth().userId),
        ],
      },
      select: { id: true },
    })
    if (!c) throw AppError.notFound('Conversation not found.')
  }

  /** Integer minor units; the currency defaults to the workspace's. Null clears both. */
  private async value(
    tx: TenantTx,
    tenantId: string,
    minor: number | null | undefined,
    currency: string | null | undefined,
  ): Promise<{ expectedValueMinor: bigint | null; currency: string | null }> {
    if (minor === null || minor === undefined) return { expectedValueMinor: null, currency: null }
    const fallback = currency
      ? null
      : (
          await tx.tenant.findUniqueOrThrow({
            where: { id: tenantId },
            select: { currency: true },
          })
        ).currency
    return { expectedValueMinor: BigInt(minor), currency: currency ?? fallback }
  }
}
