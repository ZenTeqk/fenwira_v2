'use client'
import { ProvisionWorkspace } from './platform-accounts'
import { platformWorkspaceRowSchema, type PlatformWorkspaceRow } from '@fenwira/contracts'
import {
  Badge,
  EmptyState,
  ErrorState,
  FilterBar,
  ListPage,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  type StatusKey,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { platformMoney, platformRequest } from '@/lib/platform'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')
const STATUS: Record<string, { status: StatusKey; label: string }> = {
  TRIALING: { status: 'PENDING', label: 'Trial' },
  ACTIVE: { status: 'ACTIVE', label: 'Active' },
  PAST_DUE: { status: 'ATTENTION', label: 'Past due' },
  SUSPENDED: { status: 'PAUSED', label: 'Suspended' },
  EXPIRED: { status: 'ERROR', label: 'Expired' },
  CANCELLED: { status: 'DISCONNECTED', label: 'Cancelled' },
}
export const workspaceStatus = (w: Pick<PlatformWorkspaceRow, 'status' | 'internal'>) =>
  w.internal ? (
    <Badge tone="info">Internal</Badge>
  ) : w.status && STATUS[w.status] ? (
    <StatusBadge {...STATUS[w.status]!} />
  ) : (
    <span className="text-sm text-secondary">No subscription</span>
  )

export function useWorkspaceList() {
  return useQuery({
    queryKey: ['platform', 'workspace-list'],
    retry: false,
    queryFn: async () =>
      z.array(platformWorkspaceRowSchema).parse(await platformRequest('/workspace-list')),
  })
}

/** Every workspace with plan, status, dates, owner, WhatsApp health and money owed. */
export function WorkspaceSearch() {
  const router = useRouter()
  const list = useWorkspaceList()
  const [q, setQ] = useState(''),
    [status, setStatus] = useState('all'),
    [plan, setPlan] = useState('all'),
    [kind, setKind] = useState('all')
  const plans = useMemo(
    () => [
      ...new Map((list.data ?? []).flatMap((w) => (w.plan ? [[w.plan.key, w.plan]] : []))).values(),
    ],
    [list.data],
  )
  const rows = (list.data ?? []).filter((w) => {
    const needle = q.trim().toLowerCase()
    return (
      (!needle ||
        w.name.toLowerCase().includes(needle) ||
        w.slug === needle ||
        w.id === needle ||
        (w.ownerEmail ?? '').toLowerCase().includes(needle)) &&
      (status === 'all' || (w.status ?? 'NONE') === status) &&
      (plan === 'all' || (w.plan?.key ?? 'NONE') === plan) &&
      (kind === 'all' || (kind === 'internal') === w.internal)
    )
  })
  const active = [status, plan, kind].filter((v) => v !== 'all').length + (q ? 1 : 0)
  return (
    <ListPage
      header={{
        title: 'Workspaces',
        description:
          'Every customer workspace with its plan, status, next payment and WhatsApp health. Open one to manage its team, WhatsApp number and invoices. See docs/MANAGED_LAUNCH.md § 3 Onboard one customer.',
        actions: <ProvisionWorkspace />,
      }}
    >
      <FilterBar
        label="Workspace filters"
        activeCount={active}
        onClear={() => {
          setQ('')
          setStatus('all')
          setPlan('all')
          setKind('all')
        }}
      >
        <SearchInput
          label="Search workspaces"
          placeholder="Name, owner email, slug or ID"
          value={q}
          onValueChange={setQ}
          maxLength={120}
        />
        <Choice
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            ['all', 'All statuses'],
            ...Object.entries(STATUS).map(([k, v]) => [k, v.label] as [string, string]),
            ['NONE', 'No subscription'],
          ]}
        />
        <Choice
          label="Plan"
          value={plan}
          onChange={setPlan}
          options={[
            ['all', 'All plans'],
            ...plans.map((p) => [p.key, p.name] as [string, string]),
            ['NONE', 'No plan yet'],
          ]}
        />
        <Choice
          label="Type"
          value={kind}
          onChange={setKind}
          options={[
            ['all', 'Customers and internal'],
            ['customer', 'Customers only'],
            ['internal', 'Internal only'],
          ]}
        />
      </FilterBar>
      {list.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={list.data.length ? 'No workspace matches these filters' : 'No workspaces yet'}
          description={
            list.data.length
              ? 'Clear the filters or search for a different name or email.'
              : 'Create the first customer workspace with Create workspace; its owner gets a setup link.'
          }
        />
      ) : (
        <Table containerLabel="Workspaces">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trial ends</TableHead>
              <TableHead>Next due</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>WhatsApp</TableHead>
              <TableHead>Last message</TableHead>
              <TableHead>Open invoices</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((w) => (
              <TableRow
                key={w.id}
                className="cursor-pointer hover:bg-background"
                onClick={() => router.push(`/platform/workspaces/${w.id}`)}
              >
                <TableCell>
                  <Link
                    href={`/platform/workspaces/${w.id}`}
                    className="font-medium text-primary-strong hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {w.name}
                  </Link>
                  <p className="text-xs text-secondary">{w.slug}</p>
                </TableCell>
                <TableCell>
                  {w.internal ? 'Business (internal)' : (w.plan?.name ?? 'Not chosen')}
                </TableCell>
                <TableCell>{workspaceStatus(w)}</TableCell>
                <TableCell>{w.status === 'TRIALING' ? day(w.trialEndsAt) : '—'}</TableCell>
                <TableCell>
                  {day(w.nextDueAt ?? (w.status === 'ACTIVE' ? w.currentPeriodEnd : null))}
                </TableCell>
                <TableCell className="break-all">{w.ownerEmail ?? '—'}</TableCell>
                <TableCell>
                  {w.whatsapp === 'NONE' ? (
                    <span className="text-sm text-secondary">Not connected</span>
                  ) : (
                    <StatusBadge
                      status={w.whatsapp === 'HEALTHY' ? 'CONNECTED' : 'ATTENTION'}
                      label={w.whatsapp === 'HEALTHY' ? 'Healthy' : 'Needs attention'}
                    />
                  )}
                </TableCell>
                <TableCell>
                  {w.lastMessageAt ? new Date(w.lastMessageAt).toLocaleString() : 'None yet'}
                </TableCell>
                <TableCell>
                  {w.openInvoices ? `${w.openInvoices} · ${platformMoney(w.openTotalMinor)}` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {list.data?.length === 500 ? (
        <p className="text-sm text-secondary">
          Showing the newest 500 workspaces; older ones are not listed here.
        </p>
      ) : null}
    </ListPage>
  )
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<[string, string]>
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-auto min-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
