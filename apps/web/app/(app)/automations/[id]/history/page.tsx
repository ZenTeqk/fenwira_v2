'use client'

import { type Execution } from '@fenwira/contracts'
import {
  Button,
  type ColumnDef,
  DataTable,
  PageHeader,
  PermissionState,
  Skeleton,
  StatusBadge,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo, useState } from 'react'
import { ExecutionTimeline } from '@/components/automation/execution-timeline'
import { FlowCanvas } from '@/components/automation/flow-canvas'
import { useSession } from '@/components/session/session-provider'
import { ApiError, post } from '@/lib/api/client'
import {
  automationKey,
  RUN_REASON,
  useExecution,
  useExecutions,
  useFlow,
  useTriggerRun,
  useVersion,
} from '@/lib/automation'

const duration = (e: Execution) => {
  if (!e.finishedAt) return '—'
  const s = (new Date(e.finishedAt).getTime() - new Date(e.startedAt).getTime()) / 1000
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`
}

function RunPlan({ flowId, runId }: { flowId: string; runId: string | null }) {
  const run = useTriggerRun(flowId, runId)
  if (!runId) return null
  if (!run.data) return <Skeleton className="h-20 w-full" />
  return (
    <section aria-labelledby="plan-title" className="flex flex-col gap-2">
      <h3 id="plan-title" className="font-semibold text-slate">
        Automations for this event, in order
      </h3>
      {run.data.stopReason ? (
        <p className="text-sm text-slate">
          Stopped: {RUN_REASON[run.data.stopReason] ?? run.data.stopReason}
        </p>
      ) : null}
      <ol className="flex flex-col gap-1">
        {run.data.plan.map((p) => (
          <li key={p.flowId} className="flex flex-wrap items-center gap-2 text-sm text-slate">
            <span className="font-mono text-xs">#{p.priority}</span>
            <span className={p.flowId === flowId ? 'font-semibold' : undefined}>{p.flowName}</span>
            <StatusBadge status={p.status} />
            {p.reason && RUN_REASON[p.reason] ? (
              <span className="text-muted">{RUN_REASON[p.reason]}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

function Detail({ flowId, id }: { flowId: string; id: string }) {
  const { tenantId, can } = useSession()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const e = useExecution(id)
  const version = useVersion(flowId, e.data?.flowVersionId)
  const [canvas, setCanvas] = useState(false)
  const traversed = useMemo(
    () => new Map((e.data?.steps ?? []).map((s) => [s.nodeId, s.status.toLowerCase()])),
    [e.data],
  )
  if (!e.data) return <Skeleton className="h-64 w-full" />
  const live = e.data.status === 'RUNNING' || e.data.status === 'WAITING'
  async function cancel() {
    if (
      !(await confirm({
        title: 'Cancel this run?',
        description: 'It stops now and won’t resume.',
        confirmLabel: 'Cancel run',
        destructive: true,
      }))
    )
      return
    try {
      await post(`/executions/${id}/cancel`)
      toast.success('Run cancelled.')
      void qc.invalidateQueries({ queryKey: automationKey(tenantId) })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not cancel.')
    }
  }
  return (
    <section
      aria-labelledby="run-title"
      className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="run-title" className="text-lg font-semibold text-slate">
          Run for {e.data.contactName ?? 'a contact'} · version {e.data.flowVersion}
        </h2>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={canvas}
            onClick={() => setCanvas((v) => !v)}
          >
            {canvas ? 'Hide canvas' : 'Show on canvas'}
          </Button>
          {live && can('automations.publish') ? (
            <Button variant="danger" size="sm" onClick={() => void cancel()}>
              Cancel run
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate">
        <StatusBadge status={e.data.status} />
        {e.data.waitUntil ? (
          <span>Continues {new Date(e.data.waitUntil).toLocaleString()}</span>
        ) : null}
        {e.data.errorCode ? <span className="font-mono text-xs">{e.data.errorCode}</span> : null}
      </div>
      {canvas && version.data ? (
        <div className="h-120">
          <FlowCanvas
            graph={version.data.graph}
            issues={[]}
            selectedId={null}
            onSelect={() => undefined}
            traversed={traversed}
            readOnly
          />
        </div>
      ) : null}
      <ExecutionTimeline steps={e.data.steps} />
      <RunPlan flowId={flowId} runId={e.data.triggerRunId} />
    </section>
  )
}

/** Execution history for one flow (docs/AUTOMATION_ENGINE.md → Execution history UI). */
function History() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const selected = useSearchParams().get('run')
  const { can } = useSession()
  const flow = useFlow(id)
  const executions = useExecutions(id)
  if (!can('automations.read')) return <PermissionState what="automations" />
  const columns: Array<ColumnDef<Execution>> = [
    {
      id: 'contact',
      header: 'Contact',
      cell: ({ row }) => (
        <Link
          href={`/automations/${id}/history?run=${row.original.id}`}
          className="font-medium text-slate underline-offset-4 hover:underline"
          aria-current={selected === row.original.id ? 'true' : undefined}
        >
          {row.original.contactName ?? 'Unknown contact'}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'started',
      header: 'Started',
      cell: ({ row }) => new Date(row.original.startedAt).toLocaleString(),
    },
    { id: 'duration', header: 'Duration', cell: ({ row }) => duration(row.original) },
    { id: 'version', header: 'Version', cell: ({ row }) => row.original.flowVersion },
  ]
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={flow.data ? `${flow.data.name}: history` : 'History'}
        breadcrumbs={[
          { label: 'Automations', href: '/automations' },
          { label: flow.data?.name ?? 'Flow', href: `/automations/${id}` },
          { label: 'History' },
        ]}
        linkAs={Link}
        description="Each run keeps the version it started with. Open a run to see every step."
      />
      {selected ? (
        <>
          <Button
            variant="link"
            className="self-start"
            onClick={() => router.push(`/automations/${id}/history`)}
          >
            Back to all runs
          </Button>
          <Detail flowId={id} id={selected} />
        </>
      ) : (
        <DataTable
          label="Runs"
          columns={columns}
          data={executions.data ?? []}
          getRowId={(e) => e.id}
          loading={executions.isPending}
          error={executions.isError ? { onRetry: () => void executions.refetch() } : undefined}
          empty={{
            title: 'No runs yet',
            description: 'Runs appear here once the automation is triggered.',
          }}
        />
      )}
    </div>
  )
}

export default function AutomationHistoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <History />
    </Suspense>
  )
}
