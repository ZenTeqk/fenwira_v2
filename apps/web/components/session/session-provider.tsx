'use client'

import { type Me, type MembershipSummary, type Permission } from '@fenwira/contracts'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { ApiError, get, post, setActiveTenantId, setCsrfToken } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'
import { requestNavigation } from '@/lib/navigation-intent'

const TENANT_KEY = 'fenwira.tenant'

function readStoredTenant(): string | undefined {
  try {
    return window.localStorage.getItem(TENANT_KEY) ?? undefined
  } catch {
    return undefined
  }
}
function storeTenant(id: string): void {
  try {
    window.localStorage.setItem(TENANT_KEY, id)
  } catch {
    // Storage unavailable: the choice just isn't remembered across reloads.
  }
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Loads /auth/me; `null` data means "signed out". */
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async (): Promise<Me | null> => {
      try {
        const res = await get<{ data: Me }>('/auth/me', { tenant: false })
        setCsrfToken(res.data.csrfToken)
        return res.data
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: 60_000,
  })
}

type SessionContextValue = {
  me: Me
  membership: MembershipSummary
  tenantId: string
  can: (permission: Permission) => boolean
  switchTenant: (tenantId: string) => void
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}

/** Signed-in session with an active tenant. Rendered by AuthGate once both exist. */
export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pick = useCallback(
    (preferred?: string) =>
      me.memberships.find((m) => m.tenantId === preferred) ?? me.memberships[0]!,
    [me.memberships],
  )
  const [tenantId, setTenantId] = useState(() => pick(readStoredTenant()).tenantId)
  const membership = pick(tenantId)
  setActiveTenantId(membership.tenantId)

  useEffect(() => {
    if (membership.tenantId !== tenantId) setTenantId(membership.tenantId)
    storeTenant(membership.tenantId)
  }, [membership.tenantId, tenantId])

  const switchTenant = useCallback(
    (next: string) => {
      if (next === membership.tenantId) return
      requestNavigation('/dashboard', () => {
        setActiveTenantId(next)
        storeTenant(next)
        // Drop every cached query from the previous tenant before anything re-renders with the new one.
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
        setTenantId(next)
        router.push('/dashboard')
      })
    },
    [membership.tenantId, queryClient, router],
  )

  const signOut = useCallback(async () => {
    try {
      await post('/auth/logout')
    } finally {
      queryClient.clear()
      setActiveTenantId(undefined)
      router.replace('/login')
    }
  }, [queryClient, router])

  const value = useMemo<SessionContextValue>(
    () => ({
      me,
      membership,
      tenantId: membership.tenantId,
      can: (permission) => membership.permissions.includes(permission),
      switchTenant,
      signOut,
    }),
    [me, membership, switchTenant, signOut],
  )
  // Keyed by tenant: every tenant-scoped component remounts on switch (no stale local state).
  return (
    <SessionContext.Provider value={value}>
      <div key={membership.tenantId} className="contents">
        {children}
      </div>
    </SessionContext.Provider>
  )
}
