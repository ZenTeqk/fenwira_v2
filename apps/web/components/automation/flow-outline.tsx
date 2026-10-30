'use client'

import {
  type DraftGraph,
  type FlowIssue,
  isTrigger,
  type NodeType,
  outputsOf,
} from '@fenwira/contracts'
import {
  Button,
  cn,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@fenwira/ui'
import { AlertCircle, Trash2 } from 'lucide-react'
import {
  addNode,
  branchLabel,
  connect,
  issuesFor,
  NODE_LABEL,
  outgoing,
  PALETTE,
  readingOrder,
  removeNode,
  summarize,
} from '@/lib/automation'

const NONE = '__none'

type Props = {
  graph: DraftGraph
  issues: FlowIssue[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (graph: DraftGraph) => void
  readOnly?: boolean
}

function AddStep({
  label,
  onAdd,
  triggers,
  replyStudio,
}: {
  label: string
  onAdd: (t: NodeType) => void
  replyStudio?: boolean
  triggers: boolean
}) {
  return (
    <Select value="" onValueChange={(t) => onAdd(t as NodeType)}>
      <SelectTrigger aria-label={label} className="w-56">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {PALETTE.filter((g) => triggers === (g.category === 'trigger')).map((g) => (
          <SelectGroup key={g.title}>
            <SelectLabel>{g.title}</SelectLabel>
            {g.types
              .filter(
                (t) => !replyStudio || (t !== 'action.ai_reply' && t !== 'action.send_template'),
              )
              .map((t) => (
                <SelectItem key={t} value={t}>
                  {NODE_LABEL[t]}
                </SelectItem>
              ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The keyboard and screen-reader alternative to the canvas (P10 plan §11): every step in reading
 * order with its connections as selects, the same inspector, add and delete. No dragging needed.
 */
export function FlowOutline({ graph, issues, selectedId, onSelect, onChange, readOnly }: Props) {
  const steps = readingOrder(graph)
  const hasTrigger = graph.nodes.some((n) => isTrigger(n.type))
  const number = new Map(steps.map((s, i) => [s.id, i + 1]))
  const name = (id: string) => {
    const n = graph.nodes.find((x) => x.id === id)
    return n ? `Step ${number.get(id)}: ${NODE_LABEL[n.type]}` : 'Unknown'
  }
  return (
    <div className="flex flex-col gap-4">
      {!hasTrigger && !readOnly ? (
        <AddStep
          replyStudio={!!graph.replyStudio}
          label="Add a trigger"
          triggers
          onAdd={(t) => {
            const r = addNode(graph, t)
            onChange(r.graph)
            onSelect(r.id)
          }}
        />
      ) : null}
      <ol aria-label="Flow steps" className="flex flex-col gap-3">
        {steps.map((n) => {
          const own = issuesFor(issues, n.id)
          const selected = n.id === selectedId
          return (
            <li
              key={n.id}
              className={cn(
                'flex flex-col gap-3 rounded-md border border-border bg-surface p-4',
                selected && 'ring-2 ring-primary',
                own.length > 0 && 'border-danger',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button
                  type="button"
                  className="text-left"
                  aria-pressed={selected}
                  onClick={() => onSelect(selected ? null : n.id)}
                >
                  <span className="block font-semibold text-slate">{name(n.id)}</span>
                  <span className="block text-sm text-muted">{summarize(n)}</span>
                </button>
                {own.length ? (
                  <span className="inline-flex items-center gap-1 text-sm text-danger-strong">
                    <AlertCircle className="size-4" aria-hidden="true" />
                    {own.length === 1 ? own[0]!.message : `${own.length} problems`}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                {outputsOf(n.type).map((h) => {
                  const current = outgoing(graph, n.id, h)?.target ?? NONE
                  const id = `out-${n.id}-${h}`
                  return (
                    <div key={h} className="flex flex-col gap-1.5">
                      <Label htmlFor={id}>
                        {branchLabel(n, h)} ({name(n.id)})
                      </Label>
                      <Select
                        value={current}
                        disabled={readOnly}
                        onValueChange={(v) =>
                          onChange(connect(graph, n.id, h, v === NONE ? null : v))
                        }
                      >
                        <SelectTrigger id={id} className="w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Not connected</SelectItem>
                          {steps
                            .filter((t) => t.id !== n.id && !isTrigger(t.type))
                            .map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {name(t.id)}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )
                })}
                {readOnly || n.type === 'action.end' ? null : (
                  <AddStep
                    replyStudio={!!graph.replyStudio}
                    label={`Add a step after ${name(n.id)}`}
                    triggers={false}
                    onAdd={(t) => {
                      const r = addNode(graph, t, n.id)
                      onChange(r.graph)
                      onSelect(r.id)
                    }}
                  />
                )}
                {readOnly ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete ${name(n.id)}`}
                    onClick={() => {
                      onChange(removeNode(graph, n.id))
                      if (selected) onSelect(null)
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
