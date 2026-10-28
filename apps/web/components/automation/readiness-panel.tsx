'use client'

import { type DraftGraph, type FlowIssue, type Overlap } from '@fenwira/contracts'
import { Alert, Button, Modal, ModalContent } from '@fenwira/ui'
import { AlertTriangle, CheckCircle2, FlaskConical } from 'lucide-react'
import { issueNodeId, NODE_LABEL, plainIssue } from '@/lib/automation'

/** One sentence per overlap, naming who runs first (AE3 order, keyword precedence). */
export function overlapSentence(o: Overlap, currentId: string): string {
  const other = `“${o.flow.name}”`
  if (o.kind === 'SUPPRESSES')
    return o.suppressed === currentId
      ? `Messages that match the keywords of ${other} go to that automation instead, so this one doesn’t run for them. Keyword automations win over Message received.`
      : `When a message matches these keywords, ${other} (Message received) doesn’t run for it. Keyword automations win over Message received.`
  return o.first === currentId
    ? `${other} (priority ${o.flow.priority}) can match the same events. Both run, one after the other: this automation runs first.`
    : `${other} (priority ${o.flow.priority}) can match the same events. Both run, one after the other: ${other} runs first.`
}

/**
 * "Ready to publish?": every problem in plain language with a Fix button that opens its step,
 * then, once valid, what other live automations will do with the same events.
 */
export function ReadinessPanel({
  graph,
  issues,
  overlaps,
  flowId,
  onFix,
}: {
  graph: DraftGraph
  issues: FlowIssue[]
  overlaps: Overlap[]
  flowId: string
  onFix: (nodeId: string) => void
}) {
  return (
    <section aria-labelledby="readiness-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="readiness-title" className="text-sm font-semibold text-slate">
          Ready to publish?
        </h2>
        <span aria-live="polite" className="inline-flex items-center gap-1.5 text-sm text-slate">
          {issues.length ? (
            <>
              <AlertTriangle className="size-4 text-warning-strong" aria-hidden="true" />
              {issues.length === 1
                ? '1 thing to fix first'
                : `${issues.length} things to fix first`}
            </>
          ) : (
            <>
              <CheckCircle2 className="size-4 text-success-strong" aria-hidden="true" />
              Yes. Every step is set up and connected.
            </>
          )}
        </span>
      </div>
      {issues.length ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface">
          {issues.map((issue, i) => {
            const nodeId = issueNodeId(graph, issue)
            const node = nodeId ? graph.nodes.find((n) => n.id === nodeId) : undefined
            const text = plainIssue(issue, node)
            return (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm text-slate">
                  {node ? <span className="font-medium">{NODE_LABEL[node.type]}: </span> : null}
                  {text}
                </span>
                {node ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Fix ${NODE_LABEL[node.type]}: ${text}`}
                    onClick={() => onFix(node.id)}
                  >
                    Fix
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      {overlaps.length ? (
        <Alert tone="info" title="Other live automations can match the same trigger">
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {overlaps.map((o) => (
              <li key={o.flow.id}>{overlapSentence(o, flowId)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </section>
  )
}

/** After publishing: the summary sentence, a "Test it" shortcut and what happens next. */
export function PublishedDialog({
  open,
  onOpenChange,
  summary,
  onTest,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  summary: string
  onTest: () => void
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title="Your automation is live"
        description="New matching events use this version from now on."
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button onClick={onTest}>
              <FlaskConical aria-hidden="true" />
              Test it
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="rounded-md bg-primary-soft p-3 text-sm text-slate">{summary}</p>
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-slate">What happens next</h3>
            <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-secondary">
              <li>It runs on its own whenever the trigger happens, even when nobody is online.</li>
              <li>If a teammate replies in a conversation, the automation stops for that chat.</li>
              <li>Every run appears in History, step by step. Pause it there at any time.</li>
            </ul>
          </div>
        </div>
      </ModalContent>
    </Modal>
  )
}
