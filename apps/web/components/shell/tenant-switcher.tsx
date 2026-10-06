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
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSession } from '../session/session-provider'

/** Switching tenant clears every cached query and remounts the page (docs/MULTI_TENANCY.md). */
export function TenantSwitcher({
  collapsed = false,
  variant = 'sidebar',
}: {
  collapsed?: boolean
  /** `topbar`: light, compact workspace context in the top bar (UX_PATTERNS → Application shell). */
  variant?: 'sidebar' | 'topbar'
}) {
  const { me, membership, switchTenant } = useSession()
  const router = useRouter()
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={`Current workspace: ${membership.tenantName}. Switch workspace`}
        className={cn(
          'flex items-center gap-2 rounded-md text-left',
          variant === 'topbar'
            ? 'h-9 max-w-56 px-2 text-slate hover:bg-neutral-soft'
            : 'h-11 w-full px-2 text-slate hover:bg-neutral-soft',
          collapsed && 'justify-center px-0',
          focusRing,
        )}
      >
        <Avatar name={membership.tenantName} size="sm" className="rounded-sm" />
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold">
                {membership.tenantName}
              </span>
              {variant === 'sidebar' ? (
                <span className="block truncate text-xs text-muted">
                  {ROLE_LABELS[membership.role]}
                </span>
              ) : null}
            </span>
            <ChevronsUpDown
              className={cn('size-4', variant === 'topbar' ? 'text-muted' : 'text-muted')}
              aria-hidden="true"
            />
          </>
        )}
      </DropdownTrigger>
      <DropdownContent align="start" className="w-64">
        <DropdownLabel>Workspaces</DropdownLabel>
        {me.memberships.map((m) => (
          <DropdownItem key={m.tenantId} onSelect={() => switchTenant(m.tenantId)}>
            <Avatar name={m.tenantName} size="sm" className="rounded-sm" />
            <span className="min-w-0 flex-1 truncate">{m.tenantName}</span>
            {m.tenantId === membership.tenantId ? (
              <Check className="text-primary-strong" aria-label="Current workspace" />
            ) : null}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push('/onboarding')}>
          <Plus aria-hidden="true" />
          Create workspace
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}
