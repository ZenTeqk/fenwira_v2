'use client'

import { type ExecutionStep, type NodeType } from '@fenwira/contracts'
import { cn, StatusBadge } from '@fenwira/ui'
import { CheckCircle2, CornerDownRight, PauseCircle, XCircle } from 'lucide-react'
import { NODE_LABEL } from '@/lib/automation'

const ICON = {
  SUCCEEDED: { Icon: CheckCircle2, className: 'text-primary-strong', label: 'Succeeded' },
  FAILED: { Icon: XCircle, className: 'text-danger-strong', label: 'Failed' },
  WAITING: { Icon: PauseCircle, className: 'text-info-strong', label: 'Waiting' },
  SKIPPED: { Icon: CornerDownRight, className: 'text-muted', label: 'Skipped' },
} as const

const ERROR_TEXT: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Not enough credits to send this template.',
  AUTOMATION_BLOCKED_BY_TAKEOVER: 'An agent took over the conversation, so the automation stopped.',
  CONVERSATION_WINDOW_CLOSED:
    'The 24-hour window was closed. Use a template to reach this contact.',
  FLOW_STEP_LIMIT: 'Stopped after 500 steps. Check the flow for a loop.',
  WEBHOOK_BLOCKED_DESTINATION: 'The webhook address is private or internal and was blocked.',
}

const pretty = (v: unknown) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && Object.keys(v as object).length === 0) return ''
  return JSON.stringify(v, null, 2)
}

/** Step-by-step history: ✓ succeeded, ✗ failed, ⏸ waiting, ⤼ skipped (docs/AUTOMATION_ENGINE.md). */
export function ExecutionTimeline({ steps }: { steps: ExecutionStep[] }) {
  if (!steps.length) return <p className="text-sm text-muted">No steps yet.</p>
  return (
    <ol aria-label="Steps" className="flex flex-col gap-3">
      {steps.map((s) => {
        const meta = ICON[s.status]
        const input = pretty(s.input)
        const output = pretty(s.output)
        return (
          <li key={s.seq} className="flex gap-3 rounded-md border border-border bg-surface p-3">
            <meta.Icon
              className={cn('mt-0.5 size-5 shrink-0', meta.className)}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-slate">
                  {s.seq}. {NODE_LABEL[s.nodeType as NodeType] ?? 'Stopped by takeover'}
                </p>
                <StatusBadge status={s.status} />
                <span className="text-xs text-muted">{new Date(s.startedAt).toLocaleString()}</span>
              </div>
              {s.errorCode ? (
                <p className="text-sm text-danger-strong">
                  {ERROR_TEXT[s.errorCode] ?? s.errorDetail ?? s.errorCode}{' '}
                  <span className="font-mono text-xs">({s.errorCode})</span>
                </p>
              ) : null}
              {input || output ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Details</summary>
                  {input ? (
                    <pre className="mt-2 overflow-x-auto rounded-sm bg-neutral-soft p-2 text-xs text-slate">
                      {input}
                    </pre>
                  ) : null}
                  {output ? (
                    <pre className="mt-2 overflow-x-auto rounded-sm bg-neutral-soft p-2 text-xs text-slate">
                      {output}
                    </pre>
                  ) : null}
                </details>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
