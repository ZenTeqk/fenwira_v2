'use client'

import {
  MEDIA_FILTER_KIND,
  type MediaCounts,
  mediaKindOf,
  type Message,
  type ThreadMediaFilter,
  type ThreadTypeFilter,
} from '@fenwira/contracts'
import { Button, cn, ErrorState, focusRing, Skeleton, textLink } from '@fenwira/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Play,
  Video,
} from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { fileSize, fileType, MediaLightbox, useFileUrl, type ViewerItem } from './media'

type Page = { data: Message[]; page: { nextCursor: string | null } }

export const mediaKey = (tenantId: string, id: string, filter: ThreadMediaFilter) =>
  keys.tenant(tenantId, 'inbox', 'thread', id, 'media', filter)
export const mediaCountsKey = (tenantId: string, id: string) =>
  keys.tenant(tenantId, 'inbox', 'media-counts', id)

const NOUN: Record<ThreadMediaFilter, string> = {
  image: 'images',
  video: 'videos',
  document: 'documents',
}
const EMPTY_ICON = { image: ImageIcon, video: Video, document: FileText }

/** What the chips above the timeline can show (docs/INBOX.md → Thread filters). */
export type ThreadFilter = ThreadMediaFilter | ThreadTypeFilter | 'notes'
type ChipCounts = MediaCounts & { notes: number }
const CHIPS: Array<{ value: ThreadFilter | null; label: string; count: keyof ChipCounts }> = [
  { value: null, label: 'All', count: 'all' },
  { value: 'image', label: 'Images', count: 'image' },
  { value: 'video', label: 'Video', count: 'video' },
  { value: 'document', label: 'Documents', count: 'document' },
  { value: 'audio', label: 'Audio', count: 'audio' },
  { value: 'template', label: 'Templates', count: 'template' },
  { value: 'notes', label: 'Notes', count: 'notes' },
]

