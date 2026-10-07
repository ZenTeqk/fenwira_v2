'use client'

import { CAMPAIGN_STATUSES, type Campaign } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  cn,
  type ColumnDef,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  focusRing,
  ListPage,
  PermissionState,
  SearchInput,
  Skeleton,
  StatusBadge,
  Badge,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fenwira/ui'
import { ArrowRight, CalendarDays, FileText, Megaphone, Plus, Users } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CampaignResults } from '@/components/campaigns/campaign-results'
import { useSession } from '@/components/session/session-provider'
import { ApiError } from '@/lib/api/client'
import {
  campaignAudienceLabel,
  campaignResultsLive,
  percent,
  formatInZone,
  PAUSE_LABEL,
  useCampaigns,
  useCampaignStats,
} from '@/lib/campaigns'

const isActive = (c: Campaign) =>
  ['SCHEDULED', 'PREPARING', 'RUNNING'].includes(c.status) || c.status.startsWith('PAUSED')
const viewId = (label: string) => label.toLowerCase().replaceAll(' ', '-')
const VIEWS = ['All', 'Active', 'Scheduled', 'Completed', 'Paused', 'Drafts']
const matchesView = (c: Campaign, view: string) =>
  view === 'All' ||
  (view === 'Active' && isActive(c)) ||
  (view === 'Scheduled' && c.status === 'SCHEDULED') ||
  (view === 'Paused' && c.status.startsWith('PAUSED')) ||
  (view === 'Completed' && c.status === 'COMPLETED') ||
  (view === 'Drafts' && c.status === 'DRAFT')

