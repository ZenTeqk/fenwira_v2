'use client'

import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const Dropdown = MenuPrimitive.Root
export const DropdownTrigger = MenuPrimitive.Trigger
export const DropdownGroup = MenuPrimitive.Group

export function DropdownContent({
  className,
  sideOffset = 4,
  align = 'end',
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-slot="dropdown-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-50 min-w-44 rounded-md border border-border bg-surface p-1 shadow-overlay',
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  )
}

export function DropdownItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-item"
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-base outline-none select-none [&_svg]:size-4',
        'data-[highlighted]:bg-neutral-soft data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive ? 'text-danger-strong' : 'text-slate [&_svg]:text-muted',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-medium text-muted', className)}
      {...props}
    />
  )
}

export function DropdownSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />
  )
}
