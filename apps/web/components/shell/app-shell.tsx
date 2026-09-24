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
  useCommandPaletteShortcut,
} from '@fenwira/ui'
import { LayoutGrid, Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { breadcrumbsFor, flattenLeaves, type NavItem, visibleNavigation } from '@/lib/navigation'
import { SidebarNav } from './sidebar-nav'
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

/** Sidebar (slate, 248px / 64px collapsed; drawer below 1024px) + header + page (docs/prompts/PHASE_02). */
export function AppShell({ children, navPreview, galleryEnabled }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const nav: NavItem[] = useMemo(() => visibleNavigation(navPreview), [navPreview])
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

  const paletteGroups = useMemo(() => {
    const leaves = flattenLeaves(nav)
    const groups = [
      {
        heading: 'Navigation',
        items: leaves.map((leaf) => ({
          id: leaf.id,
          label:
            leaf.group && leaf.group !== leaf.label ? `${leaf.group} › ${leaf.label}` : leaf.label,
          keywords: leaf.group ? [leaf.group] : undefined,
          onSelect: () => router.push(leaf.href),
        })),
      },
    ]
    if (galleryEnabled) {
      groups.push({
        heading: 'Developer',
        items: [
          {
            id: 'dev-ui',
            label: 'Component gallery',
            keywords: ['design', 'ui'],
            onSelect: () => router.push('/dev/ui'),
          },
        ],
      })
    }
    return groups
  }, [nav, galleryEnabled, router])

  const crumbs = breadcrumbsFor(pathname, nav)

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
        <TenantSwitcher collapsed={collapsed} />
        <div className="flex-1 overflow-y-auto">
          <SidebarNav items={nav} pathname={pathname} collapsed={collapsed} />
        </div>
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
            <SidebarNav items={nav} pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </div>
        </DrawerContent>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
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
          <div className="min-w-0 flex-1">
            {crumbs.length > 0 ? <Breadcrumb items={crumbs} /> : null}
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
          {/* Notifications bell slot — Phase 7 */}
          <Dropdown>
            <DropdownTrigger aria-label="Account menu" className={cn('rounded-full', focusRing)}>
              <Avatar name="Guest" size="md" />
            </DropdownTrigger>
            <DropdownContent className="w-56">
              <DropdownLabel>Not signed in</DropdownLabel>
              {galleryEnabled ? (
                <>
                  <DropdownSeparator />
                  <DropdownItem onSelect={() => router.push('/dev/ui')}>
                    <LayoutGrid aria-hidden="true" />
                    Component gallery
                  </DropdownItem>
                </>
              ) : null}
            </DropdownContent>
          </Dropdown>
        </header>

        <main id="main" tabIndex={-1} className="flex-1 outline-none">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">{children}</div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={paletteGroups} />
    </div>
  )
}
