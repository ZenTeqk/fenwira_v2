'use client'

import { Alert } from '@fenwira/ui'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { useWorkspaceStatus } from '@/lib/workspace-status'

/**
 * Shell banner for trial and ended subscriptions (Phase 11 Step 4). Shown to members who can view
 * billing; quiet until the last week of a trial. Wallet state is separate and shown elsewhere.
 */
export function SubscriptionBanner() {
  const { can } = useSession()
  const sub = useWorkspaceStatus().data?.subscription
  if (!sub || !can('billing.read')) return null
  const link = (
    <Link href="/billing/subscription" className="font-medium underline underline-offset-4">
      View subscription
    </Link>
  )
  if (sub.status === 'EXPIRED' || sub.status === 'CANCELLED')
    return (
      <Alert
        tone="danger"
        title={sub.status === 'EXPIRED' ? 'Your trial has ended' : 'Your subscription has ended'}
      >
        Template messages, campaigns, API keys and webhooks are paused. Your data is kept and
        inbound messages keep arriving. {link}
      </Alert>
    )
  if (sub.status === 'TRIALING' && sub.trialDaysLeft !== null && sub.trialDaysLeft <= 7)
    return (
      <Alert
        tone="warning"
        title={`Trial ends in ${sub.trialDaysLeft} day${sub.trialDaysLeft === 1 ? '' : 's'}`}
      >
        Request a plan to keep sending without interruption. {link}
      </Alert>
    )
  return null
}
