import { type Notification } from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'

export type NewNotification = {
  tenantId: string
  userId: string
  type: string
  title: string
  body: string
  link?: string
  severity?: 'INFO' | 'WARNING' | 'CRITICAL'
  /** Event-driven notifications: one per (user, key), so a redelivered event is a no-op. */
  dedupeKey?: string
}

/** In-app notification row (the caller emits `notification.created` to `user:{id}` after commit). */
export async function createNotification(tx: TenantTx, n: NewNotification): Promise<Notification> {
  const row = await tx.notification.create({
    data: {
      tenantId: n.tenantId,
      userId: n.userId,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link ?? null,
      severity: n.severity ?? 'INFO',
      dedupeKey: n.dedupeKey ?? null,
    },
  })
  return toNotification(row)
}

/** Like createNotification, but returns null when (user, dedupeKey) was already notified. */
export async function createNotificationOnce(
  tx: TenantTx,
  n: NewNotification & { dedupeKey: string },
): Promise<Notification | null> {
  const existing = await tx.notification.findFirst({
    where: { userId: n.userId, dedupeKey: n.dedupeKey },
    select: { id: true },
  })
  return existing ? null : createNotification(tx, n)
}

export const toNotification = (n: {
  id: string
  type: string
  severity: Notification['severity']
  title: string
  body: string
  link: string | null
  readAt: Date | null
  createdAt: Date
}): Notification => ({
  id: n.id,
  type: n.type,
  severity: n.severity,
  title: n.title,
  body: n.body,
  link: n.link,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
})
