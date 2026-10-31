'use client'

import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import { Check, Circle } from 'lucide-react'
import { type ComponentProps } from 'react'
import { cn } from '../lib/cn'

export const Dropdown = MenuPrimitive.Root
export const DropdownTrigger = MenuPrimitive.Trigger
export const DropdownGroup = MenuPrimitive.Group
export const DropdownRadioGroup = MenuPrimitive.RadioGroup

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
          'z-50 min-w-44 rounded-md border border-border-subtle bg-surface p-1 shadow-overlay',
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
        'data-[highlighted]:bg-surface-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive ? 'text-status-error-fg' : 'text-fg [&_svg]:text-fg-muted',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-medium text-fg-muted', className)}
      {...props}
    />
  )
}

export function DropdownSeparator({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      className={cn('-mx-1 my-1 h-px bg-border-subtle', className)}
      {...props}
    />
  )
}

export function DropdownCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-checkbox-item"
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-base text-fg outline-none select-none',
        'data-[highlighted]:bg-surface-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Check className="size-4 text-action-primary" aria-hidden="true" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

/** One choice of a `DropdownRadioGroup` (menuitemradio): the selected option shows a dot. */
export function DropdownRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-radio-item"
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-base text-fg outline-none select-none [&_svg]:size-4 [&_svg]:text-fg-muted',
        'data-[highlighted]:bg-surface-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <MenuPrimitive.ItemIndicator>
          <Circle className="size-2 fill-current text-action-primary" aria-hidden="true" />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}
