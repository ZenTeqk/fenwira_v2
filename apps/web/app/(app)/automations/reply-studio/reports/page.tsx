'use client'
import { type ReplyReport } from '@fenwira/contracts'
import {
  Alert,
  Button,
  DataTable,
  Field,
  Input,
  ListPage,
  PermissionState,
  type ColumnDef,
} from '@fenwira/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { errorText, get } from '@/lib/api/client'
import { automationKey, useFlows } from '@/lib/automation'
import { FailureList } from '@/components/automation/flow-activity'
import { AutomationNavigation } from '@/components/automation-list/navigation'
import { Choose } from '@/components/reply-studio/choose'
const METRICS = ['starts', 'completions', 'fallbacks', 'handovers', 'expired', 'failures'] as const
export default function ReportsPage() {
  const { tenantId, can } = useSession(),
    flows = useFlows()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const [from, setFrom] = useState(
      new Date(Date.now() - 29 * 86400000).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Kolkata',
      }),
    ),
    [to, setTo] = useState(today),
    [flowId, setFlowId] = useState('all')
  const end = to ? new Date(Date.parse(`${to}T00:00:00+05:30`) + 86400000).toISOString() : ''
  const params = new URLSearchParams({
    from: from ? new Date(`${from}T00:00:00+05:30`).toISOString() : '',
    to: end,
    ...(flowId === 'all' ? {} : { flowId }),
  })
  const report = useQuery({
    queryKey: automationKey(tenantId, 'reply-report', params.toString()),
    queryFn: () =>
      get<{ data: ReplyReport }>(`/reply-studio/reports?${params}`).then((r) => r.data),
    enabled: can('automations.read') && !!from && !!to && from <= to,
  })
  if (!can('automations.read')) return <PermissionState what="Reply Studio reports" />
  const columns: ColumnDef<ReplyReport['flows'][number]>[] = [
    {
      accessorKey: 'name',
      header: 'Flow',
      cell: ({ row }) => (
        <Link
          className="text-primary-strong underline"
          href={`/automations/${row.original.flowId}/history`}
        >
          {row.original.name}
        </Link>
      ),
    },
    ...[...METRICS, 'sent', 'blocked', 'sendFailed'].map((k) => ({
      accessorKey: k,
      header:
        k === 'expired'
          ? 'Expired sessions'
          : k === 'sendFailed'
            ? 'Send failed'
            : k.charAt(0).toUpperCase() + k.slice(1),
    })),
  ]
  return (
    <ListPage
      header={{
        title: 'Reports',
        description:
          'Starts are grouped by their start date. Counts come from execution history; failures include messages rejected while sending.',
        breadcrumbs: [
          { label: 'Automations', href: '/automations' },
          { label: 'Reply Studio', href: '/automations/reply-studio' },
          { label: 'Reports' },
        ],
        linkAs: Link,
      }}
    >
      <AutomationNavigation active="reports" />
      <p className="text-sm text-secondary">
        Auto Replies: Sent counts messages accepted as sent, delivered or read; Blocked counts
        policy-denied messages; Send failed counts other delivery failures. Bot Flows: Completed,
        Fallback, Expired, Handed over and Failed count executions.
      </p>
      <details className="text-sm text-secondary">
        <summary>What counts as Completed?</summary>
        <p className="mt-2">
          A Bot Flow reached End or Handover successfully. Expired sessions do not count. A
          completed execution does not guarantee message delivery; send outcomes are recorded
          separately.
        </p>
      </details>
      {report.data?.totals.starts === 0 ? (
        <p className="text-sm text-muted">No activity yet</p>
      ) : null}
      <div className="flex flex-wrap items-end gap-4">
        <Field label="From (India time)">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To (India time)">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Choose
          label="Flow"
          value={flowId}
          onChange={setFlowId}
          options={[
            { value: 'all', label: 'All flows' },
            ...(flows.data ?? [])
              .filter((f) => f.managedBy === 'REPLY_STUDIO')
              .map((f) => ({ value: f.id, label: f.name })),
          ]}
        />
      </div>
      {from > to ? (
        <Alert tone="danger" title="Choose a valid date range">
          The end date must be on or after the start date.
        </Alert>
      ) : null}
      {report.isError ? (
        <Alert
          tone="danger"
          title="Could not load reports"
          action={
            <Button variant="secondary" onClick={() => void report.refetch()}>
              Retry
            </Button>
          }
        >
          {errorText(report.error)}
        </Alert>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {METRICS.map((k) => (
          <div key={k} className="rounded-lg border border-border bg-surface p-4">
            <dt className="text-sm capitalize text-secondary">
              {k === 'expired' ? 'Expired sessions' : k}
            </dt>
            <dd className="mt-2 text-xl font-semibold text-slate">
              {report.data?.totals[k] ?? '—'}
            </dd>
          </div>
        ))}
      </dl>
      <DataTable
        label="Reply Studio flow reports"
        columns={columns}
        data={report.data?.flows ?? []}
        getRowId={(r) => r.flowId}
        loading={report.isLoading}
        empty={{
          title: 'No flows in this range',
          description: 'Publish a flow and receive customer messages to see its activity here.',
        }}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-slate">Failures</h2>
        <p className="text-sm text-secondary">The latest 100 failures in this range.</p>
        <FailureList failures={report.data?.failures ?? []} />
      </section>
    </ListPage>
  )
}
