import {
  addBusinessMinutes,
  type BusinessHours,
  businessHoursSchema,
  DEFAULT_BUSINESS_HOURS,
  hasBusinessHours,
  type Notification,
  type Role,
  roleHasPermission,
} from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'
import { createNotificationOnce } from '../notifications'

/**
 * "Waiting for staff" episodes and response alerts (docs/RESPONSE_ALERTS.md). All state is in
 * Postgres; every function runs inside the caller's tenant transaction after lockConversation(),
 * so concurrent events for one conversation apply one at a time and in any order.
 */

export type Level = 'UNASSIGNED' | 'RESPONSE' | 'ESCALATION'
export type Notice = { userId: string; notification: Notification }
export type IssueCode = 'NO_ESCALATION_RECIPIENT' | 'NO_ASSIGN_RECIPIENT' | 'NO_BUSINESS_HOURS'

export const ISSUE_MESSAGES: Record<IssueCode, string> = {
  NO_ESCALATION_RECIPIENT:
    'An escalation was due, but no escalation recipient is an active manager in this workspace. Choose recipients below.',
  NO_ASSIGN_RECIPIENT:
    'An alert was due, but no active member can assign conversations. Check roles in Settings → Team.',
  NO_BUSINESS_HOURS:
    'Business hours are closed every day, so no business minutes pass and alerts never fire.',
}

/** Customer messages that don't ask for a reply. */
const NO_ATTENTION_TYPES = new Set(['REACTION', 'SYSTEM_EVENT'])
/** Outbound statuses that mean Meta accepted the send. */
const ACCEPTED = ['SENT', 'DELIVERED', 'READ'] as const
/**
 * Customer messages carry Meta's whole-second timestamp; staff replies carry milliseconds. A
 * customer message in the same second as a staff reply can't be ordered, so it counts as
 * unanswered (never miss an enquiry): a reply answers only messages at least a second older.
 */
export const SAME_SECOND_MS = 1000

export function lockConversation(tx: TenantTx, conversationId: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wait:${conversationId}`}))`
}

export async function loadSchedule(
  tx: TenantTx,
  tenantId: string,
): Promise<{ schedule: BusinessHours; configured: boolean; timezone: string }> {
  const t = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { businessHours: true, timezone: true },
  })
  const parsed = businessHoursSchema.safeParse(t.businessHours ?? DEFAULT_BUSINESS_HOURS)
  return {
    schedule: parsed.success ? parsed.data : DEFAULT_BUSINESS_HOURS,
    configured: t.businessHours !== null,
    timezone: t.timezone,
  }
}

/**
 * A bot is handling the conversation: automation is active on it and an execution is running, or
 * waiting for the customer's answer to a bot menu, or in an AI Assistant conversation. A run
 * that only waits on a timer (a delay step) is not handling the customer.
 */
