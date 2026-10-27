'use client'

import { Check, CheckCheck, CircleAlert, Clock, type LucideProps } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { type ComponentType, type ReactNode, useId, useState } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

/**
 * WhatsApp-style delivery ticks for outbound inbox bubbles (docs/MESSAGING_ENGINE.md → Status
 * ticks). Icon only, with an accessible label and a title: an intentional exception to the
 * "label plus icon" StatusBadge rule, limited to inbox bubble ticks. Every other status (campaigns,
 * tables, lists) stays on StatusBadge. This is the one place the tick icons and colours live.
 */
export type MessageTickState = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'

/** Read is the delivered double tick drawn heavier as well as blue, so it isn't colour alone. */
function ReadTicks(props: LucideProps) {
  return <CheckCheck strokeWidth={2.75} {...props} />
}

export const MESSAGE_TICKS: Record<
  MessageTickState,
  { icon: ComponentType<LucideProps>; className: string; label: string }
> = {
  pending: { icon: Clock, className: 'text-muted', label: 'Sending' },
  sent: { icon: Check, className: 'text-muted', label: 'Sent' },
  delivered: { icon: CheckCheck, className: 'text-muted', label: 'Delivered' },
  // There is no blue single tick: blue is only ever the read double tick.
  read: { icon: ReadTicks, className: 'text-info', label: 'Read' },
  failed: { icon: CircleAlert, className: 'text-danger', label: 'Failed to send' },
}

/** Message status → tick state; null for statuses that never show ticks (inbound RECEIVED). */
export function tickStateOf(status: string): MessageTickState | null {
  switch (status) {
    case 'CREATED':
    case 'QUEUED':
    case 'SENDING':
      return 'pending'
    case 'SENT':
      return 'sent'
    case 'DELIVERED':
      return 'delivered'
    case 'READ':
      return 'read'
    case 'FAILED':
      return 'failed'
    default:
      return null
  }
}

export type MessageTicksProps = {
  status: string
  /** FAILED only: Meta's reason and code, shown on focus or click. */
  errorCode?: string | null
  errorDetail?: string | null
  className?: string
}

export function MessageTicks({ status, errorCode, errorDetail, className }: MessageTicksProps) {
  const state = tickStateOf(status)
  if (!state) return null
  const { icon: Icon, className: tone, label } = MESSAGE_TICKS[state]
  const icon = <Icon aria-hidden="true" focusable="false" className={cn('size-4', tone)} />
  if (state === 'failed')
    return (
      <FailedTick errorCode={errorCode} errorDetail={errorDetail} className={className}>
        {icon}
      </FailedTick>
    )
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-tick={state}
      className={cn('inline-flex shrink-0', className)}
    >
      {icon}
    </span>
  )
}

const metaCode = (code: string) => code.replace(/^META_/, '')

/** The failed icon is a button: focus or click shows why, so the state is never colour alone. */
function FailedTick({
  errorCode,
  errorDetail,
  className,
  children,
}: {
  errorCode?: string | null
  errorDetail?: string | null
  className?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <button
          type="button"
          aria-label="Failed to send"
          aria-describedby={open ? id : undefined}
          title="Failed to send"
          data-tick="failed"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          className={cn('inline-flex shrink-0 rounded-full', focusRing, className)}
        >
          {children}
        </button>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={id}
          role="tooltip"
          side="top"
          align="end"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 max-w-xs rounded-sm bg-slate px-3 py-2 text-xs text-surface shadow-overlay"
        >
          <p className="font-medium">Not sent</p>
          <p>{errorDetail ?? 'WhatsApp did not accept this message.'}</p>
          {errorCode ? <p>Error code {metaCode(errorCode)}</p> : null}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/**
 * A failed send under its bubble: "Failed · View details" in danger text with an icon. Never shown
 * together with ticks. "View details" opens Meta's reason and error code; there is no retry here.
 */
export function MessageFailure({
  errorCode,
  errorDetail,
  className,
}: {
  errorCode?: string | null
  errorDetail?: string | null
  className?: string
}) {
  const id = useId()
  return (
    <p
      data-tick="failed"
      className={cn('flex items-center gap-1.5 text-xs text-danger-strong', className)}
    >
      <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
      <span>Failed</span>
      <span aria-hidden="true">·</span>
      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger
          className={cn('rounded-sm font-medium underline-offset-2 hover:underline', focusRing)}
        >
          View details
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            role="dialog"
            aria-labelledby={`${id}-title`}
            side="top"
            align="end"
            sideOffset={6}
            className="z-50 flex max-w-xs flex-col gap-1 rounded-md border border-border bg-surface p-3 text-sm text-slate shadow-overlay"
          >
            <p id={`${id}-title`} className="font-semibold">
              Message not sent
            </p>
            <p className="text-secondary">
              {errorDetail ?? 'WhatsApp did not accept this message.'}
            </p>
            {errorCode ? (
              <p className="text-xs text-secondary">Meta error code {metaCode(errorCode)}</p>
            ) : null}
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </p>
  )
}
