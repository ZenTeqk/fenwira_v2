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
  // A newly connected number's WABA gets its templates imported (docs/TEMPLATE_ENGINE.md).
  'whatsapp.connection.changed': [QUEUES.templatesSync],
  // Campaigns subscribe in Phase 9.
  'template.status.changed': [],
  // Campaign snapshot + dispatch (docs/CAMPAIGN_ENGINE.md).
  'campaign.launched': [QUEUES.campaignDispatch],
  'campaign.resumed': [QUEUES.campaignDispatch],
  'campaign.completed': [],
  'message.outbound.requested': [QUEUES.whatsappOutbound],
  // Subscribers (contacts keywords, automation, analytics, billing, campaigns) arrive in P6–P11.
  // Contacts handles opt-in/out keywords and Meta's 131050 opt-out; automation, analytics,
  // billing and campaigns subscribe in P9–P11.
  'message.inbound.received': [QUEUES.contactsEvents],
  // Contacts (131050 opt-out), campaign recipient status, billing settlement.
  'message.status.changed': [QUEUES.contactsEvents, QUEUES.campaignEvents, QUEUES.billingUsage],
  'contact.created': [],
  'contact.updated': [],
  'consent.changed': [],
  // Auto-assign (round robin) on open; analytics subscribes in P11.
  'conversation.opened': [QUEUES.inboxEvents],
  'conversation.assigned': [],
  'conversation.automation_state.changed': [],
}

export function subscribersFor(eventType: string): readonly QueueName[] {
  return Object.prototype.hasOwnProperty.call(EVENT_SUBSCRIPTIONS, eventType)
    ? EVENT_SUBSCRIPTIONS[eventType as DomainEventType]
    : []
}
