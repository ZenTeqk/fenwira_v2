'use client'

import { type CannedReply } from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  Input,
  Modal,
  ModalClose,
  ModalContent,
  useConfirm,
} from '@fenwira/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useEffect, useState } from 'react'
import { fieldError, FormError } from '@/components/auth/form-error'
import { useSession } from '@/components/session/session-provider'
import { del, patch, post } from '@/lib/api/client'
import { cannedKey, useCannedReplies } from '@/lib/canned-replies'

type Draft = { shortcut: string; title: string; body: string }
const EMPTY: Draft = { shortcut: '/', title: '', body: '' }

function ReplyModal({
  editing,
  open,
  onOpenChange,
}: {
  editing: CannedReply | null
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  useEffect(() => {
    if (open) setDraft(editing ? { ...editing } : EMPTY)
  }, [open, editing])
  const save = useMutation({
    mutationFn: () =>
      editing ? patch(`/canned-replies/${editing.id}`, draft) : post('/canned-replies', draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cannedKey(tenantId) })
      onOpenChange(false)
    },
  })
  const set = (k: keyof Draft) => (v: string) => setDraft((d) => ({ ...d, [k]: v }))
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        title={editing ? 'Edit canned reply' : 'New canned reply'}
        footer={
          <>
            <ModalClose asChild>
              <Button variant="secondary">Cancel</Button>
            </ModalClose>
            <Button type="submit" form="canned-form" loading={save.isPending}>
              {editing ? 'Save' : 'Add reply'}
            </Button>
          </>
        }
      >
        <form
          id="canned-form"
          className="flex flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <FormError error={save.error} />
          <Field
            label="Shortcut"
            hint="Type this in the reply box, for example /hello"
            error={fieldError(save.error, 'shortcut')}
          >
            <Input
              value={draft.shortcut}
              onChange={(e) => set('shortcut')(e.target.value)}
              className="font-mono"
              required
              maxLength={33}
              autoFocus
            />
          </Field>
          <Field label="Title" error={fieldError(save.error, 'title')}>
            <Input
              value={draft.title}
              onChange={(e) => set('title')(e.target.value)}
              required
              maxLength={80}
            />
          </Field>
          <Field label="Message" error={fieldError(save.error, 'body')}>
            <textarea
              value={draft.body}
              onChange={(e) => set('body')(e.target.value)}
              required
              maxLength={4096}
              rows={5}
              className="rounded-md border border-border bg-surface px-3 py-2 text-base text-slate"
            />
          </Field>
        </form>
      </ModalContent>
    </Modal>
  )
}

/** Settings → Workspace → Canned replies (decisions I2/I3). Agents see the list; managers edit. */
export function CannedRepliesCard({ canManage }: { canManage: boolean }) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const replies = useCannedReplies().data ?? []
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<CannedReply | null>(null)
  const remove = useMutation({
    mutationFn: (r: CannedReply) => del(`/canned-replies/${r.id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: cannedKey(tenantId) }),
  })
  const edit = (r: CannedReply | null) => {
    setEditing(r)
    setOpen(true)
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle as="h2">Canned replies</CardTitle>
          <CardDescription>
            Saved answers your team inserts in the inbox by typing their shortcut.
          </CardDescription>
        </div>
        {canManage ? (
          <Button variant="secondary" onClick={() => edit(null)}>
            Add reply
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {replies.length ? (
          <ul className="flex flex-col divide-y divide-border" aria-label="Canned replies">
            {replies.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm text-slate">{r.shortcut}</span>
                    <span className="font-medium text-slate">{r.title}</span>
                  </span>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted">{r.body}</p>
                </div>
                {canManage ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => edit(r)}>
                      Edit<span className="sr-only"> {r.shortcut}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Delete ${r.shortcut}?`,
                            description: 'Your team will no longer be able to insert it.',
                            confirmLabel: 'Delete',
                            destructive: true,
                          })
                        )
                          remove.mutate(r)
                      }}
                    >
                      Delete<span className="sr-only"> {r.shortcut}</span>
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            className="py-6"
            title="No canned replies yet"
            description={
              canManage
                ? 'Save answers you send often, then type / in the reply box to insert them.'
                : 'Your team’s saved answers appear here.'
            }
          />
        )}
      </CardContent>
      <ReplyModal editing={editing} open={open} onOpenChange={setOpen} />
    </Card>
  )
}
