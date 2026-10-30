'use client'
import { type Execution, type Flow, type FlowVersion } from '@fenwira/contracts'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  RowActions,
  SearchInput,
  Skeleton,
  StatusBadge,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  GitBranch,
  MessageCircle,
  Pause,
  Play,
  ArrowRight,
  Clock3,
  Tag,
  Webhook,
  MapPin,
  History,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { FlowActivity } from '@/components/automation/flow-activity'
import { useSession } from '@/components/session/session-provider'
import { del, errorText, get, post, put } from '@/lib/api/client'
import { automationKey } from '@/lib/automation'
import { StepPreview } from './step-preview'
import { useWorkflowAnalytics } from './workflow-summary'
import { useConnections } from '@/lib/workspace-status'
import { triggerClause } from '@/lib/automation-summary'
import { relativeTime } from '@/lib/relative-time'

type Props = {
  flows: Flow[]
  studio?: boolean
  loading?: boolean
  error?: boolean
  retry: () => void
  empty?: React.ReactNode
}
function FlowRow({ flow, studio }: { flow: Flow; studio: boolean }) {
  const { tenantId, can } = useSession(),
    router = useRouter(),
    cache = useQueryClient(),
    confirm = useConfirm()
  const draft = useQuery({
    queryKey: automationKey(tenantId, 'draft', flow.id),
    queryFn: () => get<{ data: FlowVersion }>(`/flows/${flow.id}/draft`).then((r) => r.data),
    enabled: flow.status !== 'ARCHIVED',
    refetchOnWindowFocus: false,
  })
  const response = draft.data?.graph.nodes.find((n) =>
    ['action.send_message', 'action.question', 'action.options'].includes(n.type),
  )?.config.text
  const keywords = (flow.trigger?.config.keywords as string[] | undefined) ?? []
  const change = useMutation({
    mutationFn: async (action: 'toggle' | 'duplicate' | 'archive' | 'restore') => {
      if (action === 'restore') return post(`/flows/${flow.id}/restore`, {})
      if (action === 'toggle')
        return post(`/flows/${flow.id}/${flow.status === 'ACTIVE' ? 'pause' : 'resume'}`, {})
      if (action === 'archive') {
        if (
          !(await confirm({
            title: `Archive “${flow.name}”?`,
            description:
              'This automation will no longer start new conversations. Running conversations keep their published version.',
            confirmLabel: 'Archive automation',
            destructive: true,
          }))
        )
          return
        return del(`/flows/${flow.id}`)
      }
      const original =
        draft.data ?? (await get<{ data: FlowVersion }>(`/flows/${flow.id}/draft`)).data
      const copy = (
        await post<{ data: Flow }>('/flows', {
          name: `${flow.name.slice(0, 110)} (copy)`,
          description: flow.description ?? undefined,
          priority: flow.priority,
          reentryPolicy: flow.reentryPolicy,
          ...(flow.managedBy === 'REPLY_STUDIO' ? { managedBy: 'REPLY_STUDIO' } : {}),
        })
      ).data
      const version = (await get<{ data: FlowVersion }>(`/flows/${copy.id}/draft`)).data
      await put(
        `/flows/${copy.id}/draft`,
        { graph: original.graph },
        { headers: { 'If-Match': version.etag } },
      )
      router.push(`/automations/${copy.id}/edit`)
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: automationKey(tenantId, 'flows') })
      void cache.invalidateQueries({ queryKey: automationKey(tenantId, 'flow', flow.id) })
    },
    onError: (e) => toast.error(errorText(e, 'Could not update this automation.')),
  })
  const Icon = flow.replyStudioKind === 'BOT_FLOW' ? GitBranch : MessageCircle
  const editable = can('automations.write'),
    publish = can('automations.publish')
  const updated = flow.draftUpdatedAt ?? flow.updatedAt
  const [activityOpen, setActivityOpen] = useState(false)
  const analytics = useWorkflowAnalytics()
  const flowMetrics =
    analytics.data?.meta.freshness.status === 'READY'
      ? analytics.data.flows.find((f) => f.flowId === flow.id)
      : undefined
  const latest = useQuery({
    queryKey: automationKey(tenantId, 'latest-run', flow.id),
    queryFn: () =>
      get<{ data: Execution[] }>(`/flows/${flow.id}/executions?limit=1`).then(
        (r) => r.data[0] ?? null,
      ),
    enabled: !studio && flow.executions.total > 0 && flow.status !== 'ARCHIVED',
  })
  const phones = useConnections()
  const numberIds = (flow.trigger?.config.phoneNumberIds as string[] | undefined) ?? []
  const numbers = numberIds.flatMap(
    (id) =>
      phones.data
        ?.filter((p) => p.id === id)
        .map(
          (p) =>
            `${p.label ?? p.verifiedName} · ending ${p.displayPhoneNumber.replace(/\D/g, '').slice(-4)}`,
        ) ?? [],
  )
  const hoursNode = draft.data?.graph.nodes.find((n) => n.type === 'condition.business_hours')
  const outside =
    flow.trigger?.config.businessHours === 'CLOSED' ||
    (hoursNode &&
      draft.data?.graph.edges.some(
        (e) =>
          e.source === hoursNode.id &&
          e.sourceHandle === 'yes' &&
          draft.data?.graph.nodes.some((n) => n.id === e.target && n.type === 'action.end'),
      ))
  const Identity = outside
    ? Clock3
    : flow.replyStudioKind === 'BOT_FLOW'
      ? GitBranch
      : flow.trigger?.type === 'trigger.webhook'
        ? Webhook
        : flow.trigger?.type === 'trigger.contact_created'
          ? Clock3
          : keywords.some((k) => ['location', 'address'].includes(k.toLowerCase()))
            ? MapPin
            : keywords.length
              ? Tag
              : Icon
  const tone =
    outside || Identity === MapPin || Identity === Clock3
      ? 'bg-warning-soft text-warning-strong'
      : Identity === Tag
        ? 'bg-neutral-soft text-secondary'
        : flow.replyStudioKind === 'BOT_FLOW'
          ? 'bg-info-soft text-info-strong'
          : 'bg-primary-soft text-primary-strong'
  const title = (
    <Link
      href={`/automations/${flow.id}/edit`}
      aria-disabled={flow.status === 'ARCHIVED' || undefined}
      tabIndex={flow.status === 'ARCHIVED' ? -1 : undefined}
      onClick={(e) => {
        if (flow.status === 'ARCHIVED') e.preventDefault()
      }}
      className="min-h-6 line-clamp-2 rounded-sm text-sm font-semibold text-slate hover:underline focus-visible:outline-2 focus-visible:outline-focus-ring"
    >
      {flow.name || 'Untitled workflow'}
    </Link>
  )
  const badge = (
    <StatusBadge status={flow.status} label={flow.status === 'ACTIVE' ? 'Published' : undefined} />
  )
  const toggle =
    flow.status === 'ACTIVE' || flow.status === 'PAUSED' ? (
      <label className="flex min-h-8 items-center">
        <span className="sr-only">
          {flow.status === 'ACTIVE' ? 'Pause' : 'Resume'} {flow.name}
        </span>
        <Switch
          checked={flow.status === 'ACTIVE'}
          disabled={!publish || change.isPending}
          onCheckedChange={() => change.mutate('toggle')}
        />
      </label>
    ) : null
  const menu = (
    <RowActions
      label={`Actions for ${flow.name}`}
      actions={[
        {
          label: 'Recent activity',
          icon: <History />,
          disabled: flow.status === 'ARCHIVED',
          onSelect: () =>
            studio ? setActivityOpen(true) : router.push(`/automations/${flow.id}/history`),
        },
        ...[
          {
            label: 'Open',
            disabled: flow.status === 'ARCHIVED',
            icon: <FolderOpen />,
            onSelect: () => router.push(`/automations/${flow.id}/edit`),
          },
          ...(editable && flow.status !== 'ARCHIVED'
            ? [
                {
                  label: 'Duplicate',
                  icon: <Copy />,
                  disabled: change.isPending,
                  onSelect: () => change.mutate('duplicate'),
                },
              ]
            : []),
          ...(publish && ['ACTIVE', 'PAUSED'].includes(flow.status)
            ? [
                {
                  label: flow.status === 'ACTIVE' ? 'Pause' : 'Resume',
                  icon: flow.status === 'ACTIVE' ? <Pause /> : <Play />,
                  disabled: change.isPending,
                  onSelect: () => change.mutate('toggle'),
                },
              ]
            : []),
          ...(editable
            ? [
                {
                  label: flow.status === 'ARCHIVED' ? 'Restore' : 'Archive',
                  icon: <Archive />,
                  destructive: flow.status !== 'ARCHIVED',
                  disabled: change.isPending,
                  onSelect: () => change.mutate(flow.status === 'ARCHIVED' ? 'restore' : 'archive'),
                },
              ]
            : []),
        ],
      ]}
    />
  )
  const preview =
    typeof response === 'string'
      ? response
      : draft.isError
        ? 'Open the editor to view its response'
        : (flow.description ?? '')
  if (studio)
    return (
      <article
        aria-label={flow.name}
        className="relative grid min-w-0 grid-cols-2 gap-3 bg-surface px-4 py-3 md:grid-cols-12 md:items-center"
      >
        <div className="col-span-2 flex min-w-0 items-start gap-3 pr-8 md:col-span-4 md:pr-0">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tone}`}>
            <Identity aria-hidden="true" className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            {title}
            <p className="truncate text-xs text-muted">
              {numbers.length ? numbers.join(', ') : preview || 'All WhatsApp numbers'}
            </p>
          </div>
        </div>
        <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-3">
          <div className="flex flex-wrap gap-1">
            {outside ? (
              <Badge tone="neutral">Outside business hours</Badge>
            ) : keywords.length ? (
              <>
                {keywords.slice(0, 3).map((word, i) => (
                  <Badge key={`${word}-${i}`} tone="neutral">
                    {word}
                  </Badge>
                ))}
                {keywords.length > 3 ? <Badge tone="neutral">+{keywords.length - 3}</Badge> : null}
              </>
            ) : (
              <Badge tone="neutral">
                {flow.trigger?.config.onlyNewConversation ? 'New conversation' : 'Message received'}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted">
            {outside
              ? 'Workspace hours and holidays'
              : flow.trigger?.config.onlyNewConversation
                ? `Contact cooldown · ${String(flow.trigger.config.cooldownHours ?? 24)} hours`
                : String(flow.trigger?.config.match ?? '')
                    .toLowerCase()
                    .replaceAll('_', ' ')}
          </p>
        </div>
        <Link
          href={`/automations/${flow.id}/history`}
          aria-label={`${flow.executions.last7d} starts in 7 days for ${flow.name}`}
          className="text-sm font-medium text-slate tabular-nums focus-visible:outline-2 focus-visible:outline-focus-ring md:col-span-2"
        >
          {flow.executions.last7d.toLocaleString('en-IN')}
          <span className="ml-2 text-xs font-normal text-muted md:hidden">starts · 7 days</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          {badge}
          {toggle}
        </div>
        <div className="absolute top-3 right-3 justify-self-end md:static md:col-span-1">
          {menu}
        </div>
        <div className="sr-only">
          {preview} Edited {relativeTime(updated)}
        </div>
        <FlowActivity
          flowId={flow.id}
          hiddenTrigger
          open={activityOpen}
          onOpenChange={setActivityOpen}
        />
      </article>
    )
  return (
    <article
      aria-label={flow.name}
      className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition-shadow hover:border-border-strong hover:shadow-raised"
    >
      <div className="flex items-start gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tone}`}>
          <Identity aria-hidden="true" className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {title}
          <p className="line-clamp-2 text-xs text-muted">
            {flow.description ?? triggerClause(flow.trigger ?? undefined)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {badge}
          {toggle}
        </div>
        {menu}
      </div>
      <div className="mt-auto">
        {draft.isPending && flow.status !== 'ARCHIVED' ? (
          <Skeleton className="h-14 w-full" />
        ) : draft.data ? (
          <StepPreview graph={draft.data.graph} />
        ) : (
          <p className="rounded-md border border-dashed border-border px-4 py-3 text-xs text-muted">
            {flow.status === 'ARCHIVED'
              ? 'Restore this workflow to edit its steps.'
              : 'Open the editor to view its steps.'}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {flow.executions.last7d.toLocaleString('en-IN')} runs · 7 days
          {latest.data
            ? ` · Last run ${relativeTime(latest.data.startedAt)}`
            : flow.executions.total === 0
              ? ' · No runs yet'
              : ''}
        </p>
        {flowMetrics?.failed ? (
          <Link
            href={`/automations/${flow.id}/history`}
            className="inline-flex min-h-8 items-center gap-2 rounded-sm text-xs font-medium text-warning-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            {flowMetrics.failed} failed · View runs
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : flow.status !== 'ARCHIVED' ? (
          <Link
            href={`/automations/${flow.id}/edit`}
            className="inline-flex min-h-6 items-center gap-2 rounded-sm text-xs font-semibold text-primary-strong focus-visible:outline-2 focus-visible:outline-focus-ring"
          >
            {flow.status === 'DRAFT' ? 'Continue editing' : 'Edit workflow'}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {flow.managedBy === 'REPLY_STUDIO' ? (
        <div className="-mx-4 -mb-4 flex flex-wrap items-center justify-between gap-2 rounded-b-lg border-t border-border bg-primary-soft px-4 py-3">
          <span className="text-xs text-secondary">Managed by Reply Studio</span>
          <Link
            href={`/automations/${flow.id}/edit`}
            aria-disabled={flow.status === 'ARCHIVED' || undefined}
            tabIndex={flow.status === 'ARCHIVED' ? -1 : undefined}
            onClick={(e) => {
              if (flow.status === 'ARCHIVED') e.preventDefault()
            }}
            className="inline-flex min-h-6 items-center text-xs font-semibold text-primary-strong hover:underline"
          >
            Open in Reply Studio →
          </Link>
        </div>
      ) : null}
    </article>
  )
}

export function FlowCollection({ flows, studio = false, loading, error, retry, empty }: Props) {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('ALL'),
    [draftsOpen, setDraftsOpen] = useState(false),
    [limit, setLimit] = useState(20),
    [clearing, setClearing] = useState(false)
  const [triggerFilter, setTriggerFilter] = useState('ALL'),
    [numberFilter, setNumberFilter] = useState('ALL')
  const phones = useConnections()
  const { can, tenantId } = useSession(),
    confirm = useConfirm(),
    cache = useQueryClient(),
    region = useId()
  const matches = flows.filter(
    (f) =>
      (status === 'ALL' || f.status === status) &&
      (triggerFilter === 'ALL' || f.trigger?.type === triggerFilter) &&
      (numberFilter === 'ALL' ||
        !(f.trigger?.config.phoneNumberIds as string[] | undefined)?.length ||
        (f.trigger?.config.phoneNumberIds as string[]).includes(numberFilter)) &&
      `${f.name} ${triggerClause(f.trigger ?? undefined)} ${(f.trigger?.config.keywords as string[] | undefined)?.join(' ') ?? ''}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  )
  const drafts = studio
      ? []
      : matches.filter((f) => f.status === 'DRAFT' && (!f.trigger || /^untitled/i.test(f.name))),
    live = matches.filter((f) => !drafts.includes(f))
  async function clearEmpty() {
    setClearing(true)
    try {
      const checked = []
      const candidates = flows.filter((f) => f.status === 'DRAFT')
      for (let i = 0; i < candidates.length; i += 12)
        checked.push(
          ...(await Promise.all(
            candidates.slice(i, i + 12).map(async (f) => ({
              flow: f,
              version: (await get<{ data: FlowVersion }>(`/flows/${f.id}/draft`)).data,
            })),
          )),
        )
      const empty = checked.filter((c) => c.version.graph.nodes.length === 0)
      if (!empty.length) {
        toast.info('There are no empty drafts to clear. Drafts with steps are kept.')
        return
      }
      if (
        !(await confirm({
          title: `Clear ${empty.length} empty draft${empty.length === 1 ? '' : 's'}?`,
          description:
            'Only drafts with no steps will be archived. Drafts containing any steps are kept.',
          confirmLabel: 'Clear empty drafts',
          destructive: true,
          impact: empty.map((c) => c.flow.name),
        }))
      )
        return
      await Promise.all(empty.map((c) => del(`/flows/${c.flow.id}`)))
      await cache.invalidateQueries({ queryKey: automationKey(tenantId, 'flows') })
      toast.success('Empty drafts cleared.')
    } catch (e) {
      toast.error(errorText(e, 'Could not clear empty drafts.'))
    } finally {
      setClearing(false)
    }
  }
  if (studio && !loading && !error && flows.length === 0)
    return (
      <>
        {empty ?? (
          <EmptyState
            title="No items yet"
            description="An editor can add a starter conversation."
          />
        )}
      </>
    )
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          label={studio ? 'Search replies and flows' : 'Search workflows'}
          value={search}
          onValueChange={(v) => {
            setSearch(v)
            setLimit(20)
          }}
          placeholder={studio ? 'Search replies…' : 'Search workflows…'}
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v)
            setDraftsOpen(v === 'DRAFT')
            setLimit(20)
          }}
        >
          <SelectTrigger aria-label="Status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              { id: 'ALL', label: 'All statuses' },
              { id: 'ACTIVE', label: 'Published' },
              { id: 'PAUSED', label: 'Paused' },
              { id: 'DRAFT', label: 'Draft' },
            ].map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label} (
                {s.id === 'ALL' ? flows.length : flows.filter((f) => f.status === s.id).length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!studio ? (
          <Select
            value={triggerFilter}
            onValueChange={(v) => {
              setTriggerFilter(v)
              setLimit(20)
            }}
          >
            <SelectTrigger aria-label="Trigger" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { id: 'ALL', label: 'All triggers' },
                { id: 'trigger.message_received', label: 'Message received' },
                { id: 'trigger.keyword', label: 'Keywords' },
                { id: 'trigger.contact_created', label: 'Contact created' },
                { id: 'trigger.webhook', label: 'Webhook' },
              ].map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : can('whatsapp.read') ? (
          <Select
            value={numberFilter}
            onValueChange={(v) => {
              setNumberFilter(v)
              setLimit(20)
            }}
          >
            <SelectTrigger aria-label="WhatsApp number" className="w-60 md:ml-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All WhatsApp numbers</SelectItem>
              {phones.data?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label ?? p.verifiedName} · {p.displayPhoneNumber}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {!studio ? (
          <Link
            href="/automations/reply-studio/auto-replies"
            className="inline-flex items-center gap-3 rounded-md border border-border bg-primary-soft px-4 py-2 text-xs text-secondary lg:ml-auto"
          >
            <MessageCircle className="size-5 shrink-0 text-primary-strong" aria-hidden="true" />
            <span>
              Customer-facing replies and bot conversations are in
              <br />
              <strong className="font-semibold text-primary-strong">Reply Studio →</strong>
            </span>
          </Link>
        ) : null}
      </div>
      {loading ? (
        <div aria-label="Loading automations" role="status" className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-4 rounded-lg border border-border bg-surface p-4">
              <Skeleton className="size-10" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-72 max-w-full" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState title="Could not load automations" onRetry={retry} />
      ) : !matches.length ? (
        flows.length || search ? (
          <EmptyState
            title="No results match your filters"
            description="Try a different name, keyword or status."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('')
                  setStatus('ALL')
                  setTriggerFilter('ALL')
                  setNumberFilter('ALL')
                  setLimit(20)
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          (empty ?? (
            <EmptyState
              title="Make room for more conversations"
              description="Choose a starting point above. Nothing runs until you publish."
            />
          ))
        )
      ) : (
        <>
          <div
            className={
              studio ? 'overflow-hidden rounded-lg border border-border bg-surface' : undefined
            }
          >
            {studio && live.length ? (
              <div
                aria-hidden="true"
                className="hidden grid-cols-12 border-b border-border bg-neutral-soft px-4 py-3 text-xs font-medium text-secondary md:grid"
              >
                <span className="col-span-4">Reply</span>
                <span className="col-span-3">Trigger</span>
                <span className="col-span-2">Starts · 7 days</span>
                <span className="col-span-2">Status</span>
                <span className="sr-only">Actions</span>
              </div>
            ) : null}
            <div
              role="list"
              aria-label={studio ? 'Replies and flows' : 'Automations'}
              className={studio ? 'flex flex-col' : 'grid gap-3 md:grid-cols-2 xl:grid-cols-3'}
            >
              {live.slice(0, limit).map((f) => (
                <div
                  role="listitem"
                  key={f.id}
                  className={studio ? 'border-b border-border last:border-b-0' : undefined}
                >
                  <FlowRow flow={f} studio={studio} />
                </div>
              ))}
            </div>
          </div>
          {drafts.length ? (
            <section className="overflow-hidden rounded-lg border border-border bg-neutral-soft">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <Button
                  variant="ghost"
                  className="gap-2 px-0 hover:bg-transparent"
                  aria-expanded={draftsOpen}
                  aria-controls={region}
                  onClick={() => setDraftsOpen(!draftsOpen)}
                >
                  {draftsOpen ? (
                    <ChevronDown aria-hidden="true" />
                  ) : (
                    <ChevronRight aria-hidden="true" />
                  )}
                  Drafts<Badge tone="neutral">{drafts.length}</Badge>
                </Button>
                {can('automations.write') ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={clearing}
                    onClick={() => void clearEmpty()}
                  >
                    Clear empty drafts
                  </Button>
                ) : null}
              </div>
              <div
                id={region}
                hidden={!draftsOpen}
                role="list"
                aria-label="Drafts"
                className={
                  draftsOpen
                    ? 'grid gap-3 border-t border-border p-4 md:grid-cols-2 xl:grid-cols-3'
                    : 'hidden'
                }
              >
                {(draftsOpen ? drafts.slice(0, limit) : []).map((f) => (
                  <div role="listitem" key={f.id}>
                    <FlowRow flow={f} studio={studio} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {live.length > limit || drafts.length > limit ? (
            <Button
              variant="secondary"
              className="self-center"
              onClick={() => setLimit(limit + 20)}
            >
              Show more
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}
