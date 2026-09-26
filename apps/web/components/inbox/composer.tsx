'use client'

import {
  type ComposeLock,
  type Conversation,
  type Message,
  type SendableContent,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  cn,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
  Input,
  toast,
} from '@fenwira/ui'
import { type InfiniteData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageSquareText, Paperclip, Send } from 'lucide-react'
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, del, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { matchCanned, useCannedReplies } from '@/lib/canned-replies'
import { useNow } from '@/lib/inbox'
import { useRealtimeEvent, useSocket } from '@/lib/realtime'
import { Segmented } from './segmented'
import { notesKey, threadKey } from './thread'

type Page = { data: Message[]; page: { nextCursor: string | null } }
const HEARTBEAT_MS = 10_000
const mediaType = (mime: string): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' =>
  mime.startsWith('image/')
    ? 'IMAGE'
    : mime.startsWith('video/')
      ? 'VIDEO'
      : mime.startsWith('audio/')
        ? 'AUDIO'
        : 'DOCUMENT'

/**
 * Reply box (docs/INBOX.md → Collision control): typing takes the conversation's compose lock and
 * renews it every 10 s; others see "X is replying…" and a disabled box. Outside the 24-hour window
 * only a template can be sent (the server enforces the same).
 */
export function Composer({ conversation }: { conversation: Conversation }) {
  const { tenantId, me, can } = useSession()
  const socket = useSocket()
  const queryClient = useQueryClient()
  const now = useNow(15_000)
  const id = conversation.id
  const [mode, setMode] = useState<'reply' | 'note'>('reply')
  const [text, setText] = useState('')
  const [template, setTemplate] = useState({ name: '', language: 'en' })
  const [lock, setLock] = useState<ComposeLock | null>(null)
  const holding = lock?.holder?.id === me.user.id
  const lockedByOther = !!lock?.holder && !holding
  const windowOpen =
    !!conversation.serviceWindow.expiresAt &&
    new Date(conversation.serviceWindow.expiresAt).getTime() > now
  const canForce = conversation.assignee?.id === me.user.id || can('inbox.reassign')
  // Canned replies: "/" at the start of the reply box opens a picker (docs/INBOX.md).
  const canned = useCannedReplies().data ?? []
  const listId = useId()
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const slash = mode === 'reply' && /^\/\S*$/.test(text) && !dismissed
  const matches = slash ? matchCanned(canned, text) : []

  const current = useQuery({
    queryKey: keys.tenant(tenantId, 'inbox', 'lock', id),
    queryFn: () =>
      get<{ data: ComposeLock }>(`/conversations/${id}/compose-lock`).then((r) => r.data),
  })
  useEffect(() => setLock(current.data ?? null), [current.data])
  useRealtimeEvent<ComposeLock>('compose.lock', (l) => {
    if (l.conversationId === id) setLock(l)
  })

  const take = useCallback(
    async (force = false) => {
      try {
        const res = await post<{ data: ComposeLock }>(`/conversations/${id}/compose-lock`, {
          force,
        })
        setLock(res.data)
      } catch (err) {
        if (err instanceof ApiError && err.code === 'COMPOSE_LOCKED') {
          const holder = err.details?.holder as { id: string; name: string } | undefined
          setLock({ conversationId: id, holder: holder ?? null, expiresAt: null })
        } else throw err
      }
    },
    [id],
  )
  const release = useCallback(() => {
    if (holding) void del(`/conversations/${id}/compose-lock`).catch(() => undefined)
  }, [holding, id])

  // Renew while there is a draft; release when leaving the conversation.
  useEffect(() => {
    if (!holding || !text.trim()) return
    const t = setInterval(
      () => socket.emit('compose.heartbeat', { conversationId: id }),
      HEARTBEAT_MS,
    )
    return () => clearInterval(t)
  }, [holding, text, socket, id])
  const releaseRef = useRef(release)
  releaseRef.current = release
  useEffect(() => () => releaseRef.current(), [id])

  const onType = (value: string) => {
    setText(value)
    setActive(0)
    if (!value.startsWith('/')) setDismissed(false)
    if (mode === 'reply' && value.trim() && !lock?.holder) void take()
    if (mode === 'reply' && !value.trim() && holding) release()
  }

  const addOptimistic = (content: SendableContent, tempId: string) =>
    queryClient.setQueryData<InfiniteData<Page>>(threadKey(tenantId, id), (old) => {
      if (!old) return old
      const temp: Message = {
        id: tempId,
        conversationId: id,
        contactId: conversation.contact.id,
        direction: 'OUTBOUND',
        type: content.type,
        status: 'CREATED',
        source: 'INBOX',
        content: content as Message['content'],
        providerMessageId: null,
        errorCode: null,
        errorDetail: null,
        sentByUserId: me.user.id,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        providerTimestamp: null,
        createdAt: new Date().toISOString(),
      }
      const [first, ...rest] = old.pages
      return { ...old, pages: [{ ...first!, data: [temp, ...first!.data] }, ...rest] }
    })
  const reconcile = (tempId: string, real: Message | null) =>
    queryClient.setQueryData<InfiniteData<Page>>(threadKey(tenantId, id), (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((p) => ({
              ...p,
              data:
                real && p.data.some((m) => m.id === real.id)
                  ? p.data.filter((m) => m.id !== tempId)
                  : p.data.flatMap((m) => (m.id === tempId ? (real ? [real] : []) : [m])),
            })),
          }
        : old,
    )

  const send = useMutation({
    mutationFn: async (content: SendableContent) => {
      const idempotencyKey = crypto.randomUUID()
      const tempId = `tmp-${idempotencyKey}`
      addOptimistic(content, tempId)
      try {
        const res = await post<{ data: Message }>(
          `/conversations/${id}/messages`,
          { content },
          { headers: { 'Idempotency-Key': idempotencyKey } },
        )
        reconcile(tempId, res.data)
        return res.data
      } catch (err) {
        reconcile(tempId, null)
        throw err
      }
    },
    onSuccess: () => {
      setText('')
      setTemplate({ name: '', language: 'en' })
      void queryClient.invalidateQueries({
        queryKey: keys.tenant(tenantId, 'inbox', 'conversation', id),
      })
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'The message was not sent.'),
  })
  const note = useMutation({
    mutationFn: () => post(`/conversations/${id}/notes`, { body: text }),
    onSuccess: () => {
      setText('')
      void queryClient.invalidateQueries({ queryKey: notesKey(tenantId, id) })
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'The note was not saved.'),
  })
  const attach = useMutation({
    mutationFn: async (file: File) => {
      const up = await post<{
        data: { fileId: string; url: string; headers: Record<string, string> }
      }>('/files/upload-url', {
        purpose: 'MESSAGE_MEDIA',
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
        filename: file.name,
      })
      const put = await fetch(up.data.url, { method: 'PUT', headers: up.data.headers, body: file })
      if (!put.ok) throw new Error('The upload failed.')
      const done = await post<{ data: { status: string } }>(`/files/${up.data.fileId}/complete`)
      if (done.data.status !== 'READY') throw new Error("This file can't be sent on WhatsApp.")
      return send.mutateAsync({
        type: mediaType(file.type),
        fileId: up.data.fileId,
        caption: text.trim() || undefined,
        filename: file.name,
      })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'The upload failed.'),
  })

  const submit = () => {
    if (mode === 'note') return text.trim() && note.mutate()
    if (!windowOpen)
      return (
        template.name &&
        send.mutate({
          type: 'TEMPLATE',
          name: template.name.trim(),
          language: template.language.trim(),
        })
      )
    if (text.trim()) send.mutate({ type: 'TEXT', text: text.trim() })
  }
  /** Inserts a canned reply for editing; it never sends by itself. */
  const insert = (body: string) => {
    onType(body)
    setDismissed(true)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((i) => (i + step + matches.length) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insert(matches[active]!.body)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }
  const disabled = mode === 'reply' && lockedByOther

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-surface p-3">
      <Segmented
        label="Compose"
        value={mode}
        options={[
          { value: 'reply', label: 'Reply' },
          { value: 'note', label: 'Internal note' },
        ]}
        onChange={setMode}
      />
      {mode === 'reply' && lockedByOther ? (
        <Alert
          tone="info"
          title={`${lock!.holder!.name} is replying…`}
          action={
            canForce ? (
              <Button size="sm" variant="secondary" onClick={() => void take(true)}>
                Take over
              </Button>
            ) : null
          }
        >
          You can reply when they finish.
        </Alert>
      ) : null}
      {mode === 'reply' && !windowOpen ? (
        <div className="flex flex-col gap-2">
          <Alert tone="warning">
            The 24-hour window has closed. Send an approved template to restart the conversation.
          </Alert>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm text-slate">
              Template name
              <Input
                value={template.name}
                onChange={(e) => setTemplate((t) => ({ ...t, name: e.target.value }))}
                placeholder="hello_world"
                disabled={disabled}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-slate">
              Language
              <Input
                className="w-24"
                value={template.language}
                onChange={(e) => setTemplate((t) => ({ ...t, language: e.target.value }))}
                disabled={disabled}
              />
            </label>
            <Button loading={send.isPending} disabled={disabled || !template.name} onClick={submit}>
              Send template
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative flex items-end gap-2">
          {matches.length ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Canned replies"
              className="absolute bottom-full left-0 z-10 mb-2 flex max-h-64 w-full max-w-md flex-col overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-md"
            >
              {matches.map((r, i) => (
                <li
                  key={r.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={cn(
                    'flex cursor-pointer flex-col px-3 py-2 text-left',
                    i === active ? 'bg-primary-soft' : 'hover:bg-neutral-soft',
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insert(r.body)
                  }}
                >
                  <span className="flex gap-2 text-sm">
                    <span className="font-mono text-slate">{r.shortcut}</span>
                    <span className="font-medium text-slate">{r.title}</span>
                  </span>
                  <span className="truncate text-sm text-slate">{r.body}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            aria-label={mode === 'note' ? 'Internal note' : 'Reply'}
            aria-autocomplete={mode === 'reply' ? 'list' : undefined}
            aria-controls={matches.length ? listId : undefined}
            aria-activedescendant={matches.length ? `${listId}-${active}` : undefined}
            placeholder={
              mode === 'note'
                ? 'Only your team sees notes'
                : canned.length
                  ? 'Type a reply, or / for canned replies (Enter to send)'
                  : 'Type a reply… (Enter to send)'
            }
            className={cn(
              'min-h-11 flex-1 resize-none rounded-md border border-border px-3 py-2 text-base text-slate',
              mode === 'note' ? 'bg-warning-soft' : 'bg-surface',
              disabled && 'cursor-not-allowed opacity-60',
            )}
            rows={2}
            value={text}
            disabled={disabled}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => !text.trim() && release()}
          />
          {mode === 'reply' && canned.length ? (
            <Dropdown>
              <DropdownTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Canned replies" disabled={disabled}>
                  <MessageSquareText aria-hidden="true" />
                </Button>
              </DropdownTrigger>
              <DropdownContent className="max-h-72 w-72 overflow-y-auto">
                {canned.map((r) => (
                  <DropdownItem key={r.id} onSelect={() => insert(r.body)}>
                    <span className="font-mono text-sm">{r.shortcut}</span> {r.title}
                  </DropdownItem>
                ))}
              </DropdownContent>
            </Dropdown>
          ) : null}
          {mode === 'reply' ? (
            <label
              className={cn(
                'inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-slate hover:bg-neutral-soft',
                disabled && 'pointer-events-none opacity-60',
              )}
            >
              <Paperclip aria-hidden="true" className="size-4" />
              <span className="sr-only">Attach a file</span>
              <input
                type="file"
                className="sr-only"
                disabled={disabled || attach.isPending}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const f = e.target.files?.[0]
                  if (f) attach.mutate(f)
                  e.target.value = ''
                }}
              />
            </label>
          ) : null}
          <Button
            aria-label={mode === 'note' ? 'Save note' : 'Send'}
            loading={send.isPending || note.isPending || attach.isPending}
            disabled={disabled || !text.trim()}
            onClick={submit}
          >
            <Send aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )
}
