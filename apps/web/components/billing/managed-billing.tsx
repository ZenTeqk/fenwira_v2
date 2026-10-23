'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useSession } from '@/components/session/session-provider'

/** The one customer billing page in Managed Launch Mode (ADR-0027). */
export const MANAGED_BILLING_HREF = '/billing/invoices'

/**
 * Managed Launch: customers see one billing page (plan, price, due date, invoice and UPI).
 * Wallet, usage/price and plan-request pages send them there; operators keep them in /platform.
 */
export function useManagedBillingRedirect(): boolean {
  const managed = useSession().me.features.managedLaunch
  const router = useRouter()
  useEffect(() => {
    if (managed) router.replace(MANAGED_BILLING_HREF)
  }, [managed, router])
  return managed
}
