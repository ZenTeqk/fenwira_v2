'use client'

import { Alert, Button, Card, Skeleton, StatusBadge } from '@fenwira/ui'
import { ArrowRight, CalendarClock, Check, Layers, Tag } from 'lucide-react'
import Link from 'next/link'
import { formatMoney } from '@/lib/billing'
import {
  STATUS_BADGE,
  STATUS_LABEL,
  useEntitlements,
  usePlans,
  useSubscription,
} from '@/lib/subscription'

/** Read-only commercial context. Effective entitlements come from Step 4, never plan names. */
export function WalletPlanContext() {
  const subscription = useSubscription()
  const plans = usePlans()
  const entitlements = useEntitlements()
  const s = subscription.data
  const plan = plans.data?.find((p) => p.id === s?.plan?.id)
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' })
  return (
    <Card className="flex flex-col gap-4 p-4" aria-labelledby="wallet-plan-heading">
      <h2 id="wallet-plan-heading" className="text-md font-semibold">
        Current plan
      </h2>
      {subscription.isPending ? (
        <Skeleton aria-label="Loading subscription" className="h-20" />
      ) : subscription.isError ? (
        <Alert
          tone="danger"
          title="Couldn’t load your subscription"
          action={
            <Button variant="secondary" size="sm" onClick={() => void subscription.refetch()}>
              Try again
            </Button>
          }
        />
      ) : s ? (
        <>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong"
            >
              <Layers className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <p className="break-words text-md font-semibold">
                {s.plan?.name ?? (s.status === 'TRIALING' ? 'Workspace trial' : 'No active plan')}
              </p>
              <StatusBadge status={STATUS_BADGE[s.status]} label={STATUS_LABEL[s.status]} />
            </div>
          </div>
          {entitlements.isPending ? (
            <Skeleton aria-label="Loading effective features" className="h-12" />
          ) : entitlements.isError ? (
            <Alert
              tone="danger"
              title="Couldn’t load effective features"
              action={
                <Button variant="secondary" size="sm" onClick={() => void entitlements.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (
            <ul
              aria-label="Effective subscription features"
              className="flex flex-col gap-2 text-sm"
            >
              {entitlements.data
                ?.filter((e) => e.kind === 'capability')
                .map((e) => (
                  <li key={e.key} className="flex items-center gap-2">
                    {e.enabled ? (
                      <Check aria-hidden="true" className="size-4 shrink-0 text-primary-strong" />
                    ) : null}
                    <span>
                      {e.label}
                      {e.enabled ? '' : ' · not included'}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <dl className="flex flex-col gap-3 border-t border-border pt-3 text-sm">
            {s.trialEndsAt && s.status === 'TRIALING' ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-secondary">
                  <CalendarClock aria-hidden="true" className="size-4" />
                  Trial ends
                </dt>
                <dd>{date(s.trialEndsAt)}</dd>
              </div>
            ) : null}
            {s.currentPeriodEnd ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="flex items-center gap-2 text-secondary">
                  <CalendarClock aria-hidden="true" className="size-4" />
                  Current period ends
                </dt>
                <dd>{date(s.currentPeriodEnd)}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <dt className="flex items-center gap-2 text-secondary">
                <Tag aria-hidden="true" className="size-4" />
                Pricing
              </dt>
              <dd>
                {plans.isPending
                  ? 'Loading…'
                  : plans.isError
                    ? 'Unavailable'
                    : plan?.price
                      ? `${formatMoney(plan.price.amountMinor, plan.price.currency)} / ${plan.price.interval.toLowerCase()}`
                      : 'Contact us'}
              </dd>
            </div>
          </dl>
          {plans.isError ? (
            <Button variant="secondary" size="sm" onClick={() => void plans.refetch()}>
              Retry pricing
            </Button>
          ) : null}
        </>
      ) : null}
      <Button variant="secondary" size="sm" asChild>
        <Link href="/billing/subscription">
          View subscription
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </Card>
  )
}
