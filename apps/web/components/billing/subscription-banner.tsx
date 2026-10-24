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
  const { can, me } = useSession()
  const sub = useWorkspaceStatus().data?.subscription
  if (!sub || sub.internal || !can('billing.read')) return null
  const managed = me.features.managedLaunch
  const enforced = sub.enforced ?? false
  // Managed Launch: one billing page; customers pay the invoice by UPI (no plan request page).
  const link = managed ? (
    <Link href="/billing/invoices" className="font-medium underline underline-offset-4">
      Open billing
    </Link>
  ) : (
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
  const pay = managed
    ? 'Pay your invoice by UPI (scan the QR) or reply to our email.'
    : 'Request a plan to continue.'
  // Nothing is paused unless subscriptions are enforced (BILLING_SUBSCRIPTIONS_ENFORCED).
  if (sub.status === 'SUSPENDED')
    return enforced ? (
      <Alert tone="danger" title="Workspace suspended for an unpaid invoice">
        New messages and campaigns are paused until the invoice is paid. Inbound messages keep
        arriving and your data is kept. {invoices}
      </Alert>
    ) : (
      <Alert tone="warning" title="Your invoice is overdue">
        Please pay it by UPI (scan the QR) or reply to our email. {invoices}
      </Alert>
    )
  if (sub.status === 'PAST_DUE')
    return (
      <Alert tone="warning" title="Subscription payment overdue">
        {enforced
          ? `Everything keeps working${sub.graceEndsAt ? ` until ${new Date(sub.graceEndsAt).toLocaleDateString()}` : ''}. Pay the open invoice by UPI to avoid suspension.`
          : 'Please pay the open invoice by UPI.'}{' '}
        {invoices}
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
        tone={enforced ? 'danger' : 'warning'}
        title={sub.status === 'EXPIRED' ? 'Your trial has ended' : 'Your subscription has ended'}
      >
        {enforced
          ? 'Template messages, campaigns, API keys and webhooks are paused. Your data is kept and inbound messages keep arriving.'
          : 'Your workspace keeps working and your data is kept.'}{' '}
        {pay} {link}
      </Alert>
    )
  if (sub.status === 'TRIALING' && sub.trialDaysLeft !== null && sub.trialDaysLeft <= 7)
    return (
      <Alert
        tone="warning"
        title={`Trial ends in ${sub.trialDaysLeft} day${sub.trialDaysLeft === 1 ? '' : 's'}`}
      >
        {managed
          ? 'Billing starts when your trial ends. We’ll send you an invoice to pay by UPI.'
          : 'Request a plan to keep sending without interruption.'}{' '}
        {link}
      </Alert>
    )
  return null
}
