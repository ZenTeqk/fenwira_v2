import type { Campaign, VariableSource } from '@fenwira/contracts'

export const FIELD_LABEL = {
  firstName: 'First name',
  name: 'Full name',
  phone: 'Phone number',
  email: 'Email',
  country: 'Country',
} as const

/**
 * Template body for a campaign summary: positional `{{n}}` placeholders read as their mapped source
 * (a static value, or the contact field/property in brackets). Unmapped variables stay as written.
 */
export function campaignBodyPreview(text: string, body: VariableSource[] = []): string {
  return text.replace(/\{\{(\d+)\}\}/g, (raw, n: string) => {
    const source = body[Number(n) - 1]
    if (!source) return raw
    if (source.kind === 'STATIC') return source.value
    return `[${source.kind === 'FIELD' ? FIELD_LABEL[source.field] : source.key}]`
  })
}

export const isActive = (c: Campaign) =>
  ['SCHEDULED', 'PREPARING', 'RUNNING'].includes(c.status) || c.status.startsWith('PAUSED')
export const viewId = (label: string) => label.toLowerCase().replaceAll(' ', '-')
export const VIEWS = ['All', 'Active', 'Scheduled', 'Completed', 'Paused', 'Drafts']
export const matchesView = (c: Campaign, view: string) =>
  view === 'All' ||
  (view === 'Active' && isActive(c)) ||
  (view === 'Scheduled' && c.status === 'SCHEDULED') ||
  (view === 'Paused' && c.status.startsWith('PAUSED')) ||
  (view === 'Completed' && c.status === 'COMPLETED') ||
  (view === 'Drafts' && c.status === 'DRAFT')

/** Present only the API's loaded collection; never manufacture metrics or mutate query data. */
export function selectCampaigns(
  campaigns: Campaign[],
  filters: {
    search: string
    view: string
    status: string
    source: string
    period: string
    sort: string
  },
  now = Date.now(),
) {
  const { search, view, status, source, period, sort } = filters
  return campaigns
    .filter(
      (c) =>
        c.name.toLowerCase().includes(search.trim().toLowerCase()) &&
        matchesView(c, view) &&
        (status === 'ALL' || c.status === status) &&
        (source === 'ALL' || c.audience.include.some((s) => s.kind === source)) &&
        (period === 'ALL' || Date.parse(c.createdAt) >= now - Number(period) * 86_400_000),
    )
    .sort((a, b) =>
      sort === 'NAME'
        ? a.name.localeCompare(b.name)
        : sort === 'OLDEST'
          ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
          : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
}
