'use client'

import {
  Button,
  CommandPalette,
  cn,
  Drawer,
  DrawerContent,
  focusRing,
  ModuleTabs,
  useCommandPaletteShortcut,
} from '@fenwira/ui'
import Link from 'next/link'
import { SubscriptionBanner } from '@/components/billing/subscription-banner'
import { Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const COLLAPSE_KEY = 'fenwira.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(COLLAPSE_KEY, String(value))
  } catch {
    // Storage unavailable (private mode, blocked): the preference simply isn't remembered.
  }
}

type AppShellProps = { children: ReactNode; navPreview: boolean; galleryEnabled: boolean }

/**
 * Application shell (docs/design/UX_PATTERNS.md → Application shell): light sidebar of modules
 * (232px, 64px collapsed, a drawer below 1024px) with workspace status at its foot; a top bar with
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
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileTrigger = useRef<HTMLButtonElement>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => setCollapsed(readCollapsed()), [])
  useCommandPaletteShortcut(setPaletteOpen)

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      writeCollapsed(!value)
      return !value
    })
  }, [])

  const [search, setSearch] = useState('')
  const palette = useCommandGroups({ nav, search, open: paletteOpen, galleryEnabled })

  const { module: currentModule, tabs } = moduleTabs(pathname, nav)

  return (
    <div className="flex min-h-dvh bg-background">
      <a
        href="#main"
        className="sr-only z-50 rounded-sm bg-surface px-3 py-2 text-slate focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-3 transition-all lg:flex',
          collapsed ? 'w-16' : 'w-56',
        )}
      >
        <Link
          href="/dashboard"
          className={cn(
            'flex h-10 items-center rounded-sm px-3',
            collapsed && 'justify-center px-0',
            focusRing,
          )}
        >
          <BrandMark tone="light" compact={collapsed} size="md" className="text-xl" />
          <span className="sr-only">Fenwira home</span>
        </Link>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav items={nav} pathname={pathname} collapsed={collapsed} badges={badges} />
        </div>
        <SidebarStatus collapsed={collapsed} />
        <AccountMenu footer collapsed={collapsed} />
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          className={cn(
            'flex h-9 items-center gap-3 rounded-sm px-3 text-base text-secondary hover:bg-neutral-soft hover:text-slate',
            collapsed && 'justify-center px-0',
            focusRing,
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="size-4" aria-hidden="true" />
          )}
          {collapsed ? null : <span>Collapse</span>}
        </button>
      </aside>

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
            <TenantSwitcher />
            <SidebarStatus />
            <AccountMenu footer />
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
            'sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface px-4 md:px-6',
            'h-14',
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            ref={mobileTrigger}
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <div className="hidden lg:block">
            <TenantSwitcher variant="topbar" />
          </div>
          <span aria-hidden="true" className="hidden h-5 w-px bg-border lg:block" />
          <div className="min-w-0 flex-1 lg:w-0 lg:flex-none xl:w-24" />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search and jump to (Control K)"
            className={cn(
              'min-w-0 gap-2 bg-sidebar text-secondary shadow-raised lg:justify-start',
              'lg:mr-auto lg:w-72 xl:w-96',
            )}
          >
            <Search aria-hidden="true" />
            <span className="hidden sm:inline">Search Fenwira…</span>
            <kbd className="ml-auto hidden rounded-sm border border-border px-1.5 font-mono text-xs sm:inline">
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
