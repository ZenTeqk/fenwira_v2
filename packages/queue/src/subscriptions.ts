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
  // Campaign snapshot + dispatch (docs/CAMPAIGN_ENGINE.md); analytics recomputes the campaign.
  'campaign.launched': [QUEUES.campaignDispatch, QUEUES.analyticsEvents],
  'campaign.resumed': [QUEUES.campaignDispatch, QUEUES.analyticsEvents],
  'campaign.completed': [QUEUES.analyticsEvents],
  'message.outbound.requested': [QUEUES.whatsappOutbound, QUEUES.analyticsEvents],
  // Contacts handles opt-in/out keywords and Meta's 131050 opt-out; automation triggers;
  // analytics projects (docs/ANALYTICS.md → Event pipeline).
  'message.inbound.received': [
    QUEUES.contactsEvents,
    QUEUES.automationTrigger,
    QUEUES.analyticsEvents,
  ],
  // Contacts (131050 opt-out), campaign recipient status, billing settlement, analytics.
  'message.status.changed': [
    QUEUES.contactsEvents,
    QUEUES.campaignEvents,
    QUEUES.billingUsage,
    QUEUES.analyticsEvents,
  ],
  'contact.created': [QUEUES.automationTrigger],
  'contact.updated': [],
  'consent.changed': [],
  // Low-balance notifications to members with billing.read (P11-D12).
  'wallet.low_balance': [QUEUES.notificationsDispatch],
  'wallet.recovered': [QUEUES.notificationsDispatch],
  // Only a first funding that is already low notifies anyone (P11-D21).
  'wallet.funded': [QUEUES.notificationsDispatch],
  // Auto-assign (round robin) on open; analytics records the episode.
  'conversation.opened': [QUEUES.inboxEvents, QUEUES.analyticsEvents],
  'conversation.assigned': [QUEUES.analyticsEvents],
  // Automation outcomes for analytics (Phase 11).
  'automation.execution.finished': [QUEUES.analyticsEvents],
  // Takeover stops running automation immediately (P10-D2).
  'conversation.automation_state.changed': [QUEUES.automationTrigger],
}

export function subscribersFor(eventType: string): readonly QueueName[] {
  return Object.prototype.hasOwnProperty.call(EVENT_SUBSCRIPTIONS, eventType)
    ? EVENT_SUBSCRIPTIONS[eventType as DomainEventType]
    : []
}
