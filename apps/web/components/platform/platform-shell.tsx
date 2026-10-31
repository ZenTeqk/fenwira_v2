'use client'
import { Badge, Button, cn, ErrorState, Skeleton } from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock3, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect } from 'react'
import { SessionTimeout } from '@/components/session/session-timeout'
import { BrandMark } from '@/components/shell/brand-mark'
import { sidebarItemClass } from '@/components/shell/sidebar-nav'
import {
  clearPlatformSession,
  platformKeepAlive,
  platformMe,
  platformRequest,
} from '@/lib/platform'
import { parseDeadlines } from '@/lib/session-activity'
import { AiRequestsNavLabel } from './ai-requests-nav'
import { IdentityProvider } from './identity'
import { PlatformContext } from './platform-context'
export { usePlatform } from './platform-context'
export function PlatformShell({ children }: { children: ReactNode }) {
  const pathname = usePathname(),
    router = useRouter(),
    cache = useQueryClient()
  const login = pathname === '/platform/login'
  const me = useQuery({
    queryKey: ['platform', 'me'],
    queryFn: platformMe,
    enabled: !login,
    retry: false,
    staleTime: 0,
  })
  // 12 h absolute / 3 h idle, enforced by the server; SessionTimeout warns 5 minutes ahead.
  const expire = useCallback(() => {
    clearPlatformSession()
    cache.removeQueries({ queryKey: ['platform'] })
    router.replace('/platform/login?reason=expired')
  }, [cache, router])
  const keepAlive = useCallback(async () => {
    const next = await platformKeepAlive()
    if (next) cache.setQueryData(['platform', 'me'], next)
    return next !== null
  }, [cache])
  useEffect(() => {
    if (login) return
    window.addEventListener('platform-expired', expire)
    return () => window.removeEventListener('platform-expired', expire)
  }, [login, expire])
  useEffect(() => {
    if (!login && me.isError) router.replace('/platform/login')
  }, [login, me.isError, router])
  if (login)
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
        {children}
      </main>
    )
  if (me.isPending)
    return (
      <main className="p-6">
        <Skeleton className="h-20 w-full" />
      </main>
    )
  if (!me.data) return <ErrorState description="Privileged sign-in required." />
  const nav: Array<[string, ReactNode]> = [
    ['/platform', 'Overview'],
    ['/platform/workspaces', 'Workspaces'],
    ['/platform/access-requests', 'Access requests'],
    ['/platform/payments', 'Payments'],
    ['/platform/billing-operations', 'Billing operations'],
    ['/platform/plans', 'Plans & prices'],
    ['/platform/ai-requests', <AiRequestsNavLabel key="ai" />],
    ['/platform/ai-plans', 'AI plans'],
    ['/platform/email', 'Email'],
    ['/platform/audit', 'Audit'],
  ]
  return (
    <PlatformContext.Provider value={me.data}>
      <SessionTimeout
        deadlines={parseDeadlines(me.data)}
        keepAlive={keepAlive}
        onExpired={expire}
      />
      <a href="#platform-main" className="sr-only focus:not-sr-only focus:p-3">
        Skip to platform content
      </a>
      <div className="min-h-screen bg-canvas text-fg">
        {/* Operator identity: a separate privileged console, never the customer workspace shell. */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 py-3 md:px-6">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Link
              href="/platform/workspaces"
              className="flex items-center gap-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              <BrandMark compact />
              <span className="font-semibold text-fg">
                Fenwira <span className="font-normal text-fg-secondary">/ Platform</span>
              </span>
            </Link>
            <Badge tone="neutral" icon={<ShieldCheck className="size-4" />}>
              Operator console
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm text-fg-secondary">
              <Clock3 aria-hidden="true" className="size-4 text-fg-subtle" />
              Privilege ends {new Date(me.data.expiresAt).toLocaleTimeString()}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                try {
                  await platformRequest('/auth/logout', {})
                } finally {
                  clearPlatformSession()
                  cache.removeQueries({ queryKey: ['platform'] })
                  router.replace('/platform/login')
                }
              }}
            >
              Sign out
            </Button>
          </div>
        </header>
        <div className="flex min-w-0 flex-col md:flex-row">
          <nav
            aria-label="Platform"
            className="flex min-w-0 gap-1 overflow-x-auto border-b border-border-subtle bg-sidebar p-2 md:min-h-screen md:w-56 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:p-3"
          >
            {nav
              .filter(
                ([href]) =>
                  ((href !== '/platform/audit' && href !== '/platform/email') ||
                    me.data.permissions.includes('audit.read')) &&
                  (href !== '/platform/payments' || me.data.permissions.includes('payments.read')),
              )
              .map(([href, label]) => {
                // Overview is the console root, so only an exact match makes it current.
                const current = href === '/platform' ? pathname === href : pathname.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      sidebarItemClass(current),
                      'w-auto shrink-0 whitespace-nowrap md:w-full',
                    )}
                  >
                    {label}
                  </Link>
                )
              })}
          </nav>
          <main id="platform-main" className="min-w-0 flex-1 p-4 md:p-6">
            <IdentityProvider>{children}</IdentityProvider>
          </main>
        </div>
      </div>
    </PlatformContext.Provider>
  )
}
