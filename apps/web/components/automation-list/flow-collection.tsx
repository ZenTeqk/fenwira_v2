'use client'
import { type Flow, type FlowVersion } from '@fenwira/contracts'
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
  BarChart3,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderOpen,
  GitBranch,
  MessageCircle,
  Pause,
  Play,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { del, errorText, get, post, put } from '@/lib/api/client'
import { automationKey } from '@/lib/automation'
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
    enabled: studio,
    refetchOnWindowFocus: false,
  })
  const response = draft.data?.graph.nodes.find((n) =>
    ['action.send_message', 'action.question', 'action.options'].includes(n.type),
  )?.config.text
  const keywords = (flow.trigger?.config.keywords as string[] | undefined) ?? []
  const change = useMutation({
    mutationFn: async (action: 'toggle' | 'duplicate' | 'archive') => {
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
  return (
    <article
      aria-label={flow.name}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 transition-shadow hover:border-border-strong hover:shadow-raised md:flex-row md:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/automations/${flow.id}/edit`}
              className="rounded-sm text-md font-semibold text-slate hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
            >
              {flow.name || 'Untitled automation'}
            </Link>
            {flow.managedBy === 'REPLY_STUDIO' ? (
              <Badge tone="neutral" className="text-xs">
                Managed by Reply Studio
              </Badge>
            ) : null}
          </div>
          {studio && keywords.length ? (
            <div aria-label="Keywords" className="flex flex-wrap gap-2">
              {keywords.slice(0, 3).map((word, i) => (
                <Badge key={`${word}-${i}`} tone="neutral">
                  {word}
                </Badge>
              ))}
              {keywords.length > 3 ? <Badge tone="neutral">+{keywords.length - 3}</Badge> : null}
            </div>
          ) : (
            <p className="text-sm text-secondary">{triggerClause(flow.trigger ?? undefined)}</p>
          )}
          {studio ? (
            draft.isPending ? (
              <Skeleton className="h-4 w-56 max-w-full" />
            ) : (
              <p className="truncate text-sm text-secondary">
                {typeof response === 'string'
                  ? response
                  : draft.isError
                    ? 'Open flow to view its messages'
                    : 'Add your first message in the editor'}
              </p>
            )
          ) : null}
          <time
            dateTime={updated}
            title={new Date(updated).toLocaleString()}
            className="text-xs text-muted"
          >
            Edited {relativeTime(updated)}
          </time>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-border pt-4 md:border-0 md:pt-0">
        <Link
          href={`/automations/${flow.id}/history`}
          className="flex min-w-16 flex-col gap-1 rounded-sm text-right focus-visible:outline-2 focus-visible:outline-primary-strong"
        >
          <span className="flex items-center justify-end gap-2 text-md font-semibold text-slate tabular-nums">
            <BarChart3 aria-hidden="true" className="size-4 text-muted" />
            {flow.executions.last7d.toLocaleString('en-IN')}
          </span>
          <span className="text-xs text-muted">{studio ? 'starts' : 'runs'} · 7 days</span>
        </Link>
        <div className="flex items-center gap-4">
          <StatusBadge status={flow.status} label={flow.status === 'ACTIVE' ? 'Live' : undefined} />
          {flow.status === 'ACTIVE' || flow.status === 'PAUSED' ? (
            <label className="flex min-h-11 items-center">
              <span className="sr-only">
                {flow.status === 'ACTIVE' ? 'Pause' : 'Resume'} {flow.name}
              </span>
              <Switch
                checked={flow.status === 'ACTIVE'}
                disabled={!publish || change.isPending}
                onCheckedChange={() => change.mutate('toggle')}
              />
            </label>
          ) : null}
        </div>
        <RowActions
          label={`Actions for ${flow.name}`}
          actions={[
            {
              label: 'Open',
              icon: <FolderOpen />,
              onSelect: () => router.push(`/automations/${flow.id}/edit`),
            },
            ...(editable
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
                    label: 'Archive',
                    icon: <Archive />,
                    destructive: true,
                    disabled: change.isPending,
                    onSelect: () => change.mutate('archive'),
                  },
                ]
              : []),
          ]}
        />
      </div>
    </article>
  )
}

export function FlowCollection({ flows, studio = false, loading, error, retry, empty }: Props) {
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('ALL'),
    [draftsOpen, setDraftsOpen] = useState(false),
    [limit, setLimit] = useState(20),
    [clearing, setClearing] = useState(false)
  const { can, tenantId } = useSession(),
    confirm = useConfirm(),
    cache = useQueryClient(),
    region = useId()
  const matches = flows.filter(
    (f) =>
      (status === 'ALL' || f.status === status) &&
      `${f.name} ${triggerClause(f.trigger ?? undefined)} ${(f.trigger?.config.keywords as string[] | undefined)?.join(' ') ?? ''}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  )
  const drafts = matches.filter((f) => f.status === 'DRAFT'),
    live = matches.filter((f) => f.status !== 'DRAFT')
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
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <SearchInput
          label={studio ? 'Search replies and flows' : 'Search automations'}
          value={search}
          onValueChange={(v) => {
            setSearch(v)
            setLimit(20)
          }}
          placeholder={studio ? 'Search names or keywords…' : 'Search automations…'}
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
              { id: 'ALL', label: 'All' },
              { id: 'ACTIVE', label: 'Live' },
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
            title="No matching automations"
            description="Try a different name, keyword or status."
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
            role="list"
            aria-label={studio ? 'Replies and flows' : 'Automations'}
            className="flex flex-col gap-4"
          >
            {live.slice(0, limit).map((f) => (
              <div role="listitem" key={f.id}>
                <FlowRow flow={f} studio={studio} />
              </div>
            ))}
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
                className={draftsOpen ? 'flex flex-col gap-4 border-t border-border p-4' : 'hidden'}
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
