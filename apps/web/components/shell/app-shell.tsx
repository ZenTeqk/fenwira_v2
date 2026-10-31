'use client'

import {
  Button,
  CommandPalette,
  cn,
  Drawer,
  DrawerContent,
  focusRing,
  ModuleTabs,
  Tooltip,
  useCommandPaletteShortcut,
} from '@fenwira/ui'
import Link from 'next/link'
import { SubscriptionBanner } from '@/components/billing/subscription-banner'
import { Menu, Pin, PinOff, Search } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { moduleTabs, NAVIGATION, type NavItem, visibleNavigation } from '@/lib/navigation'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { usePresenceHeartbeat, useRealtimeEvent } from '@/lib/realtime'
import { useSession } from '../session/session-provider'
import { useCommandGroups } from '@/lib/command-search'
import { AccountMenu } from './account-menu'
import { BrandMark } from './brand-mark'
import { HelpMenu } from './help-menu'
import { NotificationsBell } from './notifications-bell'
import { SidebarNav } from './sidebar-nav'
import { SidebarStatus } from './sidebar-status'
import { TenantSwitcher } from './tenant-switcher'
import { WhatsAppConnectionControl } from './whatsapp-connection-control'
import { useSidebarExpansion } from '@/lib/use-sidebar-expansion'

type AppShellProps = { children: ReactNode; navPreview: boolean; galleryEnabled: boolean }

/**
 * Application shell (docs/design/UX_PATTERNS.md → Application shell): light sidebar of modules
 * (232px pinned/overlay, 68px rail, a drawer below 1024px); a top bar with
 * workspace, breadcrumb, search, help, notifications and account; module tabs; the page.
 */
