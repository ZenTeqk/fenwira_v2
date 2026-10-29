import { type TenantTx } from '@fenwira/database'
/** Durable cancellation in the takeover transaction: released automation cannot revive old jobs. */
export async function cancelQueuedAutomation(tx: TenantTx, conversationId: string, now: Date) {
  const queued = await tx.message.findMany({
    where: { conversationId, source: 'AUTOMATION', status: { in: ['CREATED', 'QUEUED'] } },
  })
  for (const message of queued) {
    const cancelled = await tx.message.updateMany({
      where: { id: message.id, status: { in: ['CREATED', 'QUEUED'] } },
      data: {
        status: 'FAILED',
        failedAt: now,
        errorCode: 'AUTOMATION_BLOCKED_BY_TAKEOVER',
        errorDetail: 'Queued reply cancelled by human takeover.',
      },
    })
    if (cancelled.count)
      await tx.outboxEvent.create({
        data: {
          tenantId: message.tenantId,
          eventType: 'message.status.changed',
          aggregateType: 'message',
          aggregateId: message.id,
          payload: {
            messageId: message.id,
            from: message.status,
            to: 'FAILED',
            errorCode: 'AUTOMATION_BLOCKED_BY_TAKEOVER',
          },
        },
      })
  }
}
