'use client'

import { type AiPlaygroundResponse } from '@fenwira/contracts'
import { Button, Card, cn, EmptyState, Input, StatusBadge } from '@fenwira/ui'
import { MessageSquare, Send } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { usePlayground } from '@/lib/ai'

type Turn = { id: number; question: string; result?: AiPlaygroundResponse; error?: unknown }

const OUTCOME_NOTE: Partial<Record<AiPlaygroundResponse['outcome'], string>> = {
  NO_ANSWER: 'No answer found in your documents',
  HANDOFF: 'Would hand the conversation to your team',
  QUOTA: 'Monthly AI replies are used up: would hand over to your team',
  ERROR: 'The assistant could not answer right now',
}

/**
 * Test (docs/AI_ASSISTANT.md → Playground): ask like a customer and see what the assistant would
 * send, plus the sources it used. Counts against the monthly quota (operator setting).
 */
export function PlaygroundTab({ samples, onGo }: { samples: string[]; onGo: (tab: string) => void }) {
  const { can } = useSession()
  const ask = usePlayground()
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [turns])

  if (!can('ai.manage'))
    return (
      <EmptyState
        icon={<MessageSquare aria-hidden="true" />}
        title="Testing needs AI Assistant access"
        description="Ask a workspace owner, admin or manager to try questions here."
      />
    )

  const submit = (text: string) => {
    const q = text.trim()
    if (!q || ask.isPending) return
    const id = Date.now()
    setTurns((t) => [...t, { id, question: q }])
    setQuestion('')
    ask.mutate(q, {
      onSuccess: (result) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, result } : x))),
      onError: (error) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, error } : x))),
    })
  }

  return (
    <Card className="flex flex-col gap-0 p-0">
      <div
        className="flex max-h-128 min-h-64 flex-col gap-4 overflow-y-auto bg-background p-4"
        role="log"
        aria-live="polite"
        aria-label="Test conversation"
      >
        {!turns.length ? (
          <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
            <p className="text-secondary">
              Ask a question the way a customer would. Nothing is sent on WhatsApp.
            </p>
            {samples.length ? (
              <div className="flex flex-wrap justify-center gap-2">
                {samples.map((s) => (
                  <Button key={s} variant="secondary" size="sm" onClick={() => submit(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            ) : (
              <Button variant="tertiary" size="sm" onClick={() => onGo('knowledge')}>
                Add knowledge to get suggested questions
              </Button>
            )}
          </div>
        ) : null}
        {turns.map((t) => (
          <div key={t.id} className="flex flex-col gap-2">
            <div className="flex justify-start">
              <p className="max-w-7/10 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-message text-slate">
                {t.question}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {t.error ? (
                <div className="w-full max-w-7/10">
                  <FormError error={t.error} />
                </div>
              ) : !t.result ? (
                <p className="text-sm text-secondary">Thinking…</p>
              ) : (
                <>
                  {t.result.answer ? (
                    <div className="flex max-w-7/10 flex-col gap-1 rounded-xl bg-message-outbound px-3.5 py-2.5 text-message text-slate">
                      <span className="text-xs font-medium text-secondary">AI</span>
                      <p className="whitespace-pre-wrap">{t.result.answer}</p>
                    </div>
                  ) : null}
                  {OUTCOME_NOTE[t.result.outcome] ? (
                    <StatusBadge status={t.result.outcome} label={OUTCOME_NOTE[t.result.outcome]} />
                  ) : null}
                  {t.result.sources.length ? (
                    <details className="w-full max-w-7/10 rounded-md border border-border bg-surface px-3 py-2 text-sm">
                      <summary className="cursor-pointer font-medium text-slate">
                        Sources used ({t.result.sources.length})
                      </summary>
                      <ul className="mt-2 flex flex-col gap-2">
                        {t.result.sources.map((s, i) => (
                          <li key={i} className="flex flex-col gap-0.5">
                            <span className="font-medium text-slate">
                              {s.documentTitle}
                              {s.page ? ` · page ${s.page}` : ''}
                            </span>
                            <span className="text-secondary">{s.snippet}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <p className="text-xs text-secondary">
                    {t.result.tokens.input + t.result.tokens.output} tokens
                  </p>
                </>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form
        className="flex items-center gap-2 border-t border-border p-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          submit(question)
        }}
      >
        <label htmlFor="ai-test-question" className="sr-only">
          Test question
        </label>
        <Input
          id="ai-test-question"
          value={question}
          maxLength={1000}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question…"
          className={cn('flex-1')}
        />
        <Button type="submit" loading={ask.isPending} disabled={!question.trim()}>
          <Send aria-hidden="true" />
          Ask
        </Button>
      </form>
    </Card>
  )
}
