'use client'
import { type FlowTestResult, type NodeType } from '@fenwira/contracts'
import { Button, StatusBadge } from '@fenwira/ui'
import { NODE_LABEL } from '@/lib/automation'
export function TestTranscript({
  result,
  onSelect,
}: {
  result: FlowTestResult
  onSelect?: (id: string) => void
}) {
  return (
    <section aria-label="Test transcript" className="flex w-full min-w-0 flex-col gap-4">
      <div>
        <h3 className="text-md font-semibold text-slate">Explain this match</h3>
        <p className="mt-2 text-sm text-secondary">
          Dry run only. No customer messages or external actions occur. Sample eligibility is shown
          separately from live execution.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          status={result.matched ? 'VALID' : 'INVALID'}
          label={result.matched ? 'Matched' : 'Not matched'}
        />
        {!result.matched ? <p className="text-sm text-secondary">{result.reason}</p> : null}
      </div>
      <ul className="flex flex-col gap-2">
        {result.explanations?.map((r, i) => (
          <li key={`${r.code}-${i}`} className="text-sm text-secondary">
            {r.text}
            <code className="ml-2 text-xs text-muted">{r.code}</code>
          </li>
        ))}
      </ul>
      <ol aria-label="Explained test steps" className="flex flex-col gap-4">
        {result.steps.map((s, i) => (
          <li key={`${s.nodeId}-${i}`} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {onSelect ? (
                <Button size="sm" variant="ghost" onClick={() => onSelect(s.nodeId)}>
                  {i + 1}. {NODE_LABEL[s.nodeType as NodeType] ?? s.nodeType} · {s.nodeId}
                </Button>
              ) : (
                <h4 className="text-sm font-semibold text-slate">
                  {i + 1}. {NODE_LABEL[s.nodeType as NodeType] ?? s.nodeType} · {s.nodeId}
                </h4>
              )}
              <StatusBadge status={s.status} />
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-secondary">{s.summary}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {s.explanations?.map((r, j) => (
                <li key={`${r.code}-${j}`} className="text-sm text-secondary">
                  {r.text}
                  <code className="ml-2 text-xs text-muted">{r.code}</code>
                </li>
              ))}
            </ul>
            {s.errorCode ? <code className="text-xs text-danger-strong">{s.errorCode}</code> : null}
          </li>
        ))}
      </ol>
      {result.truncated ? (
        <p className="text-sm text-secondary">Stopped at the step limit; check for a loop.</p>
      ) : null}
    </section>
  )
}
