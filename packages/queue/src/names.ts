/**
 * Queue catalog (docs/ARCHITECTURE.md → Queue catalog). BullMQ reserves ':' as its key
 * separator, so names use dots. Queues listed here but not yet consumed are wired by later phases.
 */
export const QUEUES = {
  whatsappInbound: 'whatsapp.inbound',
  whatsappStatus: 'whatsapp.status',
  whatsappOutbound: 'whatsapp.outbound',
  whatsappOutboundDlq: 'whatsapp.outbound.dlq',
  whatsappMedia: 'whatsapp.media',
  whatsappSync: 'whatsapp.sync',
  templatesSync: 'templates.sync',
  identityEvents: 'identity.events',
  tenancyEvents: 'tenancy.events',
  contactsEvents: 'contacts.events',
  contactsImport: 'contacts.import',
  contactsExport: 'contacts.export',
  inboxEvents: 'inbox.events',
  campaignDispatch: 'campaign.dispatch',
  campaignEvents: 'campaign.events',
  automationTrigger: 'automation.trigger',
  automationExecute: 'automation.execute',
  analyticsEvents: 'analytics.events',
  analyticsRollup: 'analytics.rollup',
  billingUsage: 'billing.usage',
  billingMaintenance: 'billing.maintenance',
  notificationsDispatch: 'notifications.dispatch',
  webhooksDeliver: 'webhooks.deliver',
  systemMaintenance: 'system.maintenance',
  systemPing: 'system.ping',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export const ALL_QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUES)

export function isQueueName(value: string): value is QueueName {
  return (ALL_QUEUE_NAMES as readonly string[]).includes(value)
}
