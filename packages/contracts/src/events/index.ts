import { z } from 'zod'

/**
 * Domain event types (docs/ARCHITECTURE.md → Domain event catalog). Payloads carry IDs only;
 * the envelope fields (eventId, tenantId, correlationId, occurredAt) are added by the outbox relay.
 */
export const eventEnvelopeSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string(),
  tenantId: z.uuid().nullable(),
  correlationId: z.string().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
})
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>

/** Platform (tenant-less) probe used to verify api → outbox → relay → queue → worker end to end. */
export const systemPingRequestedSchema = z.object({
  requestedAt: z.iso.datetime({ offset: true }),
})

export const EVENT_PAYLOAD_SCHEMAS = {
  'system.ping.requested': systemPingRequestedSchema,
  // Identity (platform events: tenant_id NULL). The worker creates the token and sends the
  // email, so raw tokens never touch the database or the outbox.
  'identity.email_verification.requested': z.object({ userId: z.uuid() }),
  'identity.password_reset.requested': z.object({ userId: z.uuid() }),
  // Tenancy (tenant events). The worker (re)generates the invitation token and emails it.
  'tenancy.invitation.sent': z.object({ invitationId: z.uuid() }),
  // Messaging (Phase 5). IDs only; consumers reload what they need inside withTenant.
  'message.outbound.requested': z.object({ messageId: z.uuid() }),
  'message.inbound.received': z.object({
    messageId: z.uuid(),
    conversationId: z.uuid(),
    contactId: z.uuid(),
  }),
  'message.status.changed': z.object({
    messageId: z.uuid(),
    from: z.string(),
    to: z.string(),
    errorCode: z.string().optional(),
    pricing: z.unknown().optional(),
  }),
  'conversation.opened': z.object({ conversationId: z.uuid(), contactId: z.uuid() }),
  // Contacts (Phase 6). Subscribers (automation, analytics) arrive in P10–P11.
  'contact.created': z.object({ contactId: z.uuid(), source: z.string() }),
  'contact.updated': z.object({ contactId: z.uuid(), changedFields: z.array(z.string()) }),
  'consent.changed': z.object({
    contactId: z.uuid(),
    purpose: z.string(),
    status: z.string(),
    source: z.string(),
  }),
  // WhatsApp accounts (Phase 4). Subscribers arrive with the inbox/notifications phases.
  'whatsapp.connection.changed': z.object({
    phoneId: z.uuid(),
    change: z.enum(['CONNECTED', 'DISCONNECTED', 'STATUS_CHANGED', 'CREDENTIAL_CHANGED']),
  }),
} as const

export type DomainEventType = keyof typeof EVENT_PAYLOAD_SCHEMAS
export type DomainEventPayload<T extends DomainEventType> = z.infer<
  (typeof EVENT_PAYLOAD_SCHEMAS)[T]
>
export type DomainEvent<T extends DomainEventType = DomainEventType> = EventEnvelope & {
  eventType: T
  payload: DomainEventPayload<T>
}

export function isDomainEventType(value: string): value is DomainEventType {
  return Object.prototype.hasOwnProperty.call(EVENT_PAYLOAD_SCHEMAS, value)
}
