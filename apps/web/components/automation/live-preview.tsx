'use client'

import type { ApprovedTemplate, DraftGraph, FlowIssue } from '@fenwira/contracts'
import {
  Button,
  cn,
  Field,
  Input,
  PhoneFrame,
  Popover,
  PopoverContent,
  PopoverTrigger,
  StatusBadge,
  Textarea,
} from '@fenwira/ui'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { TemplateMessage } from '@/components/inbox/template-message'
import {
  draftToPreview,
  previewParts,
  previewPathTo,
  type SampleContact,
} from '@/lib/automation-preview'

function PreviewText({ text }: { text: string }) {
  return (
    <>
      {previewParts(text).map((part, index) =>
        part.missing ? (
          <span
            key={index}
            className="inline-block rounded-sm bg-status-warning-bg px-1 text-status-warning-fg"
            aria-label={`Missing value: ${part.missing}`}
            title={`Missing value: ${part.missing}`}
          >
            □<span className="sr-only"> {part.missing}</span>
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  )
}

/** The catalog is already loaded by the builder. This panel performs no network requests. */
export function LivePreview({
  graph,
  templates,
  issues,
  selected,
  onSelect,
  tagName,
  memberName,
}: {
  graph: DraftGraph
  templates: readonly ApprovedTemplate[]
  issues: readonly FlowIssue[]
  selected: string | null
  onSelect: (id: string) => void
  tagName: (id: string) => string | undefined
  memberName: (id: string) => string | undefined
}) {
  const id = useId()
  const [draft, setDraft] = useState(graph)
  const [contact, setContact] = useState<SampleContact>({
    name: 'Asha Patel',
    phone: '+919876543210',
    properties: {},
  })
  const [propertyText, setPropertyText] = useState('')
  const [incoming, setIncoming] = useState<string | undefined>()
  const [paths, setPaths] = useState<Record<string, 'yes' | 'no'>>({})
  const messageRefs = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    const timer = setTimeout(() => setDraft(graph), 300)
    return () => clearTimeout(timer)
  }, [graph])
  const steps = useMemo(
    () =>
      draftToPreview(draft, { contact, incoming, paths, templates, issues, tagName, memberName }),
    [draft, contact, incoming, paths, templates, issues, tagName, memberName],
  )
  const stepIds = steps
    .map((step) => `${step.nodeId}:${step.text === 'Repeats' ? 'repeat' : 'step'}`)
    .join(',')
  useEffect(() => {
    if (selected && !messageRefs.current.has(selected)) {
      const path = previewPathTo(draft, selected)
      if (path) setPaths((current) => ({ ...current, ...path }))
    }
  }, [selected, draft])
  useEffect(() => {
    if (selected)
      messageRefs.current.get(selected)?.scrollIntoView({
        block: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
  }, [selected, stepIds])
  const trigger = draft.nodes.find((node) => node.type.startsWith('trigger.'))
  const defaultIncoming = Array.isArray(trigger?.config.keywords)
    ? String(trigger.config.keywords[0] ?? 'Hello')
    : 'Hello'
  const hasIncoming =
    trigger?.type === 'trigger.keyword' || trigger?.type === 'trigger.message_received'
  return (
    <section aria-label="Live mobile preview" className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-md font-semibold">Live preview</h2>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm">
              Sample contact
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Sample contact" className="flex flex-col gap-3">
            <Field label="Sample name">
              <Input
                value={contact.name}
                onChange={(event) => setContact({ ...contact, name: event.target.value })}
              />
            </Field>
            <Field label="Sample phone">
              <Input
                value={contact.phone}
                onChange={(event) => setContact({ ...contact, phone: event.target.value })}
              />
            </Field>
            <Field
              label="Sample properties"
              hint="One key=value per line, for example city=Mumbai. Used for contact placeholders."
            >
              <Textarea
                rows={4}
                value={propertyText}
                onChange={(event) => {
                  setPropertyText(event.target.value)
                  const properties: Record<string, string> = Object.create(null) as Record<
                    string,
                    string
                  >
                  for (const line of event.target.value.split('\n')) {
                    const at = line.indexOf('=')
                    if (at > 0) properties[line.slice(0, at).trim()] = line.slice(at + 1).trim()
                  }
                  setContact({ ...contact, properties })
                }}
              />
            </Field>
          </PopoverContent>
        </Popover>
      </div>
      <p className="text-xs text-fg-secondary">
        A quick visual of your flow. Test runs the engine-accurate dry run. Nothing is sent or
        called from this preview.
      </p>
      {hasIncoming ? (
        <Field label="Sample incoming message">
          <Input
            value={incoming ?? defaultIncoming}
            onChange={(event) => setIncoming(event.target.value)}
          />
        </Field>
      ) : null}
      <PhoneFrame
        className="fw-phone-frame-fit"
        contactName={contact.name || 'Sample contact'}
        subtitle="Sample contact"
        messageCount={steps.length}
      >
        <ol aria-label="Preview steps" className="flex flex-col gap-3">
          {steps.map((step, index) => {
            const terminal = step.text === 'Repeats' || step.text === 'Preview truncated'
            const system = !['incoming', 'outgoing', 'template', 'ai'].includes(step.kind)
            return (
              <li
                key={`${step.nodeId}-${index}`}
                ref={(element) => {
                  if (!terminal) {
                    if (element) messageRefs.current.set(step.nodeId, element)
                    else messageRefs.current.delete(step.nodeId)
                  }
                }}
                data-testid={`preview-step-${step.nodeId}${terminal ? '-terminal' : ''}`}
                data-selected={selected === step.nodeId && !terminal}
                className={cn(
                  'rounded-lg',
                  selected === step.nodeId &&
                    !terminal &&
                    'ring-2 ring-fg ring-offset-2 ring-offset-chat-canvas',
                  system ? 'self-center w-full' : step.kind === 'incoming' ? 'mr-4' : 'ml-4',
                )}
              >
                <Button
                  variant="ghost"
                  onClick={() => onSelect(step.nodeId)}
                  aria-label={`Select preview step ${index + 1}`}
                  aria-pressed={selected === step.nodeId && !terminal}
                  className={cn(
                    'h-auto w-full flex-col items-stretch whitespace-normal rounded-lg p-3 text-left text-base font-normal text-fg',
                    system
                      ? 'bg-surface text-center text-fg-secondary'
                      : step.kind === 'incoming'
                        ? 'bg-surface'
                        : 'bg-chat-outgoing',
                  )}
                >
                  {step.kind === 'template' ? (
                    <TemplateMessage
                      snapshot={step.snapshot ?? null}
                      name={step.text}
                      labelId={`${id}-${index}-label`}
                      bodyId={`${id}-${index}-body`}
                      preview
                      renderText={(text) => <PreviewText text={text} />}
                    />
                  ) : step.kind === 'warning' ? (
                    <StatusBadge status="FLAGGED" label={step.text} />
                  ) : (
                    <span className="whitespace-pre-wrap break-words">
                      <PreviewText text={step.text} />
                    </span>
                  )}
                  {step.warnings.map((warning, i) => (
                    <StatusBadge
                      key={i}
                      status="FLAGGED"
                      label={warning}
                      className="max-w-full whitespace-normal text-left"
                    />
                  ))}
                </Button>
                {step.kind === 'condition' ? (
                  <div className="mt-1 flex flex-col gap-1 rounded-md bg-surface p-2">
                    <div
                      role="group"
                      aria-label={`Preview path for ${step.nodeId}`}
                      className="flex justify-center gap-2"
                    >
                      {(['yes', 'no'] as const).map((branch) => (
                        <Button
                          key={branch}
                          variant="secondary"
                          size="sm"
                          aria-pressed={step.branch === branch}
                          onClick={() => setPaths({ ...paths, [step.nodeId]: branch })}
                        >
                          {branch === 'yes' ? 'Yes' : 'No'}
                        </Button>
                      ))}
                    </div>
                    <p className="text-xs text-fg-secondary">{step.reason}</p>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ol>
        {!steps.length ? (
          <p className="text-sm text-fg-secondary">Add a trigger to preview your flow.</p>
        ) : null}
      </PhoneFrame>
      {selected && !steps.some((step) => step.nodeId === selected) ? (
        <p className="text-xs text-fg-secondary">
          The selected step is outside the connected preview path or after the 30-step limit.
        </p>
      ) : null}
    </section>
  )
}
