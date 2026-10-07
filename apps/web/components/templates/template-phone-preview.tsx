'use client'

import { cn } from '@fenwira/ui'
import { type TemplateComponents, type VariableSamples } from '@fenwira/contracts'
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
import { useId } from 'react'
import { TemplatePreview } from './template-preview'

/** Recipient-facing simulation. Chrome is decorative; no fake send/call/link actions. */
export function TemplatePhonePreview({
  components,
  samples,
  headerImageUrl,
  businessName,
  compact = false,
}: {
  components: TemplateComponents
  samples: VariableSamples
  headerImageUrl?: string | null
  businessName?: string
  /** Studio-only reduction of decorative wallpaper space; message content stays complete. */
  compact?: boolean
}) {
  const patternId = useId()
  return (
    <div className="mx-auto w-full max-w-sm">
      <div
        aria-label="WhatsApp mobile conversation preview"
        className="overflow-hidden rounded-xl border-4 border-slate bg-surface shadow-raised"
      >
        <div
          aria-hidden="true"
          className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-slate"
        >
          <span>9:41</span>
          <span className="flex gap-1">
            <Signal className="size-3" />
            <Wifi className="size-3" />
            <BatteryFull className="size-4" />
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-2 border-b border-border bg-surface px-2 py-3">
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0 text-primary-strong" />
          <div
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-sm font-semibold text-primary-strong"
          >
            {(businessName || 'Business').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold">{businessName || 'Your business'}</p>
            <p className="text-xs text-secondary">Business account</p>
          </div>
          <div aria-hidden="true" className="flex gap-2 text-primary-strong">
            <Video className="size-4" />
            <Phone className="size-4" />
            <MoreVertical className="size-4" />
          </div>
        </div>
        <div
          className={cn(
            'relative flex flex-col items-start gap-4 bg-thread-soft px-3 py-4',
            compact ? 'min-h-48' : 'min-h-80',
          )}
        >
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
          <span
            aria-hidden="true"
            className="relative self-center rounded-md bg-surface px-3 py-1 text-xs text-secondary shadow-raised"
          >
            Today
          </span>
          <div className="relative w-full min-w-0 pr-4">
            <TemplatePreview
              components={components}
              samples={samples}
              headerImageUrl={headerImageUrl}
              recipient
            />
          </div>
        </div>
        <div
          aria-hidden="true"
          className="flex items-center gap-2 bg-thread-soft px-2 pb-3 text-secondary"
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
        <div aria-hidden="true" className="flex justify-center bg-surface py-2">
          <span className="h-1 w-24 rounded-full bg-slate" />
        </div>
      </div>
      <p className="mt-2 text-xs text-secondary">
        {compact
          ? 'Recipient preview · layout varies by device.'
          : 'Recipient preview using sample values. Layout may vary by device. Preview controls do not send messages.'}
      </p>
    </div>
  )
}
