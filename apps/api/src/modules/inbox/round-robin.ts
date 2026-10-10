import { type Role, roleHasPermission } from '@fenwira/contracts'
import { type Database } from '@fenwira/database'
import { type RealtimeEmitter } from '../../core/realtime/realtime-emitter'
import { assignConversation } from './inbox.core'
import { type PresenceService } from './presence.service'

export type RoundRobinResult = 'assigned' | 'already-assigned' | 'nobody-online' | 'not-found'

/**
 * Round-robin pick (docs/INBOX.md → Assignment), shared by inbox auto-assign and the automation
 * `assign_agent` action: the ONLINE member with inbox.reply and the fewest OPEN assigned
 * conversations; ties → least recently assigned. Never replaces an existing assignee.
 */
export async function assignRoundRobin(
  db: Database,
  presence: PresenceService,
  tenantId: string,
  conversationId: string,
  realtime?: RealtimeEmitter,
): Promise<RoundRobinResult> {
  const agents = await db.withTenant(tenantId, async (tx) => {
    const members = await tx.membership.findMany({
      where: { status: 'ACTIVE' },
      select: { userId: true, role: true },
    })
    return members
      .filter((m) => roleHasPermission(m.role as Role, 'inbox.reply'))
      .map((m) => m.userId)
  })
  const online: string[] = []
  for (const id of agents) if ((await presence.read(tenantId, id)) === 'ONLINE') online.push(id)
  if (!online.length) return 'nobody-online'
  const outcome = await db.withTenant(tenantId, async (tx) => {
    const load = await tx.conversation.groupBy({
      by: ['assigneeId'],
      where: { assigneeId: { in: online }, status: 'OPEN' },
      _count: { _all: true },
      _max: { assignedAt: true },
    })
    const stats = new Map(
      load.map((l) => [
        l.assigneeId!,
        { open: l._count._all, last: l._max.assignedAt?.getTime() ?? 0 },
      ]),
    )
    const pick = [...online].sort((a, b) => {
      const x = stats.get(a) ?? { open: 0, last: 0 }
      const y = stats.get(b) ?? { open: 0, last: 0 }
      return x.open - y.open || x.last - y.last || a.localeCompare(b)
    })[0]!
    const fresh = await tx.conversation.findFirst({ where: { id: conversationId } })
    if (!fresh) return { result: 'not-found' as const }
    if (fresh.assigneeId) return { result: 'already-assigned' as const }
    const pushed = await assignConversation(tx, {
      tenantId,
      conversation: fresh,
      assigneeId: pick,
      actor: { id: null, name: null },
    })
    return { result: 'assigned' as const, pushed }
  })
  if (outcome.result === 'assigned' && outcome.pushed && realtime)
    realtime.toUser(outcome.pushed.userId, 'notification.created', outcome.pushed.notification)
  return outcome.result
}
