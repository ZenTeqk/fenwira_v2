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
import { Keyboard, LayoutGrid, LogOut, Shield } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useSession } from '../session/session-provider'
import { KeyboardShortcutsDialog } from './help-menu'

/** The sole personal account menu, in the top-right header; Help lives here too. */
export function AccountMenu({ galleryEnabled = false }: { galleryEnabled?: boolean }) {
  const { me, membership, signOut } = useSession()
  const router = useRouter()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  return (
    <>
      <Dropdown>
        <DropdownTrigger className={cn('shrink-0 rounded-full', focusRing)}>
          <span aria-hidden="true">
            <Avatar appearance="varied" name={me.user.name} size="md" />
          </span>
          <span className="sr-only">Account menu</span>
        </DropdownTrigger>
        <DropdownContent className="w-64">
          <DropdownLabel className="flex flex-col gap-0.5 text-fg">
            <span className="truncate text-base font-medium">{me.user.name}</span>
            <span className="truncate text-xs font-normal text-fg-muted">{me.user.email}</span>
            <span className="text-xs font-normal text-fg-secondary">
              {ROLE_LABELS[membership.role]}
            </span>
          </DropdownLabel>
          <DropdownSeparator />
          <DropdownItem onSelect={() => router.push('/settings/security')}>
            <Shield aria-hidden="true" />
            Security
          </DropdownItem>
          <DropdownSeparator />
          <DropdownLabel>Help</DropdownLabel>
          <DropdownItem onSelect={() => setShortcutsOpen(true)}>
            <Keyboard aria-hidden="true" />
            Keyboard shortcuts
          </DropdownItem>
          {galleryEnabled ? (
            <DropdownItem onSelect={() => router.push('/dev/ui')}>
              <LayoutGrid aria-hidden="true" />
              Component gallery
            </DropdownItem>
          ) : null}
          <DropdownSeparator />
          <DropdownItem onSelect={() => void signOut()}>
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  )
}