export async function botHandling(
  tx: TenantTx,
  c: { id: string; automationState: string },
): Promise<boolean> {
  if (c.automationState !== 'AUTOMATION_ACTIVE') return false
  const rows = await tx.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM automation_executions e
    WHERE e.conversation_id = ${c.id}::uuid
      AND (e.status = 'RUNNING'
        OR (e.status = 'WAITING' AND (e.context->'reply'->>'promptNode' IS NOT NULL
                                   OR e.context->'ai'->>'mode' = 'CONVERSATION')))
    LIMIT 1`
  return rows.length > 0
}

export function openEpisode(tx: TenantTx, conversationId: string) {
  return tx.conversationWaitEpisode.findFirst({ where: { conversationId, endedAt: null } })
}

/**
 * Starts an episode at the customer message `m`, unless one is already open (the oldest
 * outstanding wait is kept), the message no longer waits (a later accepted staff reply, or a
 * resolution after it), or the conversation's contact is blocked.
 */
export async function startEpisode(
  tx: TenantTx,
  tenantId: string,
  m: { id: string; conversationId: string; createdAt: Date },
  now: Date,
): Promise<'started' | 'already' | 'answered'> {
  if (await openEpisode(tx, m.conversationId)) return 'already'
  const c = await tx.conversation.findFirstOrThrow({
    where: { id: m.conversationId },
    include: { contact: { select: { status: true } } },
  })
  if (c.contact.status === 'BLOCKED') return 'answered'
  // A customer message reopens a resolved conversation, so one that is resolved now was resolved
  // after this message.
  if (c.status === 'RESOLVED') return 'answered'
  const replied = await tx.message.findFirst({
    where: {
      conversationId: m.conversationId,
      direction: 'OUTBOUND',
      source: 'INBOX',
      status: { in: [...ACCEPTED] },
      createdAt: { gte: new Date(m.createdAt.getTime() + SAME_SECOND_MS) },
    },
    select: { id: true },
  })
  if (replied) return 'answered'
  const bot = await botHandling(tx, c)
  await tx.conversationWaitEpisode.create({
    data: {
      tenantId,
      conversationId: m.conversationId,
      startedAt: m.createdAt,
      startMessageId: m.id,
      botHandling: bot,
      clockStartedAt: bot ? null : m.createdAt,
      // Checked within a minute: confirms bot handling (the trigger may run just after this)
      // and computes the first real alert time.
      nextCheckAt: now,
    },
  })
  return 'started'
}

/**
 * Ends the open episode when it started at or before `cutoff` (a staff reply created after the
 * customer's message, or a resolution), then opens a new one from the first customer message
 * after the cutoff, if any is still unanswered.
 */
export async function endEpisode(
  tx: TenantTx,
  tenantId: string,
  conversationId: string,
  cutoff: Date,
  reason: 'STAFF_REPLY' | 'RESOLVED' | 'BLOCKED' | 'DISABLED',
  now: Date,
  endMessageId?: string,
): Promise<boolean> {
  const ep = await openEpisode(tx, conversationId)
  if (!ep || ep.startedAt > cutoff) return false
  await tx.conversationWaitEpisode.update({
    where: { id: ep.id },
    data: {
      endedAt: now,
      endReason: reason,
      endMessageId: endMessageId ?? null,
      nextCheckAt: null,
    },
  })
  if (reason === 'DISABLED') return true
  const later = await tx.message.findFirst({
    where: {
      conversationId,
      direction: 'INBOUND',
      source: 'CUSTOMER',
      createdAt: { gt: cutoff },
      type: { notIn: [...NO_ATTENTION_TYPES] as never },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, conversationId: true, createdAt: true },
  })
  if (later) await startEpisode(tx, tenantId, later, now)
  return true
}

export const needsAttention = (type: string) => !NO_ATTENTION_TYPES.has(type)

type Member = { userId: string; name: string; role: Role }
async function activeMembers(tx: TenantTx): Promise<Member[]> {
  const rows = await tx.membership.findMany({
    where: { status: 'ACTIVE' },
    include: { user: { select: { name: true } } },
  })
  return rows.map((r) => ({ userId: r.userId, name: r.user.name, role: r.role as Role }))
}

export type Settings = {
  enabled: boolean
  enabledAt: Date | null
  unassignedMinutes: number
  responseMinutes: number
  escalationMinutes: number
  escalationUserIds: string[]
}

export async function setIssue(tx: TenantTx, tenantId: string, code: IssueCode | null) {
  await tx.responseAlertSettings.updateMany({
    where: { tenantId },
    data: code
      ? { issueCode: code, issueMessage: ISSUE_MESSAGES[code], issueAt: new Date() }
      : { issueCode: null, issueMessage: null, issueAt: null },
  })
}

/**
 * One check of an open episode: re-reads the conversation and settings, pauses the staff timer
 * while a bot handles the conversation, fires each due alert level once, and stores when the next
 * level becomes due (null when nothing more can fire until something changes).
 */
export async function evaluateEpisode(
  tx: TenantTx,
  tenantId: string,
  episodeId: string,
  now: Date,
  enabled: boolean,
): Promise<{ outcome: string; notices: Notice[]; conversationId?: string }> {
  const ep = await tx.conversationWaitEpisode.findFirst({ where: { id: episodeId } })
  if (!ep || ep.endedAt) return { outcome: 'ended', notices: [] }
  await lockConversation(tx, ep.conversationId)
  const fresh = await tx.conversationWaitEpisode.findFirstOrThrow({ where: { id: episodeId } })
  if (fresh.endedAt) return { outcome: 'ended', notices: [] }
  const conversationId = fresh.conversationId
  const c = await tx.conversation.findFirstOrThrow({
    where: { id: conversationId },
    include: {
      contact: { select: { name: true, waProfileName: true, phoneE164: true, status: true } },
      assignee: { select: { id: true, name: true } },
    },
  })
  const set = (data: Parameters<TenantTx['conversationWaitEpisode']['update']>[0]['data']) =>
    tx.conversationWaitEpisode.update({ where: { id: episodeId }, data })
  if (!enabled) {
    await endEpisode(tx, tenantId, conversationId, now, 'DISABLED', now)
    return { outcome: 'disabled', notices: [], conversationId }
  }
  if (c.status === 'RESOLVED') {
    await endEpisode(tx, tenantId, conversationId, now, 'RESOLVED', now)
    return { outcome: 'resolved', notices: [], conversationId }
  }
  if (c.contact.status === 'BLOCKED') {
    await endEpisode(tx, tenantId, conversationId, now, 'BLOCKED', now)
    return { outcome: 'blocked', notices: [], conversationId }
  }
  if (await botHandling(tx, c)) {
    await set({ botHandling: true, clockStartedAt: null, nextCheckAt: null })
    return { outcome: 'bot', notices: [], conversationId }
  }
  let clock = fresh.clockStartedAt
  if (!clock || fresh.botHandling) {
    // The bot stopped without an event we saw (or never started): the staff timer starts now.
    clock = now
    await set({ botHandling: false, clockStartedAt: now })
  }
  const settings = await tx.responseAlertSettings.findUnique({ where: { tenantId } })
  if (!settings?.enabled) {
    await set({ nextCheckAt: null })
    return { outcome: 'alerts_off', notices: [], conversationId }
  }
  if (c.status === 'SNOOZED' && c.snoozedUntil && c.snoozedUntil > now) {
    await set({ nextCheckAt: c.snoozedUntil })
    return { outcome: 'snoozed', notices: [], conversationId }
  }
  const { schedule } = await loadSchedule(tx, tenantId)
  if (!hasBusinessHours(schedule)) {
    await setIssue(tx, tenantId, 'NO_BUSINESS_HOURS')
    await set({ nextCheckAt: null })
    return { outcome: 'no_hours', notices: [], conversationId }
  }
  const levels: Array<{ level: Level; minutes: number; done: Date | null; applies: boolean }> = [
    {
      level: 'UNASSIGNED',
      minutes: settings.unassignedMinutes,
      done: fresh.unassignedAlertedAt,
      applies: c.assigneeId === null,
    },
    {
      level: 'RESPONSE',
      minutes: settings.responseMinutes,
      done: fresh.responseAlertedAt,
      applies: true,
    },
    {
      level: 'ESCALATION',
      minutes: settings.escalationMinutes,
      done: fresh.escalatedAt,
      applies: true,
    },
  ]
  const members = await activeMembers(tx)
  const notices: Notice[] = []
  const stamps: Record<string, Date> = {}
  let next: Date | null = null
  for (const l of levels) {
    if (l.done || !l.applies) continue
    const due = addBusinessMinutes(schedule, clock, l.minutes)
    if (!due) continue
    // Never alert for time that passed before alerts were turned on (no historical alerts).
    if (settings.enabledAt && due < settings.enabledAt) continue
    if (due > now) {
      if (!next || due < next) next = due
      continue
    }
    const sent = await fire(tx, tenantId, fresh.id, l.level, l.minutes, c, members, settings)
    notices.push(...sent)
    stamps[
      l.level === 'UNASSIGNED'
        ? 'unassignedAlertedAt'
        : l.level === 'RESPONSE'
          ? 'responseAlertedAt'
          : 'escalatedAt'
    ] = now
  }
  await set({ ...stamps, nextCheckAt: next })
  return { outcome: notices.length ? 'alerted' : 'checked', notices, conversationId }
}

async function fire(
  tx: TenantTx,
  tenantId: string,
  episodeId: string,
  level: Level,
  minutes: number,
  c: {
    id: string
    assigneeId: string | null
    assignee: { id: string; name: string } | null
    contact: { name: string | null; waProfileName: string | null; phoneE164: string }
  },
  members: Member[],
  settings: Settings,
): Promise<Notice[]> {
  const assigners = members.filter((m) => roleHasPermission(m.role, 'inbox.reassign'))
  let recipients: Member[]
  if (level === 'UNASSIGNED') recipients = assigners
  else if (level === 'RESPONSE') {
    const assignee = members.find(
      (m) => m.userId === c.assigneeId && roleHasPermission(m.role, 'inbox.read'),
    )
    recipients = assignee ? [assignee] : assigners
  } else recipients = assigners.filter((m) => settings.escalationUserIds.includes(m.userId))
  if (!recipients.length) {
    await setIssue(
      tx,
      tenantId,
      level === 'ESCALATION' ? 'NO_ESCALATION_RECIPIENT' : 'NO_ASSIGN_RECIPIENT',
    )
    return []
  }
  const customer = c.contact.name ?? c.contact.waProfileName ?? c.contact.phoneE164
  const copy: Record<Level, { title: string; body: string; severity: 'WARNING' | 'CRITICAL' }> = {
    UNASSIGNED: {
      title: 'Customer waiting, no one assigned',
      body: `${customer} has waited ${minutes} business minutes and the conversation is unassigned.`,
      severity: 'WARNING',
    },
    RESPONSE: {
      title: 'Customer waiting for a reply',
      body: `${customer} has waited ${minutes} business minutes for a reply.`,
      severity: 'WARNING',
    },
    ESCALATION: {
      title: 'Escalation: customer still waiting',
      body: `${customer} has waited ${minutes} business minutes. ${
        c.assignee ? `Assigned to ${c.assignee.name}.` : 'No one is assigned.'
      }`,
      severity: 'CRITICAL',
    },
  }
  const out: Notice[] = []
  for (const r of recipients) {
    const n = await createNotificationOnce(tx, {
      tenantId,
      userId: r.userId,
      type: `response_alert.${level.toLowerCase()}`,
      severity: copy[level].severity,
      title: copy[level].title,
      body: copy[level].body.slice(0, 200),
      link: `/inbox?c=${c.id}&ws=${tenantId}`,
      dedupeKey: `wait:${episodeId}:${level}`,
    })
    if (n) out.push({ userId: r.userId, notification: n })
  }
  return out
}
