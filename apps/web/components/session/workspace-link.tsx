'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { useSession } from './session-provider'

/**
 * Notification and task links carry `ws=<workspace id>` (docs/FOLLOW_UPS_AND_SALES.md →
 * Links). When it names another workspace the user belongs to, switch to it and open the same
 * page there; the page's own access checks still apply. An unknown workspace is ignored.
 */
export function WorkspaceLinkHandler() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const { me, tenantId, switchTenant } = useSession()
  const ws = params.get('ws')
  useEffect(() => {
    if (!ws) return
    const rest = new URLSearchParams(params.toString())
    rest.delete('ws')
    const target = rest.size ? `${pathname}?${rest.toString()}` : pathname
    if (ws !== tenantId && me.memberships.some((m) => m.tenantId === ws)) switchTenant(ws, target)
    else router.replace(target)
  }, [ws])
  return null
}
