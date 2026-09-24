'use client'

import {
  Avatar,
  cn,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownTrigger,
  focusRing,
} from '@fenwira/ui'
import { Check, ChevronsUpDown } from 'lucide-react'

/**
 * Workspace switcher slot at the top of the sidebar. Static until Phase 3 wires memberships;
 * switching will then reset every client cache (docs/MULTI_TENANCY.md).
 */
export function TenantSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const workspace = 'Fenwira Workspace'
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={`Current workspace: ${workspace}. Switch workspace`}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-surface hover:bg-slate-800',
          collapsed && 'justify-center px-0',
          focusRing,
        )}
      >
        <Avatar name={workspace} size="sm" className="rounded-sm" />
        {collapsed ? null : (
          <>
            <span className="flex-1 truncate text-base font-semibold">{workspace}</span>
            <ChevronsUpDown className="size-4 text-slate-400" aria-hidden="true" />
          </>
        )}
      </DropdownTrigger>
      <DropdownContent align="start" className="w-60">
        <DropdownLabel>Workspaces</DropdownLabel>
        <DropdownItem>
          <span className="flex-1">{workspace}</span>
          <Check className="text-primary-strong" aria-label="Current workspace" />
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  )
}
