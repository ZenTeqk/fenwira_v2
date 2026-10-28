'use client'

import { ArrowLeft, Camera, Mic, MoreVertical, Paperclip, Phone, Smile, Video } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/** Fixed conversation chrome. Only the message region scrolls; edits preserve its position. */
export function PhoneFrame({
  children,
  contactName = 'Your business',
  messageCount = 1,
  className,
}: {
  children: ReactNode
  contactName?: string
  messageCount?: number
  className?: string
}) {
  const chat = useRef<HTMLDivElement>(null)
  const previousCount = useRef(messageCount)
  useEffect(() => {
    if (messageCount > previousCount.current && chat.current) {
      chat.current.scrollTo({
        top: chat.current.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      })
    }
    previousCount.current = messageCount
  }, [messageCount])
  return (
    <section
      aria-label="Message preview"
      className={cn('fw-phone-frame border-whatsapp', className)}
    >
      <div
        data-testid="phone-header"
        className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-3 text-slate"
      >
        <ArrowLeft aria-hidden="true" className="size-4 shrink-0 text-secondary" />
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-soft font-semibold"
        >
          {contactName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{contactName}</p>
          <p className="text-xs text-secondary">WhatsApp preview</p>
        </div>
        <span aria-hidden="true" className="flex gap-2 text-secondary">
          <Video className="size-4" />
          <Phone className="size-4" />
          <MoreVertical className="size-4" />
        </span>
      </div>
      <div
        ref={chat}
        tabIndex={0}
        role="region"
        aria-label="Preview conversation messages"
        data-testid="phone-chat"
        className="fw-phone-chat flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain bg-neutral-soft p-3 text-slate focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-strong"
      >
        {children}
      </div>
      <div
        data-testid="phone-input"
        aria-hidden="true"
        className="flex shrink-0 items-center gap-2 border-t border-border bg-neutral-soft p-2 text-secondary"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3 py-3">
          <Smile className="size-4 shrink-0" />
          <span className="flex-1 text-sm">Message</span>
          <Paperclip className="size-4 shrink-0" />
          <Camera className="size-4 shrink-0" />
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface">
          <Mic className="size-4" />
        </span>
      </div>
    </section>
  )
}
