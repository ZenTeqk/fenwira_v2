'use client'
import { type AutomationsAnalytics, type Flow } from '@fenwira/contracts'
import { Button, Modal, ModalContent, StatusBadge } from '@fenwira/ui'
import { BarChart3, CheckCircle2, Clock3, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useAnalytics, percent } from '@/lib/analytics'
import { useSession } from '@/components/session/session-provider'
import { Choose } from '@/components/reply-studio/choose'
export function useWorkflowAnalytics() {
  const { can } = useSession()
  return useAnalytics<AutomationsAnalytics>(
    'automations',
    { kind: 'preset', days: 7 },
    can('analytics.read'),
  )
}
export function WorkflowSummary({ flows }: { flows: Flow[] }) {
  const { can } = useSession(),
    analytics = useWorkflowAnalytics()
  const ready = analytics.data?.meta.freshness.status === 'READY'
  const k = ready ? analytics.data?.kpis : undefined
  return (
    <section
      aria-label="Workflow overview"
      className="rounded-lg border border-border-subtle bg-surface"
    >
      <dl className="grid grid-cols-2 gap-y-4 divide-x divide-border-subtle py-3 lg:grid-cols-4">
        <div className="flex min-w-0 items-center gap-3 px-4">
          <dt className="sr-only">Live workflows</dt>
          <dd>
            <StatusBadge
              status="ACTIVE"
              label={`${flows.filter((f) => f.status === 'ACTIVE').length} workflows live`}
            />
          </dd>
        </div>
        {[
          {
            icon: BarChart3,
            label: 'runs · last 7 days',
            value: k?.executions.value ?? flows.reduce((sum, f) => sum + f.executions.last7d, 0),
          },
          {
            icon: CheckCircle2,
            label: 'successful · last 7 days',
            value: k ? percent(k.successRate.value) : '—',
          },
          {
            icon: TriangleAlert,
            label: 'failed runs · last 7 days',
            value: k?.failed.value ?? '—',
          },
        ].map((m, i) => (
          <div key={m.label} className="flex min-w-0 flex-wrap items-center gap-2 px-4">
            <m.icon
              aria-hidden="true"
              className={`size-4 shrink-0 ${i === 2 && Number(m.value) > 0 ? 'text-status-warning-fg' : 'text-fg-secondary'}`}
            />
            <dt className="order-2 text-sm text-fg-secondary">{m.label}</dt>
            <dd
              className={`text-sm font-semibold tabular-nums ${i === 2 && Number(m.value) > 0 ? 'text-status-warning-fg' : 'text-fg'}`}
            >
              {typeof m.value === 'number' ? m.value.toLocaleString('en-IN') : m.value}
            </dd>
          </div>
        ))}
      </dl>
      {can('analytics.read') && !ready ? (
        <p className="border-t border-border-subtle px-4 py-2 text-xs text-fg-muted">
          {analytics.isError
            ? 'Analytics unavailable.'
            : analytics.isPending
              ? 'Loading analytics…'
              : 'Analytics are processing.'}{' '}
          Live workflow and loaded run counts remain available.
        </p>
      ) : null}
    </section>
  )
}
export function WorkflowHistory({ flows }: { flows: Flow[] }) {
  const [open, setOpen] = useState(false),
    [id, setId] = useState('')
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Clock3 aria-hidden="true" />
        Execution history
      </Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent
          title="Execution history"
          description="Choose a workflow to see its real runs, step outcomes and conversations."
        >
          {flows.length ? (
            <div className="flex flex-col gap-4">
              <Choose
                label="Workflow"
                value={id}
                onChange={setId}
                options={flows.map((f) => ({ value: f.id, label: f.name }))}
              />
              <Button asChild aria-disabled={!id || undefined}>
                <Link
                  href={id ? `/automations/${id}/history` : '#'}
                  tabIndex={id ? undefined : -1}
                  onClick={(e) => {
                    if (!id) e.preventDefault()
                  }}
                >
                  View execution history
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-fg-secondary">
              No workflows yet. History appears after your first workflow runs.
            </p>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}
