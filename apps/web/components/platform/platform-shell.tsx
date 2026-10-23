'use client'
import { type PlatformMe } from '@fenwira/contracts'
import { Button, ErrorState, Skeleton } from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, type ReactNode, useCallback, useContext, useEffect } from 'react'
import { SessionTimeout } from '@/components/session/session-timeout'
import {
  clearPlatformSession,
  platformKeepAlive,
  platformMe,
  platformRequest,
} from '@/lib/platform'
import { parseDeadlines } from '@/lib/session-activity'
const PlatformContext = createContext<PlatformMe | null>(null)
export const usePlatform = () => useContext(PlatformContext)
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
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
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
  const nav = [
    ['/platform', 'Overview'],
    ['/platform/workspaces', 'Workspaces'],
    ['/platform/access-requests', 'Access requests'],
    ['/platform/payments', 'Payments'],
    ['/platform/billing-operations', 'Billing operations'],
    ['/platform/plans', 'Plans & prices'],
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
      <div className="min-h-screen bg-background text-slate">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-4">
          <Link href="/platform/workspaces" className="font-semibold">
            Fenwira <span className="text-secondary">/ Platform</span>
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-secondary">
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
        <div className="flex flex-col md:flex-row">
          <nav
            aria-label="Platform"
            className="flex gap-2 border-b border-border bg-surface p-4 md:min-h-screen md:w-56 md:flex-col md:border-r md:border-b-0"
          >
            {nav
              .filter(
                ([href]) =>
                  ((href !== '/platform/audit' && href !== '/platform/email') ||
                    me.data.permissions.includes('audit.read')) &&
                  (href !== '/platform/payments' || me.data.permissions.includes('payments.read')),
              )
              .map(([href, label]) => (
                <Button
                  key={href}
                  asChild
                  variant={pathname.startsWith(href!) ? 'primary' : 'ghost'}
                  className="justify-start"
                >
                  <Link
                    href={href!}
                    aria-current={
                      (href === '/platform' ? pathname === href : pathname.startsWith(href!))
                        ? 'page'
                        : undefined
                    }
                  >
                    {label}
                  </Link>
                </Button>
              ))}
          </nav>
          <main id="platform-main" className="min-w-0 flex-1 p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </PlatformContext.Provider>
  )
}
