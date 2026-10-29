'use client'

import { Alert, Button } from '@fenwira/ui'
import Link from 'next/link'
import { Clock3, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { trialDismissalDay, trialWording } from '@/lib/reply-studio-presentation'
import { useSession } from '@/components/session/session-provider'
import { useWorkspaceStatus } from '@/lib/workspace-status'

/**
 * Shell banner for trial and ended subscriptions (Phase 11 Step 4). Shown to members who can view
 * billing; quiet until the last week of a trial. Wallet state is separate and shown elsewhere.
 */
export function SubscriptionBanner() {
  const { can, me, tenantId } = useSession()
  const workspace = useWorkspaceStatus().data
  const sub = workspace?.subscription
  const [now, setNow] = useState(() => new Date())
  const today = trialDismissalDay(now)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const storageKey = `fenwira.trial-reminder.${me.user.id}.${tenantId}`
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey))
    } catch {
      /* Storage can be unavailable. */
    }
  }, [storageKey])
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])
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
  const expired =
    sub.status === 'EXPIRED' ||
    (sub.status === 'TRIALING' && !!sub.trialEndsAt && Date.parse(sub.trialEndsAt) <= now.getTime())
  const blocked = workspace?.wallet.state === 'INSUFFICIENT_FUNDS'
  if (
    expired ||
    (sub.status === 'TRIALING' &&
      ((sub.trialDaysLeft !== null && sub.trialDaysLeft <= 7) || blocked))
  ) {
    const mandatory = expired || blocked
    if (!mandatory && dismissed === today) return null
    return (
      <div
        role="status"
        aria-label="Trial reminder"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-warning-soft px-4 py-2 text-sm text-warning-strong"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Clock3 aria-hidden="true" className="size-4 shrink-0" />
          <span className="font-medium">
            {expired
              ? 'Trial has ended'
              : sub.trialDaysLeft === null
                ? 'Trial is active'
                : trialWording(sub.trialDaysLeft)}
          </span>
          {expired && enforced ? (
            <span className="hidden text-sm sm:inline">
              · Sending paused; inbound messages still arrive.
            </span>
          ) : null}
        </div>
        <Link
          href={managed ? '/billing/invoices' : '/billing/subscription'}
          className="rounded-sm font-semibold underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-strong"
        >
          Request a plan
        </Link>
        {!mandatory ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-warning-strong hover:bg-warning/10 hover:text-warning-strong"
            aria-label="Dismiss trial reminder until tomorrow"
            onClick={() => {
              setDismissed(today)
              try {
                localStorage.setItem(storageKey, today)
              } catch {
                /* Keep the in-memory dismissal. */
              }
            }}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </div>
    )
  }
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
  return null
}
