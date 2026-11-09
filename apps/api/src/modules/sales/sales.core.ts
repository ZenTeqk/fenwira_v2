import {
  DEFAULT_SALES_STAGES,
  type FollowUp,
  type Opportunity,
  type Permission,
  type Role,
  roleHasPermission,
  type SalesStageRef,
} from '@fenwira/contracts'
import { type Prisma, type TenantTx } from '@fenwira/database'
import { requestContext } from '../../core/context/request-context'
import { AppError } from '../../core/http/app-error'

/** Whether the workspace's rollout switch for follow-ups, sales and response alerts is on. */
export async function salesEnabled(tx: TenantTx, tenantId: string): Promise<boolean> {
  const t = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { salesFollowupsEnabled: true },
  })
  return t?.salesFollowupsEnabled ?? false
}

/** Writes need the rollout switch; reads stay available (they return nothing new). */
export async function assertSalesEnabled(tx: TenantTx, tenantId: string): Promise<void> {
  if (!(await salesEnabled(tx, tenantId)))
    throw new AppError(
      'FEATURE_NOT_ENABLED',
      403,
      'Follow-ups and sales are not turned on for this workspace.',
    )
}

/**
 * The workspace's stages, creating the five defaults the first time (idempotent: the seeded
 * rows carry stable keys, so a concurrent first use inserts nothing twice).
 */
export async function ensureStages(tx: TenantTx, tenantId: string) {
  const existing = await tx.salesStage.count()
  if (existing === 0)
    await tx.salesStage.createMany({
      data: DEFAULT_SALES_STAGES.map((s, i) => ({
        tenantId,
        key: s.key,
        name: s.name,
        outcome: s.outcome,
        position: i,
      })),
      skipDuplicates: true,
    })
  return tx.salesStage.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] })
}

export const stageRef = (s: { id: string; name: string; outcome: string }): SalesStageRef => ({
  id: s.id,
  name: s.name,
  outcome: s.outcome as SalesStageRef['outcome'],
})

/**
 * An assignee or sales owner must be an ACTIVE member of this workspace whose role holds
 * `permission`. RLS already limits memberships to the bound tenant.
 */
export async function requireMember(
  tx: TenantTx,
  userId: string,
  permission: Permission,
  path: string,
): Promise<{ id: string; name: string }> {
  const m = await tx.membership.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { user: { select: { id: true, name: true } } },
  })
  if (!m || !roleHasPermission(m.role as Role, permission))
    throw AppError.validation([
      { path, code: 'not_member', message: 'Choose an active teammate who can work on this.' },
    ])
  return m.user
}

/** Contact timeline entry (contact_activities is append-only), attributed like the audit log. */
export async function writeActivity(
  tx: TenantTx,
  a: { tenantId: string; contactId: string; type: string; data: Record<string, unknown> },
): Promise<void> {
  const ctx = requestContext.get()
  const actorId = ctx?.apiKey ? null : (ctx?.auth?.userId ?? null)
  await tx.contactActivity.create({
    data: {
      tenantId: a.tenantId,
      contactId: a.contactId,
      type: a.type,
      actorType: ctx?.apiKey ? 'API_KEY' : actorId ? 'USER' : 'SYSTEM',
      actorId,
      data: a.data as Prisma.InputJsonValue,
    },
  })
}

// ------------------------------------------------------------------------------- mapping

export const OPPORTUNITY_INCLUDE = {
  stage: { select: { id: true, name: true, outcome: true } },
  owner: { select: { id: true, name: true } },
  _count: { select: { followUps: { where: { status: 'PENDING' } } } },
} satisfies Prisma.OpportunityInclude

type OpportunityRow = Prisma.OpportunityGetPayload<{ include: typeof OPPORTUNITY_INCLUDE }>
const iso = (d: Date | null) => d?.toISOString() ?? null

export function toOpportunity(o: OpportunityRow): Opportunity {
  return {
    id: o.id,
    contactId: o.contactId,
    conversationId: o.conversationId,
    title: o.title,
    stage: stageRef(o.stage),
    status: o.status,
    owner: o.owner,
    expectedValueMinor: o.expectedValueMinor === null ? null : Number(o.expectedValueMinor),
    currency: o.currency,
    closedAt: iso(o.closedAt),
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    pendingFollowUps: o._count.followUps,
  }
}

export const FOLLOW_UP_INCLUDE = {
  contact: {
    select: {
      id: true,
      name: true,
      waProfileName: true,
      phoneE164: true,
      opportunities: {
        where: { status: 'OPEN' },
        select: { stage: { select: { id: true, name: true, outcome: true } } },
        take: 1,
      },
    },
  },
  opportunity: { select: { stage: { select: { id: true, name: true, outcome: true } } } },
  assignee: { select: { id: true, name: true } },
  creator: { select: { id: true, name: true } },
} satisfies Prisma.FollowUpInclude

type FollowUpRow = Prisma.FollowUpGetPayload<{ include: typeof FOLLOW_UP_INCLUDE }>

export function toFollowUp(f: FollowUpRow, now = new Date()): FollowUp {
  const stage = f.opportunity?.stage ?? f.contact.opportunities[0]?.stage ?? null
  return {
    id: f.id,
    title: f.title,
    note: f.note,
    status: f.status,
    dueAt: f.dueAt.toISOString(),
    overdue: f.status === 'PENDING' && f.dueAt <= now,
    needsReview: f.status === 'PENDING' && f.needsReviewAt !== null,
    contact: {
      id: f.contact.id,
      name: f.contact.name,
      waProfileName: f.contact.waProfileName,
      phoneE164: f.contact.phoneE164,
    },
    conversationId: f.conversationId,
    opportunityId: f.opportunityId,
    salesStage: stage ? stageRef(stage) : null,
    assignee: f.assignee,
    createdBy: f.creator,
    completedAt: iso(f.completedAt),
    cancelledAt: iso(f.cancelledAt),
    version: f.version,
    createdAt: f.createdAt.toISOString(),
  }
}

/** A customer-facing name for notifications (no message content is ever included). */
export const customerLabel = (c: {
  name: string | null
  waProfileName: string | null
  phoneE164: string
}) => c.name ?? c.waProfileName ?? c.phoneE164

/** Notification link: the conversation when there is one, else the follow-up list. */
export const followUpLink = (tenantId: string, f: { id: string; conversationId: string | null }) =>
  f.conversationId
    ? `/inbox?c=${f.conversationId}&ws=${tenantId}`
    : `/follow-ups?task=${f.id}&ws=${tenantId}`