/** All / Images / Video / Documents / Audio / Templates / Notes: toggle buttons with counts. */
export function ThreadFilterChips({
  value,
  counts,
  onChange,
}: {
  value: ThreadFilter | null
  counts: ChipCounts | undefined
  onChange: (value: ThreadFilter | null) => void
}) {
  const row = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const viewportId = useId()
  const [scroll, setScroll] = useState({ overflow: false, left: false, right: false })
  useLayoutEffect(() => {
    const root = row.current
    const el = viewport.current
    const items = content.current
    if (!root || !el || !items) return
    const update = () => {
      // Measure against the entire row, so adding the arrows cannot keep them visible
      // unnecessarily after the conversation grows or counts become shorter.
      const style = getComputedStyle(root)
      const available =
        root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const overflow = items.scrollWidth > available + 1
      const next = {
        overflow,
        left: overflow && el.scrollLeft > 1,
        right: overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      }
      setScroll((previous) =>
        previous.overflow === next.overflow &&
        previous.left === next.left &&
        previous.right === next.right
          ? previous
          : next,
      )
    }
    update()
    const resize = new ResizeObserver(update)
    resize.observe(root)
    resize.observe(el)
    resize.observe(items)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      resize.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [])
  const move = (direction: number) => {
    const el = viewport.current
    if (!el) return
    el.scrollBy({
      left: direction * el.clientWidth * 0.8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }
  return (
    <div
      ref={row}
      role="group"
      aria-label="Show messages"
      className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-3 py-0.5"
    >
      {scroll.overflow ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-fg-secondary sm:size-6"
          aria-label="Scroll message filters left"
          title="Scroll message filters left"
          aria-controls={viewportId}
          disabled={!scroll.left}
          onClick={() => move(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
      ) : null}
      <div
        ref={viewport}
        id={viewportId}
        data-slot="message-filter-scroll"
        className="fw-inbox-filter-scroll min-w-0 flex-1 snap-x snap-proximity overflow-x-auto"
        onFocusCapture={(event) => {
          if (event.target instanceof HTMLButtonElement)
            event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }}
      >
        <div ref={content} className="flex w-max items-center gap-1 p-1">
          {CHIPS.map((chip) => {
            const active = chip.value === value
            const count = counts?.[chip.count]
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(active ? null : chip.value)}
                className={cn(
                  'group flex h-8 shrink-0 snap-start scroll-mx-1 items-center gap-1 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap transition-colors sm:h-6',
                  focusRing,
                  active
                    ? 'border-fg bg-surface-selected text-fg'
                    : 'border-border-control bg-surface text-fg-secondary hover:bg-surface-hover hover:text-fg',
                )}
              >
                {chip.label}
                {count !== undefined ? ' ' : null}
                {count !== undefined ? (
                  <span className={cn('tabular-nums', active ? 'text-fg' : 'text-fg-muted')}>
                    {count}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
      {scroll.overflow ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-fg-secondary sm:size-6"
          aria-label="Scroll message filters right"
          title="Scroll message filters right"
          aria-controls={viewportId}
          disabled={!scroll.right}
          onClick={() => move(1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}

const fileIdOf = (m: Message): string | undefined => {
  if (m.media?.fileId) return m.media.fileId
  if ('fileId' in m.content && m.content.fileId) return m.content.fileId
  const header = m.templateSnapshot?.header
  return header && header.type !== 'TEXT' ? (header.fileId ?? undefined) : undefined
}
const nameOf = (m: Message): string | null => {
  const header = m.templateSnapshot?.header
  return (
    m.media?.filename ??
    ('filename' in m.content ? (m.content.filename ?? null) : null) ??
    (header && header.type !== 'TEXT' ? header.filename : null)
  )
}
const mimeOf = (m: Message): string | null =>
  m.media?.mimeType ?? ('mimeType' in m.content ? (m.content.mimeType ?? null) : null)
const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function Thumb({ m, kind, onOpen }: { m: Message; kind: 'IMAGE' | 'VIDEO'; onOpen: () => void }) {
  const fileId = fileIdOf(m)
  const url = useFileUrl(kind === 'IMAGE' ? fileId : null)
  const label = nameOf(m) ?? (kind === 'IMAGE' ? 'Image' : 'Video')
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!fileId}
      aria-label={`Open ${kind === 'IMAGE' ? 'image' : 'video'} ${label} from ${dateOf(m.createdAt)}`}
      className={cn(
        'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-surface',
        focusRing,
      )}
    >
      {kind === 'IMAGE' && url.data ? (
        <Image src={url.data} unoptimized fill sizes="160px" alt="" className="object-cover" />
      ) : kind === 'IMAGE' ? (
        <ImageIcon aria-hidden="true" className="size-6 text-fg-secondary" />
      ) : (
        <Play aria-hidden="true" className="size-8 text-fg-secondary" />
      )}
    </button>
  )
}

/** The filtered view: a thumbnail grid (images, videos) or a document list. */
export function MediaResults({
  conversationId,
  filter,
  loaded,
  onJump,
  compact = false,
}: {
  conversationId: string
  filter: ThreadMediaFilter
  /** Messages already in the thread: filtered client-side while the server page loads. */
  loaded: Message[]
  onJump: (messageId: string) => void
  /** Customer-panel presentation only; the centre panel retains its existing layout. */
  compact?: boolean
}) {
  const { tenantId } = useSession()
  const kind = MEDIA_FILTER_KIND[filter]
  const [viewer, setViewer] = useState<ViewerItem | null>(null)
  const query = useInfiniteQuery({
    queryKey: mediaKey(tenantId, conversationId, filter),
    queryFn: ({ pageParam }) =>
      get<Page>(
        `/conversations/${conversationId}/messages?type=${filter}&limit=50${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
    placeholderData: () => {
      const local = loaded.filter((m) => mediaKindOf(m) === kind)
      return local.length
        ? { pages: [{ data: local, page: { nextCursor: null } }], pageParams: [''] }
        : undefined
    },
  })
  const items = (query.data?.pages ?? []).flatMap((p) => p.data)

  if (query.isError)
    return (
      <ErrorState
        title="Media couldn’t be loaded"
        onRetry={() => void query.refetch()}
        className={
          compact
            ? 'items-start gap-2 p-4 text-left [&>div:first-child]:hidden [&_p]:text-xs'
            : undefined
        }
      />
    )
  if (query.isPending)
    return (
      <div
        className={cn(
          'grid gap-2 p-4',
          compact
            ? kind === 'DOCUMENT'
              ? 'grid-cols-1'
              : 'grid-cols-2'
            : 'grid-cols-3 sm:grid-cols-4',
        )}
      >
        {Array.from({ length: compact ? (kind === 'DOCUMENT' ? 3 : 4) : 8 }, (_, i) => (
          <Skeleton
            key={i}
            className={compact && kind === 'DOCUMENT' ? 'h-14 w-full' : 'aspect-square w-full'}
          />
        ))}
      </div>
    )
  if (!items.length) {
    const Icon = EMPTY_ICON[filter]
    return (
      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center text-center',
          compact ? 'gap-2 p-4' : 'gap-3 p-8',
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-surface-muted">
          <Icon aria-hidden="true" className="size-6 text-fg-secondary" />
        </span>
        <p className="text-sm text-fg-muted">No {NOUN[filter]} in this conversation</p>
      </div>
    )
  }
  const jump = (m: Message) => (
    <Button
      variant="link"
      size="sm"
      className={compact ? 'size-7 shrink-0 p-0' : undefined}
      aria-label={compact ? 'Jump to message' : undefined}
      title={compact ? `Jump to message: ${nameOf(m) ?? 'Attachment'}` : undefined}
      onClick={() => onJump(m.id)}
    >
      {compact ? <ArrowUpRight aria-hidden="true" /> : 'Jump to message'}
    </Button>
  )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {kind === 'DOCUMENT' ? (
        <ul aria-label="Documents" className="flex flex-col gap-2">
          {items.map((m) => (
            <DocumentRow key={m.id} m={m} action={jump(m)} compact={compact} />
          ))}
        </ul>
      ) : (
        <ul
          aria-label={kind === 'IMAGE' ? 'Images' : 'Videos'}
          className={cn('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-3 sm:grid-cols-4')}
        >
          {items.map((m) => (
            <li key={m.id} className="flex flex-col items-start gap-1">
              <Thumb
                m={m}
                kind={kind}
                onOpen={() => {
                  const fileId = fileIdOf(m)
                  if (fileId)
                    setViewer({
                      fileId,
                      kind,
                      label: nameOf(m) ?? (kind === 'IMAGE' ? 'Image' : 'Video'),
                    })
                }}
              />
              {jump(m)}
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <div className="flex justify-center pt-3">
          <Button
            size="sm"
            variant="ghost"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
      <MediaLightbox item={viewer} onClose={() => setViewer(null)} />
    </div>
  )
}

function DocumentRow({
  m,
  action,
  compact = false,
}: {
  m: Message
  action: ReactNode
  compact?: boolean
}) {
  const fileId = fileIdOf(m)
  const url = useFileUrl(fileId)
  const name = nameOf(m) ?? 'Document'
  const meta = [
    fileType(nameOf(m), mimeOf(m)),
    m.media ? fileSize(m.media.sizeBytes) : null,
    dateOf(m.createdAt),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li
      className={cn(
        'flex min-w-0 items-center rounded-md border border-border-subtle bg-surface py-2',
        compact ? 'gap-2 px-2' : 'gap-3 px-3',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-muted">
        <FileText aria-hidden="true" className="size-5 text-fg-secondary" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        {url.data ? (
          <a
            href={url.data}
            target="_blank"
            rel="noreferrer"
            title={name}
            className={cn(
              compact ? 'line-clamp-2 break-words text-base' : 'truncate',
              'font-medium',
              textLink,
              focusRing,
            )}
          >
            {name}
          </a>
        ) : (
          <span
            title={name}
            className={cn(
              compact ? 'line-clamp-2 break-words text-base' : 'truncate',
              'font-medium text-fg',
            )}
          >
            {name}
          </span>
        )}
        <span className={cn('text-xs text-fg-muted', compact && 'break-words')}>{meta}</span>
      </div>
      {action}
    </li>
  )
}
