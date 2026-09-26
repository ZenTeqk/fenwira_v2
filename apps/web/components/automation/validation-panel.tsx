'use client'

import { type DraftGraph, type FlowIssue } from '@fenwira/contracts'
import { CheckCircle2 } from 'lucide-react'
import { NODE_LABEL } from '@/lib/automation'

/** Live publish-gate results; each problem focuses its step when chosen. */
export function ValidationPanel({
  graph,
  issues,
  onSelect,
}: {
  graph: DraftGraph
  issues: FlowIssue[]
  onSelect: (id: string) => void
}) {
  return (
    <section aria-labelledby="validation-title" aria-live="polite" className="flex flex-col gap-2">
      <h2 id="validation-title" className="text-sm font-semibold text-slate">
        {issues.length ? `${issues.length} to fix before publishing` : 'Ready to publish'}
      </h2>
      {issues.length === 0 ? (
        <p className="inline-flex items-center gap-2 text-sm text-slate">
          <CheckCircle2 className="size-4 text-primary-strong" aria-hidden="true" />
          Every step is set up and connected.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {issues.map((issue, i) => {
            const node = issue.nodeId ? graph.nodes.find((n) => n.id === issue.nodeId) : undefined
            return (
              <li key={i} className="text-sm text-slate">
                {node ? (
                  <button
                    type="button"
                    className="font-medium text-danger-strong underline-offset-4 hover:underline"
                    onClick={() => onSelect(node.id)}
                  >
                    {NODE_LABEL[node.type]}:
                  </button>
                ) : null}{' '}
                {issue.message}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
