'use client'

import { ROLE_LABELS } from '@fenwira/contracts'
import {
  Avatar,
  cn,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  focusRing,
} from '@fenwira/ui'
import { ChevronRight, LogOut, Shield } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSession } from '../session/session-provider'

/** One account action path, rendered compactly in the topbar and with identity in the footer. */
export function AccountMenu({
  footer = false,
  collapsed = false,
}: {
  footer?: boolean
  collapsed?: boolean
}) {
  const { me, membership, signOut } = useSession()
  const router = useRouter()
  return (
    <Dropdown>
      <DropdownTrigger
        className={cn(
          footer
            ? 'flex w-full items-center gap-3 rounded-md border-t border-border-subtle px-2 py-3 text-left hover:bg-surface-hover'
            : 'rounded-full',
          collapsed && 'justify-center px-0',
          focusRing,
        )}
      >
        <span aria-hidden="true">
          <Avatar appearance="varied" name={me.user.name} size="md" />
        </span>
        {footer && !collapsed ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-slate">{me.user.name}</span>
            <span className="block text-sm text-secondary">{ROLE_LABELS[membership.role]}</span>
          </span>
        ) : null}
        {footer && !collapsed ? (
          <ChevronRight className="size-4 text-muted" aria-hidden="true" />
        ) : null}
        <span className="sr-only">{footer ? 'Workspace account menu' : 'Account menu'}</span>
      </DropdownTrigger>
      <DropdownContent className="w-64">
        <DropdownLabel className="flex flex-col gap-0.5 text-slate">
          <span className="truncate text-base font-medium">{me.user.name}</span>
          <span className="truncate text-xs font-normal text-muted">{me.user.email}</span>
        </DropdownLabel>
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push('/settings/security')}>
          <Shield aria-hidden="true" />
          Security
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem onSelect={() => void signOut()}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}
