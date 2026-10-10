'use client'

import { type ExecutionStep, type NodeType } from '@fenwira/contracts'
import { Timeline } from '@fenwira/ui'
import { CheckCircle2, CornerDownRight, PauseCircle, XCircle } from 'lucide-react'
import { NODE_LABEL } from '@/lib/automation'

const ICON = {
  SUCCEEDED: CheckCircle2,
  FAILED: XCircle,
  WAITING: PauseCircle,
  SKIPPED: CornerDownRight,
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

/** Step-by-step history on the shared Timeline (docs/AUTOMATION_ENGINE.md → Execution history). */
export function ExecutionTimeline({ steps }: { steps: ExecutionStep[] }) {
  return (
    <Timeline
      label="Steps"
      empty="No steps yet."
      items={steps.map((s) => {
        const Icon = ICON[s.status]
        const input = pretty(s.input)
        const output = pretty(s.output)
        return {
          id: String(s.seq),
          title: `${s.seq}. ${NODE_LABEL[s.nodeType as NodeType] ?? 'Stopped by takeover'}`,
          status: s.status,
          icon: <Icon aria-hidden="true" />,
          time: new Date(s.startedAt).toLocaleString(),
          description: s.errorCode ? (
            <span className="text-danger-strong">
              {ERROR_TEXT[s.errorCode] ?? s.errorDetail ?? s.errorCode}{' '}
              <span className="font-mono text-xs">({s.errorCode})</span>
            </span>
          ) : undefined,
          details:
            input || output ? (
              <div className="flex flex-col gap-2">
                {[input, output].filter(Boolean).map((text, i) => (
                  <pre
                    key={i}
                    className="overflow-x-auto rounded-sm bg-neutral-soft p-2 text-xs text-slate"
                  >
                    {text}
                  </pre>
                ))}
              </div>
            ) : undefined,
        }
      })}
    />
  )
}
