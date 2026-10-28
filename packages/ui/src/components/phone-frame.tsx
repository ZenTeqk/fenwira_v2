'use client'

import {
  ArrowLeft,
  BatteryFull,
  Camera,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Signal,
  Smile,
  Video,
  Wifi,
} from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * Recipient-facing phone. Chrome is decorative and fixed: only the message region scrolls, and
 * edits preserve its position.
 */
export function PhoneFrame({
  children,
  contactName = 'Your business',
  subtitle = 'Business account',
  messageCount = 1,
  className,
}: {
  children: ReactNode
  contactName?: string
  subtitle?: string
  messageCount?: number
  className?: string
}) {
  const patternId = useId()
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
      className={cn('fw-phone-frame border-slate shadow-raised', className)}
    >
      <div
        aria-hidden="true"
        className="flex shrink-0 items-center justify-between px-4 py-2 text-xs font-semibold text-slate"
      >
        <span>9:41</span>
        <span className="flex gap-1">
          <Signal className="size-3" />
          <Wifi className="size-3" />
          <BatteryFull className="size-4" />
        </span>
      </div>
      <div
        data-testid="phone-header"
        className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 py-3 text-slate"
      >
        <ArrowLeft aria-hidden="true" className="size-4 shrink-0 text-primary-strong" />
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-strong"
        >
          {contactName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{contactName}</p>
          <p className="text-xs text-secondary">{subtitle}</p>
        </div>
        <span aria-hidden="true" className="flex gap-2 text-primary-strong">
          <Video className="size-4" />
          <Phone className="size-4" />
          <MoreVertical className="size-4" />
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col bg-thread-soft">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full text-muted-decorative opacity-10"
        >
          <defs>
            <pattern id={patternId} width="48" height="48" patternUnits="userSpaceOnUse">
              <path
                d="M7 8h12v9H7z M31 33l5-6 5 6-5 6z M9 37c0-7 9-7 9 0s-9 7-9 0"
                fill="none"
                stroke="currentColor"
              />
              <path d="M31 9l5 4-5 4 M9 17l-2 3" fill="none" stroke="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
        </svg>
        <div
          ref={chat}
          tabIndex={0}
          role="region"
          aria-label="Preview conversation messages"
          data-testid="phone-chat"
          className="fw-phone-chat relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 py-4 text-slate focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-strong"
        >
          {children}
        </div>
      </div>
      <div
        data-testid="phone-input"
        aria-hidden="true"
        className="flex shrink-0 items-center gap-2 bg-thread-soft px-2 pb-3 text-secondary"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-surface px-3 py-3">
          <Smile className="size-4 shrink-0" />
          <span className="flex-1 text-sm">Message</span>
          <Paperclip className="size-4 shrink-0" />
          <Camera className="size-4 shrink-0" />
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-strong text-surface">
          <Mic className="size-4" />
        </span>
      </div>
      <div aria-hidden="true" className="flex shrink-0 justify-center bg-surface py-2">
        <span className="h-1 w-24 rounded-full bg-slate" />
      </div>
    </section>
  )
}