export function AppShell({ children, navPreview, galleryEnabled }: AppShellProps) {
  const pathname = usePathname()
  const home = pathname === '/dashboard'
  // The inbox fills the viewport under the header with its own panes (docs/INBOX.md → Layout).
  const fullBleed = pathname === '/inbox' || pathname.startsWith('/inbox/')
  // One shell for every module (sidebar, logo, top bar, spacing). Pages that render their own
  // sub-navigation inside the page keep the shell's module tabs hidden to avoid two rows.
  const pageOwnsTabs =
    pathname.startsWith('/automations') ||
    pathname === '/contacts' ||
    pathname === '/integrations' ||
    pathname === '/analytics' ||
    pathname.startsWith('/analytics/') ||
    ((pathname === '/campaigns' || pathname.startsWith('/campaigns/')) &&
      pathname !== '/campaigns/analytics')
  const { membership, tenantId, can, me } = useSession()
  const unread = useQuery({
    queryKey: keys.tenant(tenantId, 'inbox-unread'),
    queryFn: () =>
      get<{ data: { conversations: number } }>('/inbox/unread-count').then(
        (r) => r.data.conversations,
      ),
    enabled: can('inbox.read'),
    refetchInterval: 30_000,
  })
  usePresenceHeartbeat(can('inbox.reply'))
  useRealtimeEvent('message.created', () => void unread.refetch())
  useRealtimeEvent('conversation.read', () => void unread.refetch())
  const badges = { inbox: unread.data ?? 0 }
  const nav: NavItem[] = useMemo(
    () =>
      visibleNavigation(navPreview, NAVIGATION, membership.permissions, me.features.managedLaunch),
    [navPreview, membership.permissions, me.features.managedLaunch],
  )
  const { rail, pinned, expanded, togglePin } = useSidebarExpansion()
  const collapsed = !expanded
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileTrigger = useRef<HTMLButtonElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)')
    const close = () => {
      if (desktop.matches) setMobileOpen(false)
    }
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [])
  useCommandPaletteShortcut(setPaletteOpen)

  const [search, setSearch] = useState('')
  const palette = useCommandGroups({ nav, search, open: paletteOpen, galleryEnabled })

  const { module: currentModule, tabs } = moduleTabs(pathname, nav)

  return (
    <div className="flex min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-surface px-3 py-2 text-fg focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Only a pinned rail reserves the expanded width. The temporary rail is below the header. */}
      <div className={cn('hidden shrink-0 desktop-navigation:block', pinned ? 'w-58' : 'w-17')}>
        <Link
          href="/dashboard"
          className={cn(
            'fixed top-0 left-0 z-20 flex h-14 items-center border-b border-r border-border-subtle bg-sidebar',
            pinned ? 'w-58 justify-start px-6' : 'w-17 justify-center',
            focusRing,
          )}
        >
          <BrandMark tone="light" compact={!pinned} size="md" />
          <span className="sr-only">Fenwira home</span>
        </Link>
        <aside
          ref={rail}
          aria-label="Application navigation"
          data-expanded={expanded}
          data-pinned={pinned}
          className={cn(
            'fw-desktop-sidebar fixed top-14 bottom-0 left-0 z-20 flex flex-col gap-2 overflow-hidden border-r border-border-subtle bg-sidebar p-3',
            expanded ? 'w-58' : 'w-17',
            expanded && !pinned && 'shadow-overlay',
          )}
        >
          <div className="flex h-6 w-52 shrink-0 justify-end">
            {expanded ? (
              <Tooltip content={pinned ? 'Unpin sidebar' : 'Pin sidebar'} side="right">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-fg-secondary"
                  onClick={togglePin}
                  aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
                  aria-pressed={pinned}
                >
                  {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                </Button>
              </Tooltip>
            ) : null}
          </div>
          <div data-sidebar-scroll className="min-h-0 overflow-y-auto overflow-x-hidden">
            <SidebarNav items={nav} pathname={pathname} collapsed={collapsed} badges={badges} />
            <SidebarStatus />
          </div>
        </aside>
      </div>

      {/* Mobile / tablet navigation */}
      <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
        <DrawerContent
          title="Navigation"
          side="left"
          width="sm"
          tone="light"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            mobileTrigger.current?.focus()
          }}
        >
          <div className="flex flex-col gap-4">
            <SidebarStatus />
            <SidebarNav
              items={nav}
              pathname={pathname}
              badges={badges}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </DrawerContent>
      </Drawer>

      <div className={cn('flex min-w-0 flex-1 flex-col', fullBleed && 'h-dvh')}>
        <header
          className={cn(
            'sticky top-0 z-30 flex shrink-0 items-center gap-1 border-b border-border-subtle bg-surface px-2 sm:gap-2 sm:px-4 md:gap-3 md:px-6',
            'h-14',
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="desktop-navigation:hidden"
            ref={mobileTrigger}
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2 lg:flex-initial">
            <TenantSwitcher variant="topbar" />
            <WhatsAppConnectionControl />
          </div>
          <span aria-hidden="true" className="hidden h-5 w-px bg-border-subtle lg:block" />
          <div className="hidden min-w-0 flex-1 lg:block" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search and jump to (Control K)"
            className={cn(
              'min-w-0 gap-2 bg-sidebar px-2 text-fg-secondary shadow-raised sm:px-3 lg:justify-start',
              'lg:mr-auto lg:w-56 xl:w-80',
            )}
          >
            <Search aria-hidden="true" />
            <span className="hidden sm:inline">Search Fenwira…</span>
            <kbd className="ml-auto hidden rounded-sm border border-border-subtle px-1.5 font-mono text-xs sm:inline">
              ⌘K
            </kbd>
          </Button>
          <HelpMenu galleryEnabled={galleryEnabled} />
          <NotificationsBell />
          <AccountMenu />
        </header>

        {tabs.length > 1 && !fullBleed && !pageOwnsTabs ? (
          <ModuleTabs
            items={tabs}
            label={`${currentModule?.label ?? 'Module'} pages`}
            linkAs={Link}
          />
        ) : null}
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 outline-none">
          {fullBleed ? (
            children
          ) : (
            <div
              className={cn(
                'mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 md:px-6',
                home ? 'py-5' : 'py-6',
              )}
            >
              <SubscriptionBanner />
              <div>{children}</div>
            </div>
          )}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={(o) => {
          setPaletteOpen(o)
          if (!o) setSearch('')
        }}
        groups={palette.groups}
        search={search}
        onSearchChange={setSearch}
        loading={palette.loading}
        placeholder="Search contacts, conversations, campaigns… or jump to a page"
      />
    </div>
  )
}
