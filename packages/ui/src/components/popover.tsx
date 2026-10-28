'use client'

import { Popover as Primitive } from 'radix-ui'
import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const Popover = Primitive.Root
export const PopoverTrigger = Primitive.Trigger
export const PopoverClose = Primitive.Close
export function PopoverContent({ className, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          'z-50 w-72 rounded-lg border border-border bg-surface p-4 text-slate shadow-overlay focus-visible:outline-2 focus-visible:outline-primary-strong',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}
