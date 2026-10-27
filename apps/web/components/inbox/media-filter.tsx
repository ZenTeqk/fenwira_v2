'use client'

import {
  MEDIA_FILTER_KIND,
  type MediaCounts,
  mediaKindOf,
  type Message,
  type ThreadMediaFilter,
} from '@fenwira/contracts'
import { Button, cn, ErrorState, focusRing, Skeleton } from '@fenwira/ui'
import { useInfiniteQuery } from '@tanstack/react-query'
import { FileText, Image as ImageIcon, Play, Video } from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { fileSize, fileType, MediaLightbox, useFileUrl, type ViewerItem } from './media'

type Page = { data: Message[]; page: { nextCursor: string | null } }

export const mediaKey = (tenantId: string, id: string, filter: ThreadMediaFilter) =>
  keys.tenant(tenantId, 'inbox', 'thread', id, 'media', filter)
export const mediaCountsKey = (tenantId: string, id: string) =>
  keys.tenant(tenantId, 'inbox', 'media-counts', id)

const CHIPS: Array<{ value: ThreadMediaFilter | null; label: string; count: keyof MediaCounts }> = [
  { value: null, label: 'All', count: 'all' },
  { value: 'image', label: 'Images', count: 'image' },
  { value: 'video', label: 'Videos', count: 'video' },
  { value: 'document', label: 'Documents', count: 'document' },
]
const NOUN: Record<ThreadMediaFilter, string> = {
  image: 'images',
  video: 'videos',
  document: 'documents',
}
const EMPTY_ICON = { image: ImageIcon, video: Video, document: FileText }

/** All / Images / Videos / Documents (docs/INBOX.md → Media filter). Toggle buttons. */
export function MediaFilterChips({
  value,
  counts,
  onChange,
}: {
  value: ThreadMediaFilter | null
  counts: MediaCounts | undefined
  onChange: (value: ThreadMediaFilter | null) => void
}) {
  return (
    <div
      role="group"
      aria-label="Show messages"
      className="flex shrink-0 gap-2 overflow-x-auto border-b border-border bg-surface px-4 py-2"
    >
      {CHIPS.map((chip) => {
        const active = chip.value === value
        const count = counts?.[chip.count]
        return (
          <button
            key={chip.label}
            type="button"
            aria-pressed={active}
            // Clicking the active chip goes back to All.
            onClick={() => onChange(active ? null : chip.value)}
            className={cn(
              'group flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
              focusRing,
              active
                ? 'border-primary-strong bg-primary-soft text-primary-strong'
                : 'border-border-strong bg-surface text-secondary hover:bg-neutral-soft',
            )}
          >
            {chip.label}
            {count !== undefined ? ' ' : null}
            {count !== undefined ? (
              // Muted fails AA on neutral-soft, so the count darkens with the hover background.
              <span className={cn('text-muted', !active && 'group-hover:text-secondary')}>
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
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
        'relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-border bg-surface',
        focusRing,
      )}
    >
      {kind === 'IMAGE' && url.data ? (
        <Image src={url.data} unoptimized fill sizes="160px" alt="" className="object-cover" />
      ) : kind === 'IMAGE' ? (
        <ImageIcon aria-hidden="true" className="size-6 text-secondary" />
      ) : (
        <Play aria-hidden="true" className="size-8 text-secondary" />
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
}: {
  conversationId: string
  filter: ThreadMediaFilter
  /** Messages already in the thread: filtered client-side while the server page loads. */
  loaded: Message[]
  onJump: (messageId: string) => void
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
    return <ErrorState title="Media couldn’t be loaded" onRetry={() => void query.refetch()} />
  if (query.isPending)
    return (
      <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-square w-full" />
        ))}
      </div>
    )
  if (!items.length) {
    const Icon = EMPTY_ICON[filter]
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-lg bg-neutral-soft">
          <Icon aria-hidden="true" className="size-6 text-secondary" />
        </span>
        <p className="text-sm text-muted">No {NOUN[filter]} in this conversation</p>
      </div>
    )
  }
  const jump = (m: Message) => (
    <Button variant="link" size="sm" onClick={() => onJump(m.id)}>
      Jump to message
    </Button>
  )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {kind === 'DOCUMENT' ? (
        <ul aria-label="Documents" className="flex flex-col gap-2">
          {items.map((m) => (
            <DocumentRow key={m.id} m={m} action={jump(m)} />
          ))}
        </ul>
      ) : (
        <ul
          aria-label={kind === 'IMAGE' ? 'Images' : 'Videos'}
          className="grid grid-cols-3 gap-3 sm:grid-cols-4"
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

function DocumentRow({ m, action }: { m: Message; action: ReactNode }) {
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
    <li className="flex items-center gap-3 rounded-md border border-border bg-surface px-3 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-neutral-soft">
        <FileText aria-hidden="true" className="size-5 text-secondary" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        {url.data ? (
          <a
            href={url.data}
            target="_blank"
            rel="noreferrer"
            className={cn('truncate font-medium text-primary-strong underline', focusRing)}
          >
            {name}
          </a>
        ) : (
          <span className="truncate font-medium text-slate">{name}</span>
        )}
        <span className="text-xs text-muted">{meta}</span>
      </div>
      {action}
    </li>
  )
}
