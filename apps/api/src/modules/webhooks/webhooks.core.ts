import { type WebhookEventType, type WebhookPayload, WEBHOOK_EVENTS } from '@fenwira/contracts'
import { type EventJob } from '@fenwira/queue'

export const isWebhookEvent = (eventType: string): eventType is WebhookEventType =>
  (WEBHOOK_EVENTS as readonly string[]).includes(eventType)

/**
 * The external, versioned payload for one delivery (docs/WEBHOOKS.md → External contract).
 * `data` carries the same fields as the internal domain event (IDs only, ADR-0012); integrators
 * use the public API to fetch full resources by id. `deliveryId` is filled in once the delivery
 * row exists (it is the delivery's own id, not the source event id).
 */
export function buildWebhookPayload(deliveryId: string, e: EventJob): WebhookPayload {
  return {
    id: deliveryId,
    type: e.eventType as WebhookEventType,
    apiVersion: '2026-09-28',
    createdAt: new Date().toISOString(),
    eventId: e.eventId,
    data: e.payload as Record<string, unknown>,
  }
}
