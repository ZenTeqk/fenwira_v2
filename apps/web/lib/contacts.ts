import { type BadgeTone } from '@fenwira/ui'
import {
  type ConsentState,
  type PropertyDefinition,
  type Segment,
  type Tag,
  type TagColor,
} from '@fenwira/contracts'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Tag colors come from a fixed enum mapped to badge tones (never free hex). */
export const TAG_TONE: Record<TagColor, BadgeTone> = {
  NEUTRAL: 'neutral',
  PRIMARY: 'primary',
  INFO: 'info',
  WARNING: 'warning',
  DANGER: 'danger',
  SUCCESS: 'success',
}

export const CONSENT_LABEL: Record<ConsentState, string> = {
  GRANTED: 'Opted in',
  REVOKED: 'Opted out',
  NONE: 'No consent',
}

export const SOURCE_LABEL: Record<string, string> = {
  INBOUND: 'WhatsApp',
  MANUAL: 'Added manually',
  IMPORT: 'Import',
  API: 'API',
  CAMPAIGN: 'Campaign',
  AUTOMATION: 'Automation',
}

/** Shared catalog queries (tags, properties, segments) for the contacts screens. */
export function useTags() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'tags'),
    queryFn: () =>
      get<{ data: Array<Tag & { contactCount: number }> }>('/tags').then((r) => r.data),
    enabled: can('contacts.read'),
  })
}

export function useProperties() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'contact-properties'),
    queryFn: () => get<{ data: PropertyDefinition[] }>('/contact-properties').then((r) => r.data),
    enabled: can('contacts.read'),
  })
}

export function useSegments() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: keys.tenant(tenantId, 'segments'),
    queryFn: () => get<{ data: Segment[] }>('/segments').then((r) => r.data),
    enabled: can('contacts.read'),
  })
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso))
