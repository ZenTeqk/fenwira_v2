'use client'

import { type Me } from '@fenwira/contracts'
import { ErrorState, Skeleton } from '@fenwira/ui'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useState } from 'react'
import {
  onSessionDeadlines,
  post,
  refreshSession,
  setActiveTenantId,
  setSessionDeadlines,
} from '@/lib/api/client'
import { noteInteraction, parseDeadlines } from '@/lib/session-activity'
import { SessionProvider, useMe } from './session-provider'
import { SessionTimeout } from './session-timeout'

/**
 * Client-side gate for the app shell (docs/ARCHITECTURE.md → Frontend): signed out → /login,
 * unverified → /verify-email, no workspace → /onboarding, otherwise render with a session.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { data: me, isPending, error, refetch } = useMe()
  const router = useRouter()
  const pathname = usePathname()

  const redirect =
    me === null
      ? `/login?next=${encodeURIComponent(pathname)}`
      : me && !me.user.emailVerified
        ? '/verify-email'
        : me && me.memberships.length === 0
          ? '/onboarding'
          : null

  useEffect(() => {
    if (redirect) router.replace(redirect)
  }, [redirect, router])

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState description="We could not load your account." onRetry={() => void refetch()} />
      </div>
    )
  }
  if (isPending || !me || redirect) {
    return (
      <div className="flex min-h-dvh" aria-busy="true" aria-label="Loading">
        <div className="hidden w-62 bg-slate lg:block" />
        <div className="flex flex-1 flex-col gap-4 p-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    )
  }
  return (
    <SessionProvider me={me}>
      <AppSessionTimeout me={me} />
      {children}
    </SessionProvider>
  )
}

/** 12 h absolute / 3 h idle (server-enforced); warns 5 minutes before the idle sign-out. */
function AppSessionTimeout({ me }: { me: Me }) {
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const [deadlines, setDeadlines] = useState(() => parseDeadlines(me.session))
  useEffect(() => {
    setSessionDeadlines(parseDeadlines(me.session))
    return onSessionDeadlines(setDeadlines)
  }, [me.session])
  const keepAlive = useCallback(() => {
    noteInteraction()
    return refreshSession()
  }, [])
  const onExpired = useCallback(() => {
    void post('/auth/logout').catch(() => undefined)
    queryClient.clear()
    setActiveTenantId(undefined)
    router.replace(`/login?reason=expired&next=${encodeURIComponent(pathname)}`)
  }, [pathname, queryClient, router])
  return <SessionTimeout deadlines={deadlines} keepAlive={keepAlive} onExpired={onExpired} />
}
