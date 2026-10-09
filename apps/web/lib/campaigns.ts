'use client'

import {
  type Campaign,
  type CampaignRecipient,
  type CampaignStats,
  type CampaignStatus,
  type SkipReason,
} from '@fenwira/contracts'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

export const campaignsKey = (tenantId: string, ...rest: string[]) =>
  keys.tenant(tenantId, 'campaigns', ...rest)

/** Statuses where numbers still move: poll while in them. */
export const ACTIVE_STATUSES: CampaignStatus[] = ['SCHEDULED', 'PREPARING', 'RUNNING']

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  NO_MARKETING_CONSENT: 'No marketing consent',
  OPTED_OUT: 'Opted out',
  INVALID_PHONE: 'Invalid phone number',
  BLOCKED: 'Blocked contact',
  TEMPLATE_UNAVAILABLE: 'Template became unavailable',
  TEMPLATE_NOT_APPROVED: 'Template not approved',
  MISSING_VARIABLE: 'Missing a variable value',
  OTHER_POLICY_RESTRICTION: 'Other messaging restriction',
  CANCELLED: 'Campaign cancelled',
}
export const skipLabel = (reason: string) => SKIP_REASON_LABEL[reason as SkipReason] ?? reason

export const PAUSE_LABEL: Record<string, string> = {
  MANUAL: 'Paused by your team.',
  NUMBER_UNAVAILABLE: 'The WhatsApp number is disconnected. Reconnect it, then resume.',
  SUBSCRIPTION_INACTIVE:
    'The workspace’s trial or subscription has ended. Resume after a plan is active again.',
}

export { FIELD_LABEL } from './campaign-presentation'

export function useCampaigns() {
  const { tenantId, can } = useSession()
  return useQuery({
    enabled: can('campaigns.read'),
    queryKey: campaignsKey(tenantId, 'list'),
    queryFn: () => get<{ data: Campaign[] }>('/campaigns').then((r) => r.data),
    refetchInterval: (q) =>
      q.state.data?.some((c) => ACTIVE_STATUSES.includes(c.status)) ? 5000 : false,
  })
}

export function useCampaign(id: string) {
  const { tenantId } = useSession()
  return useQuery({
    queryKey: campaignsKey(tenantId, 'one', id),
    queryFn: () => get<{ data: Campaign }>(`/campaigns/${id}`).then((r) => r.data),
    refetchInterval: (q) =>
      q.state.data && ACTIVE_STATUSES.includes(q.state.data.status) ? 3000 : false,
  })
}

export function useCampaignStats(id: string, live: boolean, enabled = true) {
  const { tenantId, can } = useSession()
  return useQuery({
    enabled: enabled && can('campaigns.read'),
    queryKey: campaignsKey(tenantId, 'stats', id),
    queryFn: () => get<{ data: CampaignStats }>(`/campaigns/${id}/stats`).then((r) => r.data),
    refetchInterval: live ? 3000 : false,
  })
}

export function useRecipients(id: string, status: string, live: boolean) {
  const { tenantId } = useSession()
  return useInfiniteQuery({
    queryKey: campaignsKey(tenantId, 'recipients', id, status),
    queryFn: ({ pageParam }) =>
      get<{ data: CampaignRecipient[]; page: { nextCursor: string | null } }>(
        `/campaigns/${id}/recipients?limit=50${status ? `&status=${status}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    refetchInterval: live ? 5000 : false,
  })
}

export { formatMoney as money } from '@/lib/billing'

export const percent = (rate: number | null) =>
  rate === null ? '—' : `${(rate * 100).toFixed(rate >= 0.995 || rate === 0 ? 0 : 1)}%`

/** "26 Sep 2026, 6:30 pm" in the workspace timezone. */
export const formatInZone = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(
    new Date(iso),
  )

/** Offset (ms) of `timeZone` from UTC at instant `at`. */
function zoneOffset(at: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(
    +parts.year!,
    +parts.month! - 1,
    +parts.day!,
    +parts.hour!,
    +parts.minute!,
    +parts.second!,
  )
  return asUtc - at.getTime()
}

/** `date` (YYYY-MM-DD) and `time` (HH:mm) in the workspace timezone → a UTC ISO instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!)
  const first = guess - zoneOffset(new Date(guess), timeZone)
  const second = guess - zoneOffset(new Date(first), timeZone) // settles across DST changes
  return new Date(second).toISOString()
}

/** A UTC instant → { date, time } fields in the workspace timezone. */
export function utcToZoned(iso: string, timeZone: string): { date: string; time: string } {
  const at = new Date(iso)
  const local = new Date(at.getTime() + zoneOffset(at, timeZone))
  const s = local.toISOString()
  return { date: s.slice(0, 10), time: s.slice(11, 16) }
}

/** Presentation of existing audience sources; never invent a segment/tag name from its ID. */
export function campaignAudienceLabel(c: Campaign) {
  if (!c.audience.include.length) return 'Audience not chosen'
  return c.audience.include
    .map((source) => {
      switch (source.kind) {
        case 'TAGS':
          return `${source.tagIds.length} tag${source.tagIds.length === 1 ? '' : 's'} (${source.match === 'ALL' ? 'all' : 'any'})`
        case 'SEGMENT':
          return 'Saved segment'
        case 'FILTER':
          return 'Contact filter'
        case 'IMPORT':
          return 'Contact import'
        case 'CONTACTS':
          return `${source.contactIds.length.toLocaleString('en-IN')} selected contacts`
      }
    })
    .join(' · ')
}

/** Same late-receipt refresh window as the existing campaign detail. */
export const campaignResultsLive = (c: Campaign) =>
  ACTIVE_STATUSES.includes(c.status) ||
  Boolean(c.completedAt && Date.now() - new Date(c.completedAt).getTime() < 3600_000)

/** JSONB may reorder object keys. Compare editor state by values, preserving array order. */
export function campaignConfigSignature(value: unknown): string {
  const ordered = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(ordered)
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, ordered(item)]),
      )
    return input
  }
  return JSON.stringify(ordered(value))
}