function ResultsCell({
  campaign,
  field,
}: {
  campaign: Campaign
  field: 'sent' | 'deliveryRate' | 'readRate'
}) {
  const results = useCampaignStats(
    campaign.id,
    campaignResultsLive(campaign),
    Boolean(campaign.audienceSnapshotAt),
  )
  if (!campaign.audienceSnapshotAt) return <span className="text-muted">—</span>
  if (results.isPending) return <Skeleton className="h-4 w-12" />
  if (results.isError || !results.data)
    return (
      <Button variant="link" size="sm" onClick={() => void results.refetch()}>
        Retry results
      </Button>
    )
  return (
    <span className="tabular-nums">
      {field === 'sent' ? results.data.sent.toLocaleString('en-IN') : percent(results.data[field])}
    </span>
  )
}
function CampaignFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<[string, string]>
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-9 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([id, name]) => (
          <SelectItem key={id} value={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
function CampaignCard({ campaign: c }: { campaign: Campaign }) {
  const { can } = useSession()
  const at = c.status === 'SCHEDULED' ? c.scheduleAt : (c.startedAt ?? c.launchedAt)
  const pause =
    c.status === 'PAUSED_INSUFFICIENT_FUNDS'
      ? 'Add credits, then resume. Unsent recipients are waiting; sent results are preserved.'
      : c.status === 'PAUSED_TEMPLATE_UNAVAILABLE'
        ? 'The frozen template is unavailable. Resume when the same version is sendable, or cancel and create another campaign.'
        : c.status === 'PAUSED'
          ? PAUSE_LABEL[c.pauseReason ?? 'MANUAL']
          : null
  return (
    <Card className={cn(c.status === 'RUNNING' && 'border-primary')} data-campaign-card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                'flex size-12 shrink-0 items-center justify-center rounded-lg',
                c.status === 'SCHEDULED'
                  ? 'bg-info-soft text-info-strong'
                  : 'bg-primary-soft text-primary-strong',
              )}
            >
              <Megaphone className="size-6" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Link
                href={`/campaigns/${c.id}`}
                className={cn(
                  'break-words text-md font-semibold text-slate hover:underline',
                  focusRing,
                )}
              >
                {c.name}
              </Link>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-secondary">
                <Users aria-hidden="true" className="size-3.5" />
                {campaignAudienceLabel(c)}
                {c.audience.exclude.length ? ' · exclusions applied' : ''}
              </p>
              {c.template ? (
                <p className="text-xs text-secondary">
                  {c.template.category === 'MARKETING'
                    ? 'Marketing'
                    : c.template.category === 'UTILITY'
                      ? 'Utility'
                      : 'Authentication'}{' '}
                  · {c.template.language}
                </p>
              ) : null}
            </div>
          </div>
          <StatusBadge status={c.status} />
        </div>
        {c.status === 'SCHEDULED' && c.scheduleAt ? (
          <div className="flex items-start gap-2 rounded-md bg-info-soft p-3 text-info-strong">
            <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-base font-medium">{formatInZone(c.scheduleAt, c.timezone)}</p>
              <p className="text-xs">{c.timezone} · Audience prepared at launch</p>
            </div>
          </div>
        ) : (
          <CampaignResults campaign={c} />
        )}
        {pause && c.status === 'PAUSED' && (!c.pauseReason || c.pauseReason === 'MANUAL') ? (
          <p className="text-sm text-secondary">{pause}</p>
        ) : pause ? (
          <Alert
            tone={c.status === 'PAUSED_INSUFFICIENT_FUNDS' ? 'danger' : 'warning'}
            title="Needs attention"
          >
            {pause}
            {c.status === 'PAUSED_INSUFFICIENT_FUNDS' && can('billing.read') ? (
              <Link
                href="/billing/wallet"
                className={cn('ml-1 underline underline-offset-4', focusRing)}
              >
                Open wallet
              </Link>
            ) : null}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-secondary">
            <FileText aria-hidden="true" className="size-4 shrink-0" />
            {c.template?.name ?? 'Message frozen at launch'}
            {c.status !== 'SCHEDULED' && at ? ` · Started ${formatInZone(at, c.timezone)}` : ''}
          </span>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/campaigns/${c.id}`}>
              View campaign
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** Communications in progress first, followed by focused campaign history. */
export default function CampaignsPage() {
  const { can } = useSession()
  const campaigns = useCampaigns()
  const [search, setSearch] = useState('')
  const [view, setView] = useState(VIEWS[0]!)
  const [limit, setLimit] = useState(4)
  const [status, setStatus] = useState('ALL')
  const [period, setPeriod] = useState('ALL')
  const [source, setSource] = useState('ALL')
  const [sort, setSort] = useState('NEWEST')
  const resetFilters = () => {
    setSearch('')
    setView(VIEWS[0]!)
    setStatus('ALL')
    setPeriod('ALL')
    setSource('ALL')
    setLimit(4)
  }
  const columns = useMemo<Array<ColumnDef<Campaign>>>(
    () => [
      {
        accessorKey: 'name',
        header: 'Campaign',
        cell: ({ row }) => (
          <div className="flex flex-col gap-1">
            <Link
              href={`/campaigns/${row.original.id}`}
              className={cn('font-medium text-slate hover:underline', focusRing)}
            >
              {row.original.name}
            </Link>
            <span className="text-xs text-secondary">
              {row.original.template?.name ?? 'Draft · message chosen in Studio'}
            </span>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'audience',
        header: 'Audience',
        cell: ({ row }) => (
          <span className="text-sm text-secondary">{campaignAudienceLabel(row.original)}</span>
        ),
      },
      {
        id: 'sent',
        header: 'Sent',
        cell: ({ row }) => <ResultsCell campaign={row.original} field="sent" />,
      },
      {
        id: 'delivered',
        header: 'Delivered',
        cell: ({ row }) => <ResultsCell campaign={row.original} field="deliveryRate" />,
      },
      {
        id: 'read',
        header: 'Read',
        cell: ({ row }) => <ResultsCell campaign={row.original} field="readRate" />,
      },
      {
        id: 'when',
        header: 'Date',
        cell: ({ row }) => {
          const c = row.original
          const at = c.status === 'SCHEDULED' ? c.scheduleAt : (c.startedAt ?? c.launchedAt)
          return (
            <span className="text-xs text-secondary">
              {formatInZone(at ?? c.createdAt, c.timezone)}
            </span>
          )
        },
      },
    ],
    [],
  )
  if (!can('campaigns.read')) return <PermissionState what="campaigns" />
  const visible = (campaigns.data ?? [])
    .filter(
      (c) =>
        c.name.toLowerCase().includes(search.trim().toLowerCase()) &&
        matchesView(c, view) &&
        (status === 'ALL' || c.status === status) &&
        (source === 'ALL' || c.audience.include.some((s) => s.kind === source)) &&
        (period === 'ALL' || Date.parse(c.createdAt) >= Date.now() - Number(period) * 86_400_000),
    )
    .sort((a, b) =>
      sort === 'NAME'
        ? a.name.localeCompare(b.name)
        : sort === 'OLDEST'
          ? Date.parse(a.createdAt) - Date.parse(b.createdAt)
          : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
  const active = visible.filter(isActive)
  const history = visible.filter((c) => !isActive(c))
  const filtered =
    !!search.trim() || view !== 'All' || status !== 'ALL' || period !== 'ALL' || source !== 'ALL'
  const create = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/campaigns/analytics">Campaign analytics</Link>
      </Button>
      {can('campaigns.write') ? (
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus aria-hidden="true" />
            Create campaign
          </Link>
        </Button>
      ) : null}
    </div>
  )
  return (
    <ListPage
      className="gap-4 [&_[data-slot=page-header]>div>div]:max-w-full"
      header={{
        title: 'Campaigns',
        description: 'Create, schedule and monitor WhatsApp campaigns.',
        actions: create,
      }}
    >
      <Tabs
        value={viewId(view)}
        onValueChange={(v) => {
          setView(VIEWS.find((label) => viewId(label) === v) ?? VIEWS[0]!)
          setLimit(4)
        }}
      >
        <TabsList aria-label="Campaign views" className="mb-0 border-b-0">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={viewId(v)}>
              {v}
              {campaigns.data && v !== 'All' ? (
                <Badge className="ml-1 px-1.5 py-0 text-xs" tone="neutral">
                  {campaigns.data.filter((c) => matchesView(c, v)).length}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        <FilterBar
          className="rounded-lg border border-border bg-surface p-3"
          activeCount={
            [
              Boolean(search.trim()),
              view !== 'All',
              status !== 'ALL',
              period !== 'ALL',
              source !== 'ALL',
            ].filter(Boolean).length
          }
          onClear={resetFilters}
        >
          <SearchInput
            label="Search campaigns"
            placeholder="Search campaigns…"
            value={search}
            onValueChange={(v) => {
              setSearch(v)
              setLimit(4)
            }}
          />
          <CampaignFilter
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              ['ALL', 'Any status'],
              ...CAMPAIGN_STATUSES.map((s): [string, string] => [
                s,
                s.toLowerCase().replaceAll('_', ' '),
              ]),
            ]}
          />
          <CampaignFilter
            label="Created date"
            value={period}
            onChange={setPeriod}
            options={[
              ['ALL', 'Any date'],
              ['7', 'Created last 7 days'],
              ['30', 'Created last 30 days'],
            ]}
          />
          <CampaignFilter
            label="Audience"
            value={source}
            onChange={setSource}
            options={[
              ['ALL', 'Any audience'],
              ['TAGS', 'Tagged contacts'],
              ['SEGMENT', 'Saved segment'],
              ['FILTER', 'Contact filter'],
              ['IMPORT', 'Contact import'],
              ['CONTACTS', 'Selected contacts'],
            ]}
          />
          <div className="lg:ml-auto">
            <CampaignFilter
              label="Sort campaigns"
              value={sort}
              onChange={setSort}
              options={[
                ['NEWEST', 'Newest first'],
                ['OLDEST', 'Oldest first'],
                ['NAME', 'Campaign name'],
              ]}
            />
          </div>
        </FilterBar>
        <TabsContent value={viewId(view)} className="flex flex-col gap-4">
          {campaigns.isPending ? (
            <div
              className="grid gap-3 xl:grid-cols-2"
              role="status"
              aria-busy="true"
              aria-label="Loading campaigns"
            >
              <Skeleton className="h-64" />
              <Skeleton className="h-64" />
            </div>
          ) : campaigns.isError ? (
            <ErrorState
              title="Campaigns couldn’t be loaded"
              description={
                campaigns.error instanceof ApiError ? campaigns.error.message : undefined
              }
              onRetry={() => void campaigns.refetch()}
            />
          ) : !visible.length ? (
            <EmptyState
              title={filtered ? 'No matching campaigns' : 'Prepare your first campaign'}
              description={
                filtered
                  ? 'Try another campaign name or filter.'
                  : 'Choose an approved message and an audience, then review who can receive it before sending.'
              }
              action={
                filtered ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : can('campaigns.write') ? (
                  <Button asChild>
                    <Link href="/campaigns/new">
                      <Plus aria-hidden="true" />
                      Create your first campaign
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {active.length ? (
                <section aria-label="Active campaigns" className="flex flex-col gap-3">
                  <h2 className="text-md font-semibold text-slate">Active & scheduled</h2>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {active.slice(0, limit).map((c) => (
                      <CampaignCard key={c.id} campaign={c} />
                    ))}
                  </div>
                  {active.length > limit ? (
                    <Button
                      variant="secondary"
                      className="self-start"
                      onClick={() => setLimit((n) => n + 4)}
                    >
                      Show more campaigns
                    </Button>
                  ) : null}
                </section>
              ) : null}
              {history.length ? (
                <section
                  aria-label="Campaign history"
                  className="overflow-hidden rounded-lg border border-border bg-surface"
                >
                  <h2 className="border-b border-border px-4 py-3 text-md font-semibold text-slate">
                    {view === 'Drafts' ? 'Drafts' : 'Campaign history'}
                  </h2>
                  <div className="[&_td]:py-3 [&_th]:py-2">
                    <DataTable
                      label="Campaigns"
                      columns={columns}
                      data={history}
                      getRowId={(c) => c.id}
                      empty={{ title: 'No history yet' }}
                    />
                  </div>
                </section>
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>
    </ListPage>
  )
}
