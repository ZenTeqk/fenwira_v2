'use client'

import { type MessageTemplateSnapshot, type TemplateSnapshotButton } from '@fenwira/contracts'
import { Button, cn } from '@fenwira/ui'
import { Copy, ExternalLink, FileText, Phone, Play, Reply } from 'lucide-react'
import Image from 'next/image'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { useFileUrl } from './media'

const BUTTON_ICON: Record<TemplateSnapshotButton['type'], typeof Reply> = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  COPY_CODE: Copy,
}
const buttonDetail = (b: TemplateSnapshotButton) =>
  b.type === 'URL'
    ? b.url
    : b.type === 'PHONE_NUMBER'
      ? b.phoneE164
      : b.type === 'COPY_CODE'
        ? b.code
        : undefined

function TemplateHeader({
  header,
  preview,
  renderText,
}: {
  header: NonNullable<MessageTemplateSnapshot['header']>
  preview?: boolean
  renderText: (text: string) => ReactNode
}) {
  const url = useFileUrl(preview || header.type === 'TEXT' ? null : header.fileId)
  if (header.type === 'TEXT')
    return (
      <p className="whitespace-pre-wrap break-words font-semibold">{renderText(header.text)}</p>
    )
  const label = header.filename ?? `${header.type.toLowerCase()} header`
  if (header.type === 'IMAGE')
    return url.data ? (
      <Image
        src={url.data}
        unoptimized
        width={320}
        height={240}
        alt={label}
        className="h-auto max-w-full rounded-md"
      />
    ) : (
      <div className="flex h-32 items-center justify-center rounded-md bg-neutral-soft text-sm text-secondary">
        {preview ? 'Image header sample' : header.fileId ? 'Image' : 'Image unavailable'}
      </div>
    )
  const Icon = header.type === 'VIDEO' ? Play : FileText
  const chip = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{header.type === 'VIDEO' ? `Video · ${label}` : label}</span>
    </>
  )
  return url.data ? (
    <a
      href={url.data}
      target="_blank"
      rel="noreferrer"
      className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-primary-strong underline"
    >
      {chip}
    </a>
  ) : (
    <span className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-secondary">
      {chip}
    </span>
  )
}

/**
 * A template message as the customer saw it (docs/INBOX.md → Template messages): label, header,
 * body (collapsed after ~8 lines), footer and display-only buttons. `labelId`/`bodyId` name the
 * bubble. Buttons are rows, not controls: nothing in them is focusable in the inbox.
 */
export function TemplateMessage({
  snapshot,
  name,
  labelId,
  bodyId,
  preview = false,
  renderText = (text) => text,
}: {
  snapshot: MessageTemplateSnapshot | null
  name: string
  labelId: string
  bodyId: string
  /** Visual preview uses the complete bubble with inert media and no download requests. */
  preview?: boolean
  renderText?: (text: string) => ReactNode
}) {
  const body = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflows, setOverflows] = useState(false)
  useLayoutEffect(() => {
    const el = body.current
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [snapshot?.body, expanded])

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p id={labelId} className="text-xs text-secondary">
        Template · {snapshot?.name ?? name}
      </p>
      {snapshot?.header ? (
        <TemplateHeader header={snapshot.header} preview={preview} renderText={renderText} />
      ) : null}
      {snapshot?.body ? (
        <div>
          <p
            id={bodyId}
            ref={body}
            className={cn(
              'whitespace-pre-wrap break-words',
              !preview && !expanded && 'line-clamp-8',
            )}
          >
            {renderText(snapshot.body)}
          </p>
          {!preview && (overflows || expanded) ? (
            <Button
              variant="link"
              size="sm"
              aria-expanded={expanded}
              onClick={() => setExpanded((x) => !x)}
            >
              {expanded ? 'Show less' : 'Read more'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* Muted fails AA on the outbound tint, so the footer uses secondary. */}
      {snapshot?.footer ? (
        <p className="text-sm text-secondary">{renderText(snapshot.footer)}</p>
      ) : null}
      {!preview && (!snapshot || snapshot.partial) ? (
        <p className="text-xs text-secondary">Original template no longer available</p>
      ) : null}
      {snapshot?.buttons.length ? (
        <ul aria-label="Template buttons" className="mt-1 flex flex-col gap-1">
          {snapshot.buttons.map((b, i) => {
            const Icon = BUTTON_ICON[b.type]
            return (
              <li
                key={i}
                title={buttonDetail(b)}
                className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-primary-strong"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {b.label}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
