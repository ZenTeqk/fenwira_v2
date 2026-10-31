'use client'

import {
  type ComposeLock,
  type Conversation,
  type Message,
  type SendableContent,
} from '@fenwira/contracts'
import { Alert, Button, cn, focusRing, toast, Textarea, Tooltip } from '@fenwira/ui'
import { type InfiniteData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, FileText, Lock, MessageSquareText, Paperclip, Send } from 'lucide-react'
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useSession } from '@/components/session/session-provider'
import { useConnections } from '@/lib/workspace-status'
import { ApiError, del, get, post } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { matchCanned, useCannedReplies } from '@/lib/canned-replies'
import { composerState } from '@/lib/composer-state'
import { draftScope, type DraftMode, drafts } from '@/lib/drafts'
import { useRealtimeEvent, useSocket } from '@/lib/realtime'
import { TemplatePicker, type TemplateSend } from './template-picker'
import { notesKey, threadKey } from './thread'
import { useReplyWindow } from './use-reply-window'
import { ReplyWindowIndicator } from './reply-window-indicator'

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
  const id = conversation.id
  const replyWindow = useReplyWindow(conversation)
  const { eligibility } = replyWindow
  const connections = useConnections()
  const connection = connections.data?.find((c) => c.id === conversation.phoneNumber.id)
  const state = composerState({
    windowOpen: replyWindow.window.kind === 'open',
    eligibility:
      replyWindow.window.kind === 'checking' || eligibility.isError ? undefined : eligibility.data,
    numberStatus: connection?.status,
    canSendTemplates: can('templates.read'),
  })
  const templatesAvailable =
    can('templates.read') &&
    !eligibility.isError &&
    !!eligibility.data &&
    (eligibility.data.utilityTemplate.allowed || eligibility.data.marketingTemplate.allowed)
  const [mode, setMode] = useState<DraftMode>('reply')
  const panelId = useId()
  // Drafts per conversation and mode survive switching conversations and reloads (lib/drafts).
  const scope = draftScope(me.user.id, tenantId)
  const [texts, setTexts] = useState(() => ({
    reply: drafts.get(scope, id, 'reply'),
    note: drafts.get(scope, id, 'note'),
  }))
  const text = texts[mode]
  const setDraft = (which: DraftMode, value: string) => {
    setTexts((t) => ({ ...t, [which]: value }))
    drafts.set(scope, id, which, value)
  }
  const setText = (value: string) => setDraft(mode, value)
  const writing = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // Presentation only: resize after typing, canned insertion, mode change and send/clear.
  // CSS supplies the 44px resting / 160px maximum; no messaging state changes here.
  useLayoutEffect(() => {
    const element = writing.current
    if (!element) return
    const resize = () => {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight}px`
    }
    resize()
    // Observe available width, not the textarea's height (which this callback changes).
    if (element.parentElement) {
      let width = element.parentElement.clientWidth
      const widthObserver = new ResizeObserver(([entry]) => {
        if (entry && entry.contentRect.width !== width) {
          width = entry.contentRect.width
          resize()
        }
      })
      widthObserver.observe(element.parentElement)
      return () => widthObserver.disconnect()
    }
  }, [text, mode, state.kind])
  const [picking, setPicking] = useState(false)
  const [lock, setLock] = useState<ComposeLock | null>(null)
  const holding = lock?.holder?.id === me.user.id
  const lockedByOther = !!lock?.holder && !holding
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
        aiGenerated: false,
        content: content as Message['content'],
        templateSnapshot: null,
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
    mutationFn: async ({
      content,
      display,
    }: {
      content: SendableContent
      display?: SendableContent
    }) => {
      const idempotencyKey = crypto.randomUUID()
      const tempId = `tmp-${idempotencyKey}`
      addOptimistic(display ?? content, tempId)
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
    onSuccess: (_message, { content }) => {
      // A template doesn't use the typed text, so the reply draft stays.
      if (content.type !== 'TEMPLATE') setDraft('reply', '')
      setPicking(false)
      void queryClient.invalidateQueries({
        queryKey: keys.tenant(tenantId, 'inbox', 'conversation', id),
      })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'CONVERSATION_WINDOW_CLOSED') {
        replyWindow.rejectExpiry()
        toast.error(
          'Reply window closed. Your draft is saved; choose an approved template to continue.',
        )
      } else {
        if (
          err instanceof ApiError &&
          (err.code === 'CONTACT_BLOCKED' || err.code === 'CONSENT_REQUIRED')
        )
          replyWindow.recheck()
        toast.error(err instanceof ApiError ? err.message : 'The message was not sent.')
      }
    },
  })
  const note = useMutation({
    mutationFn: () => post(`/conversations/${id}/notes`, { body: text }),
    onSuccess: () => {
      setDraft('note', '')
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
        content: {
          type: mediaType(file.type),
          fileId: up.data.fileId,
          caption: text.trim() || undefined,
          filename: file.name,
        },
      })
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'The upload failed.'),
  })

  const busy = send.isPending || note.isPending || attach.isPending
  const submit = () => {
    if (busy || (mode === 'reply' && lockedByOther)) return
    if (mode === 'note') return text.trim() && note.mutate()
    if (state.kind === 'reply-restricted' || state.kind === 'blocked' || state.kind === 'checking')
      return
    if (state.kind === 'template-only') return setPicking(true)
    if (text.trim()) send.mutate({ content: { type: 'TEXT', text: text.trim() } })
  }
  /** Inserts a canned reply for editing; it never sends by itself. */
  const insert = (body: string) => {
    if (busy) return
    onType(body)
    setDismissed(true)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter accepts an IME candidate while composing; it must never send the draft.
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
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
  const freeformRestricted = mode === 'reply' && state.kind === 'reply-restricted'
  const replyUnavailable = mode === 'reply' && state.kind !== 'reply'
  const actionHint =
    mode === 'note'
      ? 'Enter to add note · Shift+Enter for a new line'
      : 'Enter to send · Shift+Enter for a new line'
  const previousWindow = useRef(replyWindow.window.kind)
  const [windowAnnouncement, setWindowAnnouncement] = useState('')
  useEffect(() => {
    if (
      mode === 'reply' &&
      previousWindow.current === 'open' &&
      replyWindow.window.kind === 'closed'
    )
      setWindowAnnouncement(
        'Reply window closed. Choose an approved template to message this customer.',
      )
    else if (mode === 'note' || replyWindow.window.kind === 'open') setWindowAnnouncement('')
    previousWindow.current = replyWindow.window.kind
  }, [mode, replyWindow.window.kind])

  return (
    <div
      className={cn(
        'fw-inbox-composer relative z-10 mx-3 mb-3 flex min-w-0 shrink-0 flex-col rounded-lg border px-2 pt-2 md:mx-4',
        mode === 'note'
          ? 'border-chat-note-border bg-chat-note'
          : 'border-border-subtle bg-surface',
      )}
    >
      <span role="status" aria-live="polite" className="sr-only">
        {windowAnnouncement}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <div
          role="tablist"
          aria-label="Compose"
          className="flex shrink-0 gap-1"
          onKeyDown={(e) => {
            // ARIA tabs: arrow keys move between Reply and Internal note.
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
            e.preventDefault()
            const next = mode === 'reply' ? 'note' : 'reply'
            setMode(next)
            document.getElementById(`${panelId}-${next}`)?.focus()
          }}
        >
          {(
            [
              { value: 'reply', label: 'Reply', icon: MessageSquareText },
              { value: 'note', label: 'Internal note', icon: Lock },
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              id={`${panelId}-${value}`}
              type="button"
              role="tab"
              disabled={busy}
              aria-selected={mode === value}
              aria-controls={panelId}
              tabIndex={mode === value ? 0 : -1}
              onClick={() => setMode(value)}
              className={cn(
                'inline-flex h-8 items-center gap-1 border-b-2 px-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:h-7',
                focusRing,
                mode === value
                  ? value === 'note'
                    ? 'border-chat-note-fg text-chat-note-fg'
                    : 'border-action-primary text-fg'
                  : 'border-transparent text-fg-secondary hover:bg-surface-hover hover:text-fg',
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </button>
          ))}
        </div>
        {mode === 'reply' && (state.kind === 'reply' || state.kind === 'checking') ? (
          <ReplyWindowIndicator window={replyWindow.window} checking={state.kind === 'checking'} />
        ) : null}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-label={mode === 'note' ? 'Internal note composer' : 'Reply composer'}
        className="flex min-w-0 flex-col gap-1 pt-1"
      >
        {mode === 'reply' && state.kind === 'checking' && eligibility.isError ? (
          <p className="flex flex-wrap items-center gap-1 text-xs text-fg-secondary">
            Eligibility couldn’t be checked.
            <Button
              size="sm"
              variant="link"
              className="h-7 px-1 text-xs"
              onClick={replyWindow.recheck}
            >
              Try again
            </Button>
          </p>
        ) : null}
        {mode === 'reply' && state.kind === 'blocked' ? (
          <ComposerStrip title={state.title} message={state.message} />
        ) : null}
        {freeformRestricted ? (
          <Alert tone="warning" title="Free-form replies are unavailable">
            {state.kind === 'reply-restricted' ? state.reason : null}
          </Alert>
        ) : null}
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
        {mode === 'reply' &&
        state.kind === 'reply' &&
        replyWindow.window.kind === 'open' &&
        replyWindow.window.phase === 'imminent' ? (
          <p className="text-xs text-status-warning-fg">
            Reply window closes soon. Templates remain available afterward.
          </p>
        ) : null}
        {mode === 'reply' && state.kind === 'blocked' ? null : mode === 'reply' &&
          state.kind === 'template-only' ? (
          <ComposerStrip
            title="Reply window closed"
            message="Choose an approved template to message this customer."
            live={false}
            action={
              <Button
                size="sm"
                className="h-8"
                disabled={disabled || !templatesAvailable || busy}
                onClick={() => setPicking(true)}
              >
                Choose template
              </Button>
            }
          />
        ) : (
          <div className="relative flex min-w-0 flex-col gap-1">
            {matches.length ? (
              <ul
                id={listId}
                role="listbox"
                aria-label="Canned replies"
                className="absolute bottom-full left-0 z-10 mb-2 flex max-h-64 w-full max-w-md flex-col overflow-y-auto rounded-md border border-border-subtle bg-surface py-1 shadow-overlay"
              >
                {matches.map((r, i) => (
                  <li
                    key={r.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={cn(
                      'flex cursor-pointer flex-col px-3 py-2 text-left',
                      i === active ? 'bg-surface-selected' : 'hover:bg-surface-hover',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insert(r.body)
                    }}
                  >
                    <span className="flex gap-2 text-sm">
                      <span className="font-mono text-fg">{r.shortcut}</span>
                      <span className="font-medium text-fg">{r.title}</span>
                    </span>
                    <span className="truncate text-sm text-fg">{r.body}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div
              data-slot="composer-field"
              className={cn(
                'relative flex min-w-0 flex-1 flex-col',
                mode === 'note' ? 'bg-chat-note' : 'bg-surface',
              )}
            >
              <Textarea
                ref={writing}
                aria-label={mode === 'note' ? 'Internal note' : 'Reply'}
                aria-autocomplete={mode === 'reply' ? 'list' : undefined}
                aria-controls={matches.length ? listId : undefined}
                aria-activedescendant={matches.length ? `${listId}-${active}` : undefined}
                placeholder={mode === 'note' ? 'Only your team sees notes' : 'Type a reply…'}
                title="Enter to send; Shift+Enter for a new line; / for canned replies"
                className={cn(
                  'min-h-11 max-h-40 w-full min-w-0 resize-none overflow-y-auto rounded-md border-0 bg-transparent px-2 py-2 text-base text-fg',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus-ring',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
                rows={1}
                value={text}
                disabled={disabled || busy}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={onKeyDown}
                onBlur={() => !text.trim() && release()}
              />
              <div
                role="group"
                aria-label="Message actions"
                className="flex w-full flex-wrap items-center justify-end gap-1"
              >
                {mode === 'reply' ? (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      aria-label="File attachment"
                      className="hidden"
                      disabled={disabled || busy || replyUnavailable}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const f = e.target.files?.[0]
                        if (f) attach.mutate(f)
                        e.target.value = ''
                      }}
                    />
                    <Tooltip content="Attach a file">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 text-fg-secondary sm:size-8"
                        aria-label="Attach a file"
                        disabled={disabled || busy || replyUnavailable}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Paperclip aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  </>
                ) : null}
                {mode === 'reply' && can('templates.read') ? (
                  <Tooltip content="Send a template">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 text-fg-secondary sm:size-8"
                      aria-label="Send a template"
                      disabled={disabled || busy || !templatesAvailable}
                      onClick={() => setPicking(true)}
                    >
                      <FileText aria-hidden="true" />
                    </Button>
                  </Tooltip>
                ) : null}
                <Tooltip content={actionHint} disableHoverableContent>
                  <span className="inline-flex">
                    <Button
                      className={cn(
                        'h-9 px-2.5 sm:h-8',
                        mode === 'note' && 'bg-chat-note-fg hover:bg-chat-note-fg',
                      )}
                      aria-label={mode === 'note' ? 'Add note' : 'Send'}
                      title={actionHint}
                      loading={busy}
                      disabled={disabled || replyUnavailable || !text.trim()}
                      onClick={submit}
                    >
                      {mode === 'note' ? <Lock aria-hidden="true" /> : <Send aria-hidden="true" />}
                      {mode === 'note' ? 'Add note' : 'Send'}
                    </Button>
                  </span>
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </div>
      <TemplatePicker
        phoneNumberId={conversation.phoneNumber.id}
        open={picking}
        onOpenChange={setPicking}
        sending={send.isPending}
        onSend={(t: TemplateSend) => {
          if (templatesAvailable) send.mutate(t)
          else
            toast.error(
              'Template messages are unavailable. Review messaging eligibility in the customer details.',
            )
        }}
      />
    </div>
  )
}

/**
 * Compact eligibility notice; `action` only when that action can succeed.
 */
function ComposerStrip({
  title,
  message,
  action,
  live = true,
}: {
  title: string
  message: string
  action?: ReactNode
  live?: boolean
}) {
  return (
    <div
      role="status"
      aria-live={live ? 'polite' : 'off'}
      className="fw-inbox-composer-notice flex flex-col items-start gap-2 rounded-md border border-chat-note-border bg-chat-note p-3"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-chat-note-fg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-base font-semibold text-chat-note-fg">{title}</p>
          <p className="text-sm text-fg">{message}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
