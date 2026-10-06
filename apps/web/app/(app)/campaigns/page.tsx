'use client'

import { type Campaign } from '@fenwira/contracts'
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fenwira/ui'
import { ArrowUpRight, Plus } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CampaignResults } from '@/components/campaigns/campaign-results'
import { useSession } from '@/components/session/session-provider'
import { ApiError } from '@/lib/api/client'
import { campaignAudienceLabel, formatInZone, PAUSE_LABEL, useCampaigns } from '@/lib/campaigns'

const isActive = (c: Campaign) =>
  ['SCHEDULED', 'PREPARING', 'RUNNING'].includes(c.status) || c.status.startsWith('PAUSED')
const viewId = (label: string) => label.toLowerCase().replaceAll(' ', '-')
const VIEWS = ['All campaigns', 'Active', 'Scheduled', 'Paused', 'Completed', 'Drafts']
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
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <Link
              href={`/campaigns/${c.id}`}
              className={cn(
                'break-words text-md font-semibold text-slate hover:underline',
                focusRing,
              )}
            >
              {c.name}
            </Link>
            <p className="text-sm text-muted">
              {campaignAudienceLabel(c)}
              {c.audience.exclude.length ? ' · exclusions applied' : ''}
            </p>
          </div>
          <StatusBadge status={c.status} />
        </div>
        {c.template ? (
          <div className="rounded-md border border-border bg-neutral-soft p-3">
            <p className="mb-1 text-sm font-medium text-secondary">{c.template.name}</p>
            <p className="line-clamp-2 text-sm text-slate">{c.template.components.body.text}</p>
          </div>
        ) : null}
        <CampaignResults campaign={c} />
        {pause ? (
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
          <span className="text-sm text-muted">
            {at
              ? `${c.status === 'SCHEDULED' ? 'Scheduled' : 'Started'} ${formatInZone(at, c.timezone)} (${c.timezone})`
              : 'Preparing the audience'}
          </span>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/campaigns/${c.id}`}>
              Open campaign
              <ArrowUpRight aria-hidden="true" />
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
            <span className="text-sm text-muted">{campaignAudienceLabel(row.original)}</span>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'template',
        header: 'Message',
        cell: ({ row }) => row.original.template?.name ?? 'Not selected',
      },
      {
        id: 'results',
        header: 'Delivery results',
        cell: ({ row }) => <CampaignResults campaign={row.original} compact />,
      },
      {
        id: 'when',
        header: 'Scheduled or started',
        cell: ({ row }) => {
          const c = row.original
          const at = c.status === 'SCHEDULED' ? c.scheduleAt : (c.startedAt ?? c.launchedAt)
          return at ? formatInZone(at, c.timezone) : 'Not launched'
        },
      },
    ],
    [],
  )
  if (!can('campaigns.read')) return <PermissionState what="campaigns" />
  const visible = (campaigns.data ?? []).filter(
    (c) =>
      c.name.toLowerCase().includes(search.trim().toLowerCase()) &&
      (view === 'All campaigns' ||
        (view === 'Active' && isActive(c)) ||
        (view === 'Scheduled' && c.status === 'SCHEDULED') ||
        (view === 'Paused' && c.status.startsWith('PAUSED')) ||
        (view === 'Completed' && c.status === 'COMPLETED') ||
        (view === 'Drafts' && c.status === 'DRAFT')),
  )
  const active = visible.filter(isActive)
  const history = visible.filter((c) => !isActive(c))
  const filtered = !!search.trim() || view !== 'All campaigns'
  const create = can('campaigns.write') ? (
    <Button asChild>
      <Link href="/campaigns/new">
        <Plus aria-hidden="true" />
        New campaign
      </Link>
    </Button>
  ) : undefined
  return (
    <ListPage
      header={{
        title: 'Campaigns',
        description: 'WhatsApp messages prepared for your audiences.',
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
        <TabsList aria-label="Campaign views">
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={viewId(v)}>
              {v}
            </TabsTrigger>
          ))}
        </TabsList>
        <FilterBar
          activeCount={filtered ? 1 : 0}
          onClear={() => {
            setSearch('')
            setView(VIEWS[0]!)
            setLimit(4)
          }}
        >
          <SearchInput
            label="Search campaigns"
            placeholder="Search campaigns"
            value={search}
            onValueChange={(v) => {
              setSearch(v)
              setLimit(4)
            }}
          />
        </FilterBar>
        <TabsContent value={viewId(view)} className="flex flex-col gap-6">
          {campaigns.isPending ? (
            <div
              className="grid gap-4 lg:grid-cols-2"
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
                  ? 'Try another campaign name or view.'
                  : 'Choose an approved message and an audience, then review who can receive it before sending.'
              }
              action={
                !filtered && can('campaigns.write') ? (
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
                <section aria-label="Active campaigns" className="flex flex-col gap-4">
                  <h2 className="text-md font-semibold text-slate">In progress & scheduled</h2>
                  <div className="grid gap-4 lg:grid-cols-2">
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
                <section aria-label="Campaign history" className="flex flex-col gap-3">
                  <h2 className="text-md font-semibold text-slate">
                    {view === 'Drafts' ? 'Drafts' : 'History & drafts'}
                  </h2>
                  <DataTable
                    label="Campaigns"
                    columns={columns}
                    data={history}
                    getRowId={(c) => c.id}
                    empty={{ title: 'No history yet' }}
                  />
                </section>
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>
    </ListPage>
  )
}
