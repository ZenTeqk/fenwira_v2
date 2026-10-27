import { type Prisma, type TenantTx } from '@fenwira/database'
import { currentTenant } from '../tenancy'

/**
 * Which conversations this user may see (docs/INBOX.md → Visibility): everything, except an AGENT
 * in an ASSIGNED_ONLY workspace sees only their own and unassigned conversations. The one rule for
 * the conversation list, thread, counts and message attachments.
 */
export async function conversationVisibility(
  tx: TenantTx,
  userId: string,
): Promise<Prisma.ConversationWhereInput> {
  const { tenantId, role } = currentTenant() as { tenantId: string; role: string }
  if (role !== 'AGENT') return {}
  const t = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { inboxVisibility: true },
  })
  return t.inboxVisibility === 'ASSIGNED_ONLY'
    ? { OR: [{ assigneeId: userId }, { assigneeId: null }] }
    : {}
}
