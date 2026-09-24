'use client'

import { ErrorState, Skeleton } from '@fenwira/ui'
import { usePathname, useRouter } from 'next/navigation'
import { type ReactNode, useEffect } from 'react'
import { SessionProvider, useMe } from './session-provider'

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
  return <SessionProvider me={me}>{children}</SessionProvider>
}
