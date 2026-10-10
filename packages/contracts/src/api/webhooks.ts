import { z } from 'zod'

/**
 * Outbound webhooks (docs/WEBHOOKS.md, decision P11-D18). A curated allowlist, never every
 * internal domain event: message status, conversation, contact, campaign and automation-outcome
 * events only. Each entry names the domain event it is delivered from.
 */
export const WEBHOOK_EVENTS = [
  'message.status.changed',
  'message.inbound.received',
  'conversation.opened',
  'conversation.assigned',
  'contact.created',
  'contact.updated',
  'campaign.completed',
  'automation.execution.finished',
] as const
export const webhookEventTypeSchema = z.enum(WEBHOOK_EVENTS)
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>

/**
 * The external payload envelope (a stable, versioned public contract — independent of internal
 * outbox payload shapes, which may change freely). `apiVersion` is a date; a breaking change ships
 * as a new date and old subscribers keep the shape they signed up for until they opt in.
 * Redelivery is normal: integrators deduplicate on `eventId` (or `id` for one delivery attempt).
 */
export const webhookPayloadSchema = z.object({
  /** This delivery attempt's id. Changes on redelivery; `eventId` does not. */
  id: z.uuid(),
  type: webhookEventTypeSchema,
  apiVersion: z.literal('2026-09-28'),
  createdAt: z.iso.datetime({ offset: true }),
  /** The source domain event id: stable across every delivery attempt and any redelivery. */
  eventId: z.uuid(),
  data: z.record(z.string(), z.unknown()),
})
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>

export const webhookEndpointSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  url: z.string(),
  events: z.array(webhookEventTypeSchema),
  status: z.enum(['ACTIVE', 'DISABLED']),
  failureCount: z.number().int(),
  createdBy: z.uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type WebhookEndpoint = z.infer<typeof webhookEndpointSchema>

// `url` is deliberately a loose string here, not `z.url({ protocol: /^https$/ })`: the same
// pattern as the automation webhook action's URL field (packages/contracts/src/automation/graph.ts).
// The contract layer only bounds shape; WebhooksService.assertUrl (safeFetch's validateDestination)
// is the one place that enforces https-only and blocks private/reserved addresses, with its
// `devHosts` development exception — a hard `https` requirement here would make that exception
// unreachable for local dev/test receivers, since this schema runs before the service does.
export const createWebhookEndpointRequestSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().trim().min(8).max(2000),
  events: z.array(webhookEventTypeSchema).min(1),
})
export type CreateWebhookEndpointRequest = z.infer<typeof createWebhookEndpointRequestSchema>

export const updateWebhookEndpointRequestSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  url: z.string().trim().min(8).max(2000).optional(),
  events: z.array(webhookEventTypeSchema).min(1).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
})
export type UpdateWebhookEndpointRequest = z.infer<typeof updateWebhookEndpointRequestSchema>

/** Returned once, at creation and at each rotation only. */
export const createdWebhookEndpointSchema = z.object({
  endpoint: webhookEndpointSchema,
  secret: z.string(),
})
export type CreatedWebhookEndpoint = z.infer<typeof createdWebhookEndpointSchema>

export const webhookDeliverySchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  /** A subscribed event type, or `webhook.test` for a manually triggered test delivery. */
  eventType: z.string(),
  attempt: z.number().int(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
  responseStatus: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  nextAttemptAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>

export const webhookDeliveryDetailSchema = webhookDeliverySchema.extend({
  payload: webhookPayloadSchema,
  responseBody: z.string().nullable(),
})
export type WebhookDeliveryDetail = z.infer<typeof webhookDeliveryDetailSchema>

export const webhookDeliveriesQuerySchema = z.object({
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
})
export type WebhookDeliveriesQuery = z.infer<typeof webhookDeliveriesQuerySchema>

/** Headers sent with every delivery (docs/WEBHOOKS.md → Signing). */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Fenwira-Signature'
export const WEBHOOK_EVENT_HEADER = 'X-Fenwira-Event'
export const WEBHOOK_DELIVERY_HEADER = 'X-Fenwira-Delivery'
export const WEBHOOK_TIMESTAMP_HEADER = 'X-Fenwira-Timestamp'
