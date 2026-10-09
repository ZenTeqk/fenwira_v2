'use client'

import { CAMPAIGN_STATUSES, type Campaign } from '@fenwira/contracts'
import {
  Button,
  ListPage,
  PermissionState,
  EmptyState,
  ErrorState,
  FilterBar,
  SearchInput,
  Skeleton,
  Badge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fenwira/ui'
import { BarChart3, Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useTags, useSegments } from '@/lib/contacts'
import { CampaignCard } from '@/components/campaigns/campaign-card'
import { CampaignFilter } from '@/components/campaigns/campaign-filter'
import { CampaignHistory } from '@/components/campaigns/campaign-history'
import { useSession } from '@/components/session/session-provider'
import { campaignAudienceLabel, useCampaigns } from '@/lib/campaigns'

import { isActive, viewId, VIEWS, matchesView, selectCampaigns } from '@/lib/campaign-presentation'

/** Communications in progress first, followed by focused campaign history. */
export default function CampaignsPage() {
  const { can } = useSession()
  const campaigns = useCampaigns()
  const tags = useTags()
  const segments = useSegments()
  const audienceLabel = (c: Campaign) =>
    c.audience.include
      .map((source) => {
        if (source.kind === 'TAGS') {
          const names = source.tagIds.map((id) => tags.data?.find((tag) => tag.id === id)?.name)
          if (names.every(Boolean)) return names.join(source.match === 'ALL' ? ' + ' : ', ')
        }
        if (source.kind === 'SEGMENT')
          return (
            segments.data?.find((segment) => segment.id === source.segmentId)?.name ??
            'Saved segment'
          )
        return campaignAudienceLabel({ ...c, audience: { ...c.audience, include: [source] } })
      })
      .join(' · ') || 'Audience not chosen'
  const [historyPage, setHistoryPage] = useState(0)
  const [search, setSearch] = useState('')
  const [view, setView] = useState(VIEWS[0]!)
  const [limit, setLimit] = useState(2)
  const [status, setStatus] = useState('ALL')
  const [period, setPeriod] = useState('ALL')
  const [source, setSource] = useState('ALL')
  const [sort, setSort] = useState('NEWEST')
  const resetFilters = () => {
    setHistoryPage(0)
    setSearch('')
    setView(VIEWS[0]!)
    setStatus('ALL')
    setPeriod('ALL')
    setSource('ALL')
    setLimit(2)
  }
  if (!can('campaigns.read')) return <PermissionState what="campaigns" />
  const visible = selectCampaigns(campaigns.data ?? [], {
    search,
    view,
    status,
    source,
    period,
    sort,
  })
  const active = visible.filter(isActive).sort((a, b) => {
    const priority = (c: Campaign) =>
      c.status === 'RUNNING' ? 0 : c.status === 'PREPARING' ? 1 : c.status === 'SCHEDULED' ? 2 : 3
    return priority(a) - priority(b)
  })
  const history = visible.filter((c) => !isActive(c))
  const filtered =
    !!search.trim() || view !== 'All' || status !== 'ALL' || period !== 'ALL' || source !== 'ALL'
  const create = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" asChild>
        <Link href="/campaigns/analytics">
          <BarChart3 aria-hidden="true" />
          Campaign analytics
        </Link>
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
          setHistoryPage(0)
          setView(VIEWS.find((label) => viewId(label) === v) ?? VIEWS[0]!)
          setLimit(2)
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
              setHistoryPage(0)
              setLimit(2)
            }}
          />
          <CampaignFilter
            label="Status"
            value={status}
            onChange={(value) => {
              setStatus(value)
              setHistoryPage(0)
            }}
            options={[
              ['ALL', 'Status'],
              ...CAMPAIGN_STATUSES.map((s): [string, string] => [
                s,
                s.toLowerCase().replaceAll('_', ' '),
              ]),
            ]}
          />
          <CampaignFilter
            label="Created date"
            value={period}
            onChange={(value) => {
              setPeriod(value)
              setHistoryPage(0)
            }}
            options={[
              ['ALL', 'Date'],
              ['7', 'Created last 7 days'],
              ['30', 'Created last 30 days'],
            ]}
          />
          <CampaignFilter
            label="Audience"
            value={source}
            onChange={(value) => {
              setSource(value)
              setHistoryPage(0)
            }}
            options={[
              ['ALL', 'Audience'],
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
              wide
              value={sort}
              onChange={(value) => {
                setSort(value)
                setHistoryPage(0)
              }}
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
              description="Please try again. Your saved campaigns have not changed."
              onRetry={() => void campaigns.refetch()}
            />
          ) : !visible.length ? (
            <EmptyState
              title={filtered ? 'No campaigns match these filters.' : 'Prepare your first campaign'}
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
                  <h2 className="text-md font-semibold text-slate">Active</h2>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {active.slice(0, limit).map((c) => (
                      <CampaignCard key={c.id} campaign={c} audienceLabel={audienceLabel(c)} />
                    ))}
                  </div>
                  {active.length > limit ? (
                    <Button
                      variant="secondary"
                      className="self-start"
                      onClick={() => setLimit((n) => n + 2)}
                    >
                      Show more campaigns
                    </Button>
                  ) : null}
                </section>
              ) : null}
              {history.length ? (
                <CampaignHistory
                  history={history}
                  page={historyPage}
                  onPageChange={setHistoryPage}
                  audienceLabel={audienceLabel}
                  drafts={view === 'Drafts'}
                />
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>
    </ListPage>
  )
}
