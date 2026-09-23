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
