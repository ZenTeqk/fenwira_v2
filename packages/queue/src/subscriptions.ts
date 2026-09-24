import { type DomainEventType } from '@fenwira/contracts'
import { QUEUES, type QueueName } from './names'

/**
 * Domain event → subscriber queues (ADR-0012). The outbox relay enqueues one job per
 * subscriber. Every DomainEventType must appear here, even with no subscribers yet.
 */
export const EVENT_SUBSCRIPTIONS: Record<DomainEventType, readonly QueueName[]> = {
  'system.ping.requested': [QUEUES.systemPing],
  'identity.email_verification.requested': [QUEUES.identityEvents],
  'identity.password_reset.requested': [QUEUES.identityEvents],
  'tenancy.invitation.sent': [QUEUES.tenancyEvents],
  'whatsapp.connection.changed': [],
}

export function subscribersFor(eventType: string): readonly QueueName[] {
  return Object.prototype.hasOwnProperty.call(EVENT_SUBSCRIPTIONS, eventType)
    ? EVENT_SUBSCRIPTIONS[eventType as DomainEventType]
    : []
}
