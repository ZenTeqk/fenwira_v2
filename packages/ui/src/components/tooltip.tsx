'use client'

import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { type ReactNode } from 'react'
import { cn } from '../lib/cn'

export const TooltipProvider = TooltipPrimitive.Provider

export type TooltipProps = {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  /** Text-only hints can close immediately when leaving their trigger. */
  disableHoverableContent?: boolean
}

/** Supplementary text only: never put the sole label of a control in a tooltip. */
export function Tooltip({
  content,
  children,
  side = 'top',
  className,
  disableHoverableContent,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={300} disableHoverableContent={disableHoverableContent}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-sm bg-inverse px-2 py-1 text-xs text-inverse-fg shadow-overlay',
            className,
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
