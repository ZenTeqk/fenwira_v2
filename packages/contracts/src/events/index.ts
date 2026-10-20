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
  'native.transfer_requested': z.object({ transferId: z.uuid() }),
  'contacts.import_prepared': z.object({ importJobId: z.uuid() }),
  // Every committed ledger posting (IDs only); projections resolve the actual posting day.
  'billing.transaction_posted': z.object({ transactionId: z.uuid() }),
  'commercial.operation_completed': z.object({ operationId: z.uuid() }),
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
  // `messageId`: the customer message that opened it (analytics episodes; added in Phase 11).
  'conversation.opened': z.object({
    conversationId: z.uuid(),
    contactId: z.uuid(),
    messageId: z.uuid().optional(),
  }),
  // Inbox (Phase 7).
  'conversation.assigned': z.object({
    conversationId: z.uuid(),
    assigneeId: z.uuid().nullable(),
    previousAssigneeId: z.uuid().nullable(),
  }),
  'conversation.automation_state.changed': z.object({
    conversationId: z.uuid(),
    from: z.string(),
    to: z.string(),
    actorId: z.uuid().nullable(),
  }),
  // Contacts (Phase 6). Subscribers (automation, analytics) arrive in P10–P11.
  'contact.created': z.object({ contactId: z.uuid(), source: z.string() }),
  'contact.updated': z.object({ contactId: z.uuid(), changedFields: z.array(z.string()) }),
  'consent.changed': z.object({
    contactId: z.uuid(),
    purpose: z.string(),
    status: z.string(),
    source: z.string(),
  }),
  // Campaigns (Phase 9): dispatch work is started by these, in the same transaction as the state.
  'campaign.launched': z.object({ campaignId: z.uuid() }),
  'campaign.resumed': z.object({ campaignId: z.uuid() }),
  'campaign.completed': z.object({ campaignId: z.uuid() }),
  // Templates (Phase 8): a version's status changed (Meta review, pause, disable, sync).
  'template.status.changed': z.object({
    templateId: z.uuid(),
    versionId: z.uuid(),
    from: z.string(),
    to: z.string(),
  }),
  // Billing (Phase 11, P11-D12): emitted in the wallet change's transaction on a state crossing
  // only, never on every debit. `to` is the new funds state.
  'wallet.low_balance': z.object({
    walletId: z.uuid(),
    from: z.enum(['NORMAL', 'LOW_BALANCE', 'INSUFFICIENT_FUNDS']),
    to: z.enum(['LOW_BALANCE', 'INSUFFICIENT_FUNDS']),
    availableMinor: z.number().int(),
    currency: z.string(),
  }),
  // Phase 11 Step 4 (P11-D24): an OWNER asked for a plan; operators activate it.
  'subscription.plan_requested': z.object({ subscriptionId: z.uuid(), planId: z.uuid() }),
  // P11-D21: an unfunded wallet's first available funds (not a recovery).
  'wallet.funded': z.object({
    walletId: z.uuid(),
    to: z.enum(['NORMAL', 'LOW_BALANCE']),
    availableMinor: z.number().int(),
    currency: z.string(),
  }),
  'wallet.recovered': z.object({
    walletId: z.uuid(),
    from: z.enum(['LOW_BALANCE', 'INSUFFICIENT_FUNDS']),
    availableMinor: z.number().int(),
    currency: z.string(),
  }),
  // Automation (Phase 11 analytics): an execution reached a terminal state (finishExecution).
  'automation.execution.finished': z.object({
    executionId: z.uuid(),
    flowId: z.uuid(),
    status: z.enum(['COMPLETED', 'FAILED', 'CANCELLED', 'STOPPED_TAKEOVER']),
  }),
  // WhatsApp accounts (Phase 4). Templates sync a newly connected WABA.
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
