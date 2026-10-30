'use client'

import { Tabs as TabsPrimitive } from 'radix-ui'
import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/focus'

export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  )
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex w-full gap-1 overflow-x-auto border-b border-border-subtle', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        '-mb-px inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-base font-medium whitespace-nowrap text-fg-muted',
        'hover:text-fg data-[state=active]:border-action-primary data-[state=active]:text-fg',
        'disabled:pointer-events-none disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(focusRing, className)}
      {...props}
    />
  )
}
