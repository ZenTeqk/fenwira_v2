'use client'

import {
  type FollowUp,
  type FollowUpCounts,
  type FollowUpTab,
  FOLLOW_UP_TABS,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  ListPage,
  Pagination,
  PermissionState,
  RowActions,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fenwira/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CalendarCheck, MessageSquare, Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { Segmented } from '@/components/inbox/segmented'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import {
  formatDue,
  useMembers,
  useSalesOn,
  useSalesStages,
  useWorkspaceTimezone,
} from '@/lib/follow-ups'
import { formatPhone } from '@/lib/phone'
import { useRealtimeEvent } from '@/lib/realtime'
import { useFollowUpActions } from './follow-up-actions'
import { FollowUpForm } from './follow-up-form'

const TAB_LABEL: Record<FollowUpTab, string> = {
  today: 'Today',
  overdue: 'Overdue',
  upcoming: 'Upcoming',
  completed: 'Completed',
}
const EMPTY: Record<FollowUpTab, { title: string; description: string }> = {
  today: { title: 'Nothing due today', description: 'Follow-ups due today will show up here.' },
  overdue: { title: 'Nothing overdue', description: 'You are all caught up.' },
  upcoming: {
    title: 'No upcoming follow-ups',
    description: 'Create one from a conversation with “Follow up”, or with New follow-up.',
  },
  completed: { title: 'No completed follow-ups yet', description: '' },
}
const ALL = 'all'

const customerName = (f: FollowUp) =>
  f.contact.name ?? f.contact.waProfileName ?? formatPhone(f.contact.phoneE164)

/** Follow-ups (docs/FOLLOW_UPS_AND_SALES.md → Follow-ups page). */
export function FollowUpsPage() {
  const { tenantId, can, me } = useSession()
  const on = useSalesOn()
  const router = useRouter()
  const params = useSearchParams()
  const timeZone = useWorkspaceTimezone()
  const stages = useSalesStages()
  const members = useMembers('followups.write')
  const manager = can('followups.manage')
  const [tab, setTab] = useState<FollowUpTab>(() => {
    const t = params.get('tab') as FollowUpTab | null
    return t && FOLLOW_UP_TABS.includes(t) ? t : 'today'
  })
  const [scope, setScope] = useState<'mine' | 'team'>('mine')
  const [q, setQ] = useState('')
  const [assigneeId, setAssigneeId] = useState(ALL)
  const [stageId, setStageId] = useState(ALL)
  const [needsReview, setNeedsReview] = useState(false)
  const [cursors, setCursors] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const actions = useFollowUpActions()
  const taskId = params.get('task')

  const filters = useMemo(() => {
    const p = new URLSearchParams({ scope })
    if (scope === 'team' && assigneeId !== ALL) p.set('assigneeId', assigneeId)
    if (stageId !== ALL) p.set('stageId', stageId)
    if (needsReview) p.set('needsReview', 'true')
    if (q.trim().length >= 1) p.set('q', q.trim())
    return p.toString()
  }, [scope, assigneeId, stageId, needsReview, q])
  useEffect(() => setCursors([]), [filters, tab])
  const cursor = cursors.at(-1)
  const enabled = on && can('followups.read')

  const list = useQuery({
    queryKey: keys.tenant(tenantId, 'follow-ups', 'list', tab, filters, cursor ?? ''),
    queryFn: () =>
      get<{ data: FollowUp[]; page: { nextCursor: string | null } }>(
        `/follow-ups?tab=${tab}&${filters}&limit=25${cursor ? `&cursor=${cursor}` : ''}`,
      ),
    enabled,
    placeholderData: keepPreviousData,
  })
  const counts = useQuery({
    queryKey: keys.tenant(tenantId, 'follow-ups', 'counts', filters),
    queryFn: () =>
      get<{ data: FollowUpCounts }>(`/follow-ups/counts?${filters}`).then((r) => r.data),
    enabled,
  })
  const linked = useQuery({
    queryKey: keys.tenant(tenantId, 'follow-ups', 'one', taskId ?? ''),
    queryFn: () => get<{ data: FollowUp }>(`/follow-ups/${taskId}`).then((r) => r.data),
    enabled: enabled && !!taskId,
    retry: false,
  })
  const refresh = () => {
    void list.refetch()
    void counts.refetch()
  }
  useRealtimeEvent('follow_up.changed', refresh)

  if (!can('followups.read')) return <PermissionState what="follow-ups" />
  if (!on)
    return (
      <ListPage header={{ title: 'Follow-ups' }}>
        <EmptyState
          icon={<CalendarCheck aria-hidden="true" />}
          title="Follow-ups are off for this workspace"
          description={
            can('workspace.manage')
              ? 'Turn on Follow-ups and sales in Settings → Workspace.'
              : 'Ask a workspace admin to turn on Follow-ups and sales.'
          }
          action={
            can('workspace.manage') ? (
              <Button asChild variant="secondary">
                <Link href="/settings/workspace">Open workspace settings</Link>
              </Button>
            ) : undefined
          }
        />
      </ListPage>
    )

  const rows = list.data?.data ?? []
  const activeFilters =
    (assigneeId !== ALL && scope === 'team' ? 1 : 0) +
    (stageId !== ALL ? 1 : 0) +
    (needsReview ? 1 : 0) +
    (q ? 1 : 0)
  const today = (iso: string) => {
    const due = new Date(iso)
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone })
    return fmt.format(due) === fmt.format(new Date())
  }

  return (
    <ListPage
      header={{
        title: 'Follow-ups',
        description: `Internal reminders to get back to customers. Times are in workspace time (${timeZone}).`,
        actions: can('followups.write') ? (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New follow-up
          </Button>
        ) : undefined,
      }}
      banner={
        taskId && linked.data ? (
          <Alert
            tone={linked.data.overdue ? 'warning' : 'info'}
            title={linked.data.title}
            action={
              <div className="flex gap-2">
                {linked.data.conversationId ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/inbox?c=${linked.data.conversationId}`}>Open chat</Link>
                  </Button>
                ) : null}
                <RowActions
                  label={`Actions for ${linked.data.title}`}
                  actions={actions.actionsFor(linked.data)}
                />
                <Button size="sm" variant="ghost" onClick={() => router.replace('/follow-ups')}>
                  Dismiss
                </Button>
              </div>
            }
          >
            {customerName(linked.data)} · due {formatDue(linked.data.dueAt, timeZone)} ·{' '}
            {linked.data.assignee.name}
          </Alert>
        ) : undefined
      }
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as FollowUpTab)}
        className="flex flex-col gap-6"
      >
        <div className="flex flex-col gap-3">
          {manager ? (
            <Segmented
              label="Whose follow-ups"
              value={scope}
              onChange={(v) => {
                setScope(v)
                setAssigneeId(ALL)
              }}
              options={[
                { value: 'mine', label: 'My follow-ups' },
                { value: 'team', label: 'Team follow-ups' },
              ]}
            />
          ) : null}
          <TabsList aria-label="Follow-up views" className="overflow-x-auto">
            {FOLLOW_UP_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABEL[t]}
                {counts.data ? (
                  <span className="rounded-full bg-surface-muted px-1.5 text-xs text-fg-secondary tabular-nums">
                    {counts.data[t]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          <FilterBar
            activeCount={activeFilters}
            onClear={() => {
              setQ('')
              setAssigneeId(ALL)
              setStageId(ALL)
              setNeedsReview(false)
            }}
          >
            <SearchInput label="Search customer or task" value={q} onValueChange={setQ} />
            {scope === 'team' ? (
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="w-full sm:w-48" aria-label="Assigned to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Everyone</SelectItem>
                  {members.data.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.userId === me.user.id ? `${m.name} (you)` : m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {can('sales.read') ? (
              <Select value={stageId} onValueChange={setStageId}>
                <SelectTrigger className="w-full sm:w-44" aria-label="Sales stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any stage</SelectItem>
                  {(stages.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.archived ? ' (archived)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {tab !== 'completed' ? (
              <Button
                variant="secondary"
                size="sm"
                aria-pressed={needsReview}
                onClick={() => setNeedsReview((v) => !v)}
              >
                Customer replied
              </Button>
            ) : null}
          </FilterBar>
        </div>

        <TabsContent value={tab}>
          {list.isError ? (
            <ErrorState onRetry={() => void list.refetch()} />
          ) : list.isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck aria-hidden="true" />}
              title={activeFilters ? 'No follow-ups match these filters' : EMPTY[tab].title}
              description={activeFilters ? 'Try clearing a filter.' : EMPTY[tab].description}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <Table containerLabel={`${TAB_LABEL[tab]} follow-ups`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead>{tab === 'completed' ? 'Completed' : 'Due'}</TableHead>
                    <TableHead>Assigned to</TableHead>
                    <TableHead>Sales stage</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((f) => (
                    <TableRow key={f.id} aria-current={f.id === taskId ? 'true' : undefined}>
                      <TableCell className="min-w-36">
                        <span className="block max-w-56 truncate font-medium text-fg">
                          {customerName(f)}
                        </span>
                        <span className="text-xs text-fg-secondary tabular-nums">
                          {formatPhone(f.contact.phoneE164)}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-48">
                        <span className="block max-w-72 break-words text-fg">{f.title}</span>
                        {f.note ? (
                          <span className="line-clamp-1 max-w-72 text-xs text-fg-secondary">
                            {f.note}
                          </span>
                        ) : null}
                        {f.needsReview ? (
                          <StatusBadge status="CUSTOMER_REPLIED" className="mt-1" />
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-36 whitespace-nowrap">
                        <span className="block tabular-nums">
                          {formatDue(
                            tab === 'completed' && f.completedAt ? f.completedAt : f.dueAt,
                            timeZone,
                          )}
                        </span>
                        {f.status === 'PENDING' && f.overdue ? (
                          <StatusBadge status="OVERDUE" className="mt-1" />
                        ) : f.status === 'PENDING' && today(f.dueAt) ? (
                          <StatusBadge status="DUE_TODAY" className="mt-1" />
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {f.assignee.id === me.user.id ? 'You' : f.assignee.name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {f.salesStage ? (
                          f.salesStage.outcome === 'OPEN' ? (
                            f.salesStage.name
                          ) : (
                            <StatusBadge status={f.salesStage.outcome} label={f.salesStage.name} />
                          )
                        ) : (
                          <span className="text-fg-secondary">None</span>
                        )}
                      </TableCell>
                      <TableCell className="w-px whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          {f.conversationId ? (
                            <Button asChild size="sm" variant="secondary">
                              <Link href={`/inbox?c=${f.conversationId}`}>
                                <MessageSquare aria-hidden="true" />
                                Open chat
                                <span className="sr-only"> with {customerName(f)}</span>
                              </Link>
                            </Button>
                          ) : null}
                          <RowActions
                            label={`More actions for ${f.title}`}
                            actions={actions.actionsFor(f)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination
                hasPrevious={cursors.length > 0}
                hasNext={!!list.data?.page.nextCursor}
                onPrevious={() => setCursors((c) => c.slice(0, -1))}
                onNext={() => {
                  const next = list.data?.page.nextCursor
                  if (next) setCursors((c) => [...c, next])
                }}
                summary={`Page ${cursors.length + 1}`}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
      {creating ? <FollowUpForm open onOpenChange={setCreating} /> : null}
      {actions.dialogs}
    </ListPage>
  )
}
