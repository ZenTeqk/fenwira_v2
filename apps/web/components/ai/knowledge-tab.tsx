'use client'

import { type AiKnowledgeSource } from '@fenwira/contracts'
import {
  Button,
  Card,
  cn,
  DetailDrawer,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  EmptyState,
  ErrorState,
  Field,
  focusRing,
  Input,
  Skeleton,
  StatusBadge,
  Textarea,
  toast,
  useConfirm,
} from '@fenwira/ui'
import { AlignLeft, FileText, HelpCircle, MoreHorizontal, Plus, Trash2, Upload } from 'lucide-react'
import { type DragEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { errorText } from '@/lib/api/client'
import {
  formatBytes,
  KNOWLEDGE_ACCEPT,
  useAddFaq,
  useAddText,
  useAiSource,
  useAiSources,
  useDeleteSource,
  useReplaceSource,
  useReprocessSource,
  useUploadKnowledge,
} from '@/lib/ai'

const TYPE_ICON = { FILE: FileText, FAQ: HelpCircle, TEXT: AlignLeft } as const
const TYPE_LABEL = { FILE: 'Document', FAQ: 'FAQ', TEXT: 'Text' } as const

type Panel = { kind: 'faq' | 'text'; replace?: AiKnowledgeSource } | null

/**
 * Knowledge (docs/AI_ASSISTANT.md → Knowledge): upload area (drag and drop, or the keyboard
 * button), the source list with live status, and FAQ / text side panels. Status changes are
 * announced in a polite live region.
 */
export function KnowledgeTab() {
  const { can } = useSession()
  const editable = can('ai.manage')
  const list = useAiSources()
  const upload = useUploadKnowledge()
  const reprocess = useReprocessSource()
  const remove = useDeleteSource()
  const confirm = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [replaceId, setReplaceId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [announce, setAnnounce] = useState('')
  const previous = useRef(new Map<string, string>())

  // Announce processing → ready/failed transitions for screen readers.
  useEffect(() => {
    const seen = previous.current
    const changes: string[] = []
    for (const s of list.data ?? []) {
      const before = seen.get(s.id)
      if (before === 'PROCESSING' && s.status !== 'PROCESSING')
        changes.push(s.status === 'READY' ? `${s.title} is ready.` : `${s.title} failed: ${s.failureReason ?? ''}`)
      seen.set(s.id, s.status)
    }
    if (changes.length) setAnnounce(changes.join(' '))
  }, [list.data])

  const send = (files: FileList | File[] | null, replace?: string) => {
    for (const file of Array.from(files ?? []))
      upload.mutate(
        { file, replaceId: replace },
        {
          onSuccess: (s) =>
            toast.success(replace ? `Replacing “${s.title}”…` : `“${s.title}” added. Processing…`),
          onError: (err) => toast.error(err instanceof Error && !('code' in err) ? err.message : errorText(err)),
        },
      )
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (editable) send(e.dataTransfer.files)
  }
  const pick = (replace?: string) => {
    setReplaceId(replace ?? null)
    input.current?.click()
  }
  const onReplace = (s: AiKnowledgeSource) =>
    s.type === 'FILE' ? pick(s.id) : setPanel({ kind: s.type === 'FAQ' ? 'faq' : 'text', replace: s })
  const onDelete = async (s: AiKnowledgeSource) => {
    const ok = await confirm({
      title: `Delete “${s.title}”?`,
      destructive: true,
      impact: [
        'The assistant stops using it immediately.',
        'Past replies and usage stay in Activity.',
      ],
      confirmLabel: 'Delete source',
    })
    if (!ok) return
    remove.mutate(s.id, {
      onSuccess: () => toast.success(`“${s.title}” deleted`),
      onError: (err) => toast.error(errorText(err)),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <input
        ref={input}
        type="file"
        accept={KNOWLEDGE_ACCEPT}
        multiple={!replaceId}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="knowledge-file-input"
        onChange={(e) => {
          send(e.target.files, replaceId ?? undefined)
          e.target.value = ''
        }}
      />
      {editable ? (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center motion-safe:transition-colors',
            dragging ? 'border-primary bg-primary-soft' : 'border-border-strong bg-surface',
          )}
        >
          <Upload className="size-6 text-secondary" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-medium text-slate">Drag files here, or choose them</p>
            <p className="text-sm text-secondary">
              PDF (with selectable text), Word (.docx), TXT, Markdown or CSV · up to 10 MB each
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => pick()} loading={upload.isPending}>
              <Upload aria-hidden="true" />
              Choose files
            </Button>
            <Button variant="secondary" onClick={() => setPanel({ kind: 'faq' })}>
              <Plus aria-hidden="true" />
              Add FAQ
            </Button>
            <Button variant="secondary" onClick={() => setPanel({ kind: 'text' })}>
              <Plus aria-hidden="true" />
              Add text
            </Button>
          </div>
        </div>
      ) : null}

      {list.isLoading ? (
        <Skeleton className="h-40" />
      ) : list.isError ? (
        <ErrorState onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState
          icon={<FileText aria-hidden="true" />}
          title="No knowledge yet"
          description="The assistant only answers from what you add here: price lists, policies, opening hours, FAQs. Anything it can't find, it hands to your team."
          action={
            editable ? (
              <Button onClick={() => pick()}>
                <Upload aria-hidden="true" />
                Upload your first document
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="divide-y divide-border p-0">
          <ul aria-label="Knowledge sources" className="divide-y divide-border">
            {list.data.map((s) => {
              const Icon = TYPE_ICON[s.type]
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-neutral-soft">
                    <Icon className="size-4 text-secondary" aria-hidden="true" />
                    <span className="sr-only">{TYPE_LABEL[s.type]}</span>
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="truncate font-medium text-slate">{s.title}</p>
                    <p className="text-sm text-secondary">
                      {TYPE_LABEL[s.type]} · {formatBytes(s.sizeBytes)}
                      {s.status === 'READY' || s.replacing ? ` · ${s.chunkCount} sections` : ''}
                      {s.replacing ? ' · the previous version answers until the new one is ready' : ''}
                    </p>
                    {s.status === 'FAILED' && s.failureReason ? (
                      <p className="text-sm text-danger-strong">{s.failureReason}</p>
                    ) : null}
                  </div>
                  <StatusBadge status={s.status} />
                  {editable ? (
                    <Dropdown>
                      <DropdownTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label={`Actions for ${s.title}`}>
                          <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownTrigger>
                      <DropdownContent align="end">
                        <DropdownItem onSelect={() => onReplace(s)}>Replace</DropdownItem>
                        <DropdownItem
                          disabled={s.status === 'PROCESSING'}
                          onSelect={() =>
                            reprocess.mutate(s.id, {
                              onSuccess: () => toast.success(`Reprocessing “${s.title}”…`),
                              onError: (err) => toast.error(errorText(err)),
                            })
                          }
                        >
                          Reprocess
                        </DropdownItem>
                        <DropdownItem onSelect={() => void onDelete(s)} className="text-danger-strong">
                          <Trash2 aria-hidden="true" />
                          Delete
                        </DropdownItem>
                      </DropdownContent>
                    </Dropdown>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
      <FaqPanel panel={panel?.kind === 'faq' ? panel : null} onClose={() => setPanel(null)} />
      <TextPanel panel={panel?.kind === 'text' ? panel : null} onClose={() => setPanel(null)} />
    </div>
  )
}

type Pair = { question: string; answer: string }

function FaqPanel({ panel, onClose }: { panel: Panel; onClose: () => void }) {
  const add = useAddFaq()
  const replace = useReplaceSource()
  const existing = useAiSource(panel?.replace?.id ?? null)
  const [title, setTitle] = useState('')
  const [pairs, setPairs] = useState<Pair[]>([{ question: '', answer: '' }])
  const open = !!panel
  useEffect(() => {
    if (!open) return
    const body = existing.data?.body as { pairs?: Pair[] } | undefined
    setTitle(panel?.replace?.title ?? '')
    setPairs(body?.pairs?.length ? body.pairs : [{ question: '', answer: '' }])
  }, [open, panel, existing.data])
  const mutation = panel?.replace ? replace : add
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = pairs.filter((p) => p.question.trim() || p.answer.trim())
    const done = { onSuccess: () => { toast.success('FAQ saved. Processing…'); onClose() } }
    if (panel?.replace) replace.mutate({ id: panel.replace.id, input: { pairs: clean } }, done)
    else add.mutate({ title, pairs: clean }, done)
  }
  return (
    <DetailDrawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={panel?.replace ? `Edit “${panel.replace.title}”` : 'Add FAQ'}
      description="Each question and answer becomes one piece of knowledge."
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ai-faq-form" loading={mutation.isPending}>
            Save FAQ
          </Button>
        </>
      }
    >
      <form id="ai-faq-form" className="flex flex-col gap-4" onSubmit={submit}>
        <FormError error={mutation.error} />
        {!panel?.replace ? (
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Delivery FAQ" />
          </Field>
        ) : null}
        {pairs.map((p, i) => (
          <fieldset key={i} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium text-slate">Question {i + 1}</legend>
            <Field label="Question">
              <Input
                value={p.question}
                onChange={(e) =>
                  setPairs((all) => all.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))
                }
              />
            </Field>
            <Field label="Answer">
              <Textarea
                rows={3}
                value={p.answer}
                onChange={(e) =>
                  setPairs((all) => all.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))
                }
              />
            </Field>
            {pairs.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setPairs((all) => all.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden="true" />
                Remove question {i + 1}
              </Button>
            ) : null}
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          className={cn('self-start', focusRing)}
          onClick={() => setPairs((all) => [...all, { question: '', answer: '' }])}
        >
          <Plus aria-hidden="true" />
          Add another question
        </Button>
      </form>
    </DetailDrawer>
  )
}

function TextPanel({ panel, onClose }: { panel: Panel; onClose: () => void }) {
  const add = useAddText()
  const replace = useReplaceSource()
  const existing = useAiSource(panel?.replace?.id ?? null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const open = !!panel
  useEffect(() => {
    if (!open) return
    setTitle(panel?.replace?.title ?? '')
    setText((existing.data?.body as { text?: string } | undefined)?.text ?? '')
  }, [open, panel, existing.data])
  const mutation = panel?.replace ? replace : add
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const done = { onSuccess: () => { toast.success('Text saved. Processing…'); onClose() } }
    if (panel?.replace) replace.mutate({ id: panel.replace.id, input: { text } }, done)
    else add.mutate({ title, text }, done)
  }
  return (
    <DetailDrawer
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={panel?.replace ? `Edit “${panel.replace.title}”` : 'Add text'}
      description="Paste policies, opening hours, price lists or anything customers ask about."
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="ai-text-form" loading={mutation.isPending}>
            Save text
          </Button>
        </>
      }
    >
      <form id="ai-text-form" className="flex flex-col gap-4" onSubmit={submit}>
        <FormError error={mutation.error} />
        {!panel?.replace ? (
          <Field label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Return policy" />
          </Field>
        ) : null}
        <Field label="Text" required hint="Plain text. Headings and short paragraphs work best.">
          <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </form>
    </DetailDrawer>
  )
}
