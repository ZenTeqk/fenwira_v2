'use client'

import { isTrigger, type NodeType } from '@fenwira/contracts'
import { EmptyState, Modal, ModalContent, SearchInput } from '@fenwira/ui'
import { type KeyboardEvent, useState } from 'react'
import { ADD_MENU, NODE_LABEL } from '@/lib/automation'
import { NODE_HINT, NodeSymbol } from './node-presentation'

/**
 * The canvas "+" menu: search, then steps grouped as Triggers, Conditions, Actions and AI, each
 * with its icon and a one-line description. Arrow keys move between items; Enter picks one.
 */
export function AddStepMenu({
  replyStudio = false,
  open,
  onOpenChange,
  mode,
  onPick,
}: {
  replyStudio?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `trigger`: an empty flow needs its trigger; `step`: anything but a trigger. */
  mode: 'trigger' | 'step'
  onPick: (type: NodeType) => void
}) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const groups = ADD_MENU.map((g) => ({
    ...g,
    types: g.types.filter(
      (t) =>
        (!replyStudio || (t !== 'action.ai_reply' && t !== 'action.send_template')) &&
        (mode === 'trigger') === isTrigger(t) &&
        `${NODE_LABEL[t]} ${NODE_HINT[t]}`.toLowerCase().includes(q),
    ),
  })).filter((g) => g.types.length)

  function move(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-add-item]')]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      items[at + (e.key === 'ArrowDown' ? 1 : -1)] ??
      items[e.key === 'ArrowDown' ? 0 : items.length - 1]
    next?.focus()
    e.preventDefault()
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) setSearch('')
        onOpenChange(o)
      }}
    >
      <ModalContent
        title={mode === 'trigger' ? 'Add a trigger' : 'Add a step'}
        description={
          mode === 'trigger'
            ? 'Choose what starts this automation.'
            : 'Choose what happens next. Use the arrow keys to move through the list.'
        }
        className="max-w-xl"
      >
        <div className="flex flex-col gap-4" onKeyDown={move}>
          <SearchInput
            label="Search steps"
            placeholder="Search steps…"
            value={search}
            onValueChange={setSearch}
            className="sm:w-full"
            autoFocus
          />
          {groups.map((g) => (
            <section
              key={g.title}
              aria-labelledby={`add-${g.title}`}
              className="flex flex-col gap-1"
            >
              <h3 id={`add-${g.title}`} className="text-xs font-semibold text-secondary">
                {g.title}
              </h3>
              <ul className="flex flex-col gap-1">
                {g.types.map((t) => (
                  <li key={t}>
                    <button
                      type="button"
                      data-add-item
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover focus-visible:bg-neutral-soft focus-visible:outline-2 focus-visible:outline-focus-ring"
                      onClick={() => {
                        onPick(t)
                        setSearch('')
                      }}
                    >
                      <NodeSymbol type={t} compact />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate">
                          {NODE_LABEL[t]}
                        </span>
                        <span className="block text-xs text-secondary">{NODE_HINT[t]}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!groups.length ? (
            <EmptyState title="No steps found" description="Try another search." />
          ) : null}
        </div>
      </ModalContent>
    </Modal>
  )
}
