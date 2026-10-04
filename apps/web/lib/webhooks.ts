'use client'

import {
  type CreateWebhookEndpointRequest,
  type CreatedWebhookEndpoint,
  type UpdateWebhookEndpointRequest,
  type WebhookDelivery,
  type WebhookDeliveryDetail,
  type WebhookEndpoint,
  type WebhookEventType,
  WEBHOOK_EVENTS,
} from '@fenwira/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { del, get, patch, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Outbound webhooks (docs/WEBHOOKS.md, decision P11-D18). */

/** Human label and family grouping for the fixed public event catalog — never invent new events. */
export const WEBHOOK_EVENT_LABEL: Record<WebhookEventType, string> = {
  'message.status.changed': 'Message status changed',
  'message.inbound.received': 'Message received',
  'conversation.opened': 'Conversation opened',
  'conversation.assigned': 'Conversation assigned',
  'contact.created': 'Contact created',
  'contact.updated': 'Contact updated',
  'campaign.completed': 'Campaign completed',
  'automation.execution.finished': 'Automation finished',
}

/** `eventType` on a delivery is a plain string (it includes the synthetic `webhook.test`), so
 * this falls back to the raw value for anything outside the known catalog instead of throwing. */
export function eventLabel(eventType: string): string {
  return eventType === 'webhook.test'
    ? 'Test delivery'
    : ((WEBHOOK_EVENT_LABEL as Record<string, string>)[eventType] ?? eventType)
}

export const WEBHOOK_EVENT_FAMILIES: Array<{ label: string; events: WebhookEventType[] }> = [
  { label: 'Messages', events: ['message.status.changed', 'message.inbound.received'] },
  { label: 'Conversations', events: ['conversation.opened', 'conversation.assigned'] },
  { label: 'Contacts', events: ['contact.created', 'contact.updated'] },
  { label: 'Campaigns', events: ['campaign.completed'] },
  { label: 'Automations', events: ['automation.execution.finished'] },
]

/** "2 event types" / "5 event types" for the endpoint card. */
export function eventFamiliesLabel(events: readonly string[]): string {
  const families = new Set(
    WEBHOOK_EVENT_FAMILIES.filter((f) => f.events.some((e) => events.includes(e))).map(
      (f) => f.label,
    ),
  )
  return `${families.size} event ${families.size === 1 ? 'family' : 'families'}`
}

export const ALL_WEBHOOK_EVENTS = WEBHOOK_EVENTS as readonly WebhookEventType[]

export function useWebhookEndpoints() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'webhook-endpoints'),
    queryFn: () => get<{ data: WebhookEndpoint[] }>('/webhook-endpoints').then((r) => r.data),
    enabled: can('integrations.manage'),
  })
}

/** No single-endpoint GET route exists; the detail page reads it from the list cache. */
export function useWebhookEndpoint(id: string) {
  const list = useWebhookEndpoints()
  return {
    ...list,
    data: list.data?.find((e) => e.id === id),
  }
}

export function useCreateWebhookEndpoint() {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateWebhookEndpointRequest) =>
      post<{ data: CreatedWebhookEndpoint }>('/webhook-endpoints', input).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'webhook-endpoints') })
    },
  })
}

export function useUpdateWebhookEndpoint() {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateWebhookEndpointRequest & { id: string }) =>
      patch<{ data: WebhookEndpoint }>(`/webhook-endpoints/${id}`, input).then((r) => r.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'webhook-endpoints') })
    },
  })
}

export function useDeleteWebhookEndpoint() {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => del(`/webhook-endpoints/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'webhook-endpoints') })
    },
  })
}

export function useRotateWebhookSecret() {
  return useMutation({
    mutationFn: (id: string) =>
      post<{ data: { secret: string } }>(`/webhook-endpoints/${id}/rotate-secret`).then(
        (r) => r.data,
      ),
  })
}

export function useTestWebhookDelivery(endpointId: string) {
  const queryClient = useQueryClient()
  const { tenantId } = useSession()
  return useMutation({
    mutationFn: () =>
      post<{ data: { deliveryId: string } }>(`/webhook-endpoints/${endpointId}/test`).then(
        (r) => r.data,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.tenant(tenantId, 'webhook-deliveries', endpointId),
      })
    },
  })
}

export function useWebhookDeliveries(
  endpointId: string,
  query: { status?: 'PENDING' | 'SUCCEEDED' | 'FAILED' } = {},
) {
  const { tenantId } = useSession()
  const qs = query.status ? `?status=${query.status}` : ''
  return useQuery({
    queryKey: keys.tenant(tenantId, 'webhook-deliveries', endpointId, query.status ?? 'all'),
    queryFn: () =>
      get<{ data: WebhookDelivery[] }>(`/webhook-endpoints/${endpointId}/deliveries${qs}`).then(
        (r) => r.data,
      ),
    enabled: !!endpointId,
    refetchInterval: 15_000,
  })
}

export function useWebhookDelivery(endpointId: string, deliveryId: string | undefined) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'webhook-delivery', endpointId, deliveryId ?? 'none'),
    queryFn: () =>
      get<{ data: WebhookDeliveryDetail }>(
        `/webhook-endpoints/${endpointId}/deliveries/${deliveryId}`,
      ).then((r) => r.data),
    enabled: !!deliveryId,
  })
}

export function useRetryWebhookDelivery(endpointId: string) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (deliveryId: string) =>
      post(`/webhook-endpoints/${endpointId}/deliveries/${deliveryId}/retry`),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: keys.tenant(tenantId, 'webhook-deliveries', endpointId),
      })
    },
  })
}
