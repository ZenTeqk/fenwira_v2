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
  // ADR-0027 manual UPI billing (ML-D2): grace, then suspension; both point at the open invoice.
  const invoices = (
    <Link href="/billing/invoices" className="font-medium underline underline-offset-4">
      View invoices
    </Link>
  )
  if (sub.status === 'SUSPENDED')
    return (
      <Alert tone="danger" title="Workspace suspended for an unpaid invoice">
        New messages and campaigns are paused until the invoice is paid. Inbound messages keep
        arriving and your data is kept. {invoices}
      </Alert>
    )
  if (sub.status === 'PAST_DUE')
    return (
      <Alert tone="warning" title="Subscription payment overdue">
        Everything keeps working
        {sub.graceEndsAt ? ` until ${new Date(sub.graceEndsAt).toLocaleDateString()}` : ''}. Pay the
        open invoice by UPI to avoid suspension. {invoices}
      </Alert>
    )
  if (sub.status === 'ACTIVE' && sub.paymentDue)
    return (
      <Alert tone="info" title="Payment due">
        Your next subscription invoice is ready. Pay it by UPI before the due date. {invoices}
      </Alert>
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
