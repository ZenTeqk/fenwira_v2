'use client'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { MANAGED_BILLING_HREF } from '@/components/billing/managed-billing'
import { useSession } from '@/components/session/session-provider'

/** Managed Launch: the single billing page; otherwise the wallet. */
export default function BillingIndex() {
  const managed = useSession().me.features.managedLaunch
  const router = useRouter()
  useEffect(() => {
    router.replace(managed ? MANAGED_BILLING_HREF : '/billing/wallet')
  }, [managed, router])
  return null
}
