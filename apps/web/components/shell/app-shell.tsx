'use client'

import {
  Avatar,
  Breadcrumb,
  Button,
  CommandPalette,
  cn,
  Drawer,
  DrawerContent,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
  focusRing,
  ModuleTabs,
  useCommandPaletteShortcut,
} from '@fenwira/ui'
import Link from 'next/link'
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Shield } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  breadcrumbsFor,
  flattenLeaves,
  moduleTabs,
  NAVIGATION,
  type NavItem,
  visibleNavigation,
} from '@/lib/navigation'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { usePresenceHeartbeat, useRealtimeEvent } from '@/lib/realtime'
import { useSession } from '../session/session-provider'
import { useCommandGroups } from '@/lib/command-search'
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
 * Application shell (docs/design/UX_PATTERNS.md → Application shell): slate sidebar of modules
 * (248px, 64px collapsed, a drawer below 1024px) with workspace status at its foot; a top bar with
 * workspace, breadcrumb, search, help, notifications and account; module tabs; the page.
 */
export function AppShell({ children, navPreview, galleryEnabled }: AppShellProps) {
  const pathname = usePathname()
  // The inbox fills the viewport under the header with its own panes (docs/INBOX.md → Layout).
  const fullBleed = pathname === '/inbox' || pathname.startsWith('/inbox/')
  const router = useRouter()
  const { me, membership, signOut, tenantId, can } = useSession()
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
    () => visibleNavigation(navPreview, NAVIGATION, membership.permissions),
    [navPreview, membership.permissions],
  )
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
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

  // Section pages get the breadcrumb here; record pages (/contacts/:id …) render a more specific
  // one in their own header, so the top bar leaves it out to avoid two trails.
  const onSectionPage = flattenLeaves(nav).some((l) => l.href === pathname)
  const crumbs = onSectionPage ? breadcrumbsFor(pathname, nav) : []
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
          'sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 bg-slate p-3 transition-all lg:flex',
          collapsed ? 'w-16' : 'w-62',
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
          <BrandMark tone="dark" compact={collapsed} />
          <span className="sr-only">Fenwira home</span>
        </Link>
        <div className="flex-1 overflow-y-auto">
          <SidebarNav items={nav} pathname={pathname} collapsed={collapsed} badges={badges} />
        </div>
        <SidebarStatus collapsed={collapsed} />
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          className={cn(
            'flex h-9 items-center gap-3 rounded-sm px-3 text-base text-slate-400 hover:bg-slate-800 hover:text-surface',
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
        <DrawerContent title="Navigation" side="left" width="sm" tone="dark">
          <div className="flex flex-col gap-4">
            <TenantSwitcher />
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
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4 md:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu aria-hidden="true" />
          </Button>
          <div className="hidden lg:block">
            <TenantSwitcher variant="topbar" />
          </div>
          <span aria-hidden="true" className="hidden h-5 w-px bg-border lg:block" />
          <div className="min-w-0 flex-1">
            {crumbs.length > 0 ? <Breadcrumb items={crumbs} linkAs={Link} /> : null}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search and jump to (Control K)"
            className="gap-2 text-muted"
          >
            <Search aria-hidden="true" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded-sm border border-border px-1.5 font-mono text-xs sm:inline">
              ⌘K
            </kbd>
          </Button>
          <HelpMenu galleryEnabled={galleryEnabled} />
          <NotificationsBell />
          <Dropdown>
            <DropdownTrigger className={cn('rounded-full', focusRing)}>
              {/* Initials are decorative; naming via text (not aria-label) avoids a label/content mismatch. */}
              <span aria-hidden="true">
                <Avatar name={me.user.name} size="md" />
              </span>
              <span className="sr-only">Account menu</span>
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
        </header>

        {tabs.length && !fullBleed ? (
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
            <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">{children}</div>
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
