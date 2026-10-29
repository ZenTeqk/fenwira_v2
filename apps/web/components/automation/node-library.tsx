'use client'
import type { NodeType } from '@fenwira/contracts'
import { Button, EmptyState, Input } from '@fenwira/ui'
import { useState } from 'react'
import { NODE_LABEL, ADD_MENU } from '@/lib/automation'
import { NODE_HINT, NodeSymbol } from './node-presentation'

export function NodeLibrary({
  replyStudio = false,
  hasTrigger,
  onAdd,
}: {
  replyStudio?: boolean
  hasTrigger: boolean
  onAdd: (type: NodeType) => void
}) {
  const [search, setSearch] = useState('')
  const groups = ADD_MENU.filter((g) => g.title !== 'Start' || !hasTrigger)
    .map((g) => ({
      ...g,
      types: g.types.filter(
        (t) =>
          (!replyStudio || (t !== 'action.ai_reply' && t !== 'action.send_template')) &&
          `${NODE_LABEL[t]} ${NODE_HINT[t]}`.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    }))
    .filter((g) => g.types.length)
  return (
    <nav aria-label="Add a step" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <h2 className="text-md font-semibold text-slate">Add step</h2>
        <Input
          aria-label="Search steps"
          placeholder="Search steps…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {groups.map((g) => (
        <section key={g.title} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-secondary">{g.title}</h3>
          {g.types.map((t) => (
            <Button
              key={t}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('application/fenwira-node', t)
                event.dataTransfer.effectAllowed = 'copy'
              }}
              aria-label={NODE_LABEL[t]}
              variant="secondary"
              size="sm"
              className="h-auto min-h-11 justify-start gap-2 px-2 py-2 text-left"
              onClick={() => onAdd(t)}
            >
              <NodeSymbol type={t} compact />
              <span className="min-w-0 flex-1 whitespace-normal">
                <span className="block text-xs font-medium text-slate">{NODE_LABEL[t]}</span>
                <span
                  title={NODE_HINT[t]}
                  className="mt-0.5 block truncate text-xs font-normal text-secondary"
                >
                  {NODE_HINT[t]}
                </span>
              </span>
            </Button>
          ))}
        </section>
      ))}
      {!groups.length ? (
        <EmptyState title="No steps found" description="Try another search." />
      ) : null}
      {hasTrigger ? (
        <p className="text-xs text-muted">
          This flow already has its trigger. Select it on the canvas or outline to edit it.
        </p>
      ) : null}
    </nav>
  )
}
