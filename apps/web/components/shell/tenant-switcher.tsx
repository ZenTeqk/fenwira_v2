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
export function TenantSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { me, membership, switchTenant } = useSession()
  const router = useRouter()
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={`Current workspace: ${membership.tenantName}. Switch workspace`}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-surface hover:bg-slate-800',
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
              <span className="block truncate text-xs text-slate-400">
                {ROLE_LABELS[membership.role]}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-slate-400" aria-hidden="true" />
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
