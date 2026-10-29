'use client'
import { type DraftGraph, type FlowTestResult } from '@fenwira/contracts'
import { Alert, Button, Field, Input, PhoneFrame } from '@fenwira/ui'
import { useState } from 'react'
import { errorText, post } from '@/lib/api/client'
import { type DraftNode } from '@/lib/automation'
export function ReplyTestPhone({
  graph,
  save,
  onTested,
  onResult,
}: {
  graph: DraftGraph
  save: () => Promise<string>
  onTested?: () => void
  onResult?: (r: FlowTestResult) => void
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({}),
    [result, setResult] = useState<FlowTestResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [answer, setAnswer] = useState('')
  const last = result?.steps.at(-1)
  const waiting = last
    ? graph.nodes.find(
        (n) =>
          n.id === last.nodeId &&
          (n.type === 'action.question' || n.type === 'action.options') &&
          answers[String(n.config.field)] === undefined,
      )
    : undefined
  const trigger = graph.nodes.find((n) => n.type.startsWith('trigger.'))
  async function run(next: Record<string, string>) {
    setBusy(true)
    setError('')
    try {
      const id = await save()
      const r = (
        await post<{ data: FlowTestResult }>(`/flows/${id}/test`, {
          message: (trigger?.config.keywords as string[])?.[0] ?? 'Hello',
          contact: { name: 'Asha' },
          answers: next,
        })
      ).data
      setAnswers(next)
      setResult(r)
      onResult?.(r)
      if (!r.matched) setError(r.reason ?? 'This sample does not match the trigger.')
      else if (r.steps.some((s) => s.status === 'FAILED'))
        setError('A step failed. Fix it before publishing.')
      else if (
        !r.steps.some((s) => {
          const n = graph.nodes.find((n) => n.id === s.nodeId)
          return (
            (n?.type === 'action.question' || n?.type === 'action.options') &&
            next[String(n.config.field)] === undefined
          )
        })
      )
        onTested?.()
    } catch (e) {
      setError(errorText(e, e instanceof Error ? e.message : 'The test could not run.'))
    } finally {
      setBusy(false)
    }
  }
  function reply(node: DraftNode, value: string) {
    setAnswer('')
    void run({ ...answers, [String(node.config.field)]: value })
  }
  return (
    <div className="flex min-w-0 flex-col items-center gap-4">
      <p className="text-sm text-secondary">
        Test the saved draft with sample answers. No customer messages are sent.
      </p>
      {error ? (
        <Alert tone="danger" title="Test flow needs attention">
          {error}
        </Alert>
      ) : null}
      <PhoneFrame contactName="Your business" messageCount={result?.steps.length ?? 0}>
        <div className="flex flex-col gap-3 p-3" aria-live="polite">
          {result?.steps.map((s, i) => (
            <div
              key={`${s.nodeId}-${i}`}
              className="whitespace-pre-wrap rounded-lg border border-border bg-surface p-3 text-sm text-slate"
            >
              {s.summary}
            </div>
          ))}
          {!result ? (
            <p className="rounded-lg bg-surface p-3 text-sm text-secondary">
              Start the test to try your flow as a customer.
            </p>
          ) : null}
        </div>
      </PhoneFrame>
      {waiting?.type === 'action.options' ? (
        <div className="flex flex-wrap justify-center gap-2">
          {((waiting.config.options as Array<{ label: string; value: string }>) ?? []).map((o) => (
            <Button
              key={o.value}
              variant="secondary"
              disabled={busy}
              onClick={() => reply(waiting, o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
      ) : waiting ? (
        <form
          className="flex w-full max-w-sm items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (answer.trim()) reply(waiting, answer)
          }}
        >
          <Field label="Customer answer">
            <Input value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} />
          </Field>
          <Button type="submit" disabled={busy || !answer.trim()}>
            Reply
          </Button>
        </form>
      ) : null}
      <Button
        variant="secondary"
        loading={busy}
        onClick={() => {
          setAnswers({})
          setResult(null)
          void run({})
        }}
      >
        {result ? 'Restart test' : 'Start test'}
      </Button>
    </div>
  )
}
