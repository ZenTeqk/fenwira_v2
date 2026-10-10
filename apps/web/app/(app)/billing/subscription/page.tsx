'use client'

import { type EntitlementStatus, type Plan } from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  ErrorState,
  PermissionState,
  SettingsPage,
  Skeleton,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import Link from 'next/link'
import { useSession } from '@/components/session/session-provider'
import { ApiError } from '@/lib/api/client'
import {
  STATUS_LABEL,
  useEntitlements,
  usePlans,
  useRequestPlan,
  useSubscription,
} from '@/lib/subscription'

const fmt = (n: number) => n.toLocaleString('en-IN')
const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** The entitlements a plan card summarises, in this order. */
const PLAN_HIGHLIGHTS = ['max_users', 'max_contacts', 'max_active_flows', 'analytics_retention']
const HIGHLIGHT_LABEL: Record<string, (v: unknown) => string> = {
  max_users: (v) => (v === null ? 'Unlimited team members' : `${fmt(Number(v))} team members`),
  max_contacts: (v) => (v === null ? 'Unlimited contacts' : `${fmt(Number(v))} contacts`),
  max_active_flows: (v) =>
    v === null ? 'Unlimited active automations' : `${fmt(Number(v))} active automations`,
  analytics_retention: (v) =>
    v === null ? 'Full analytics history' : `${fmt(Number(v))} days of analytics`,
}

function LimitRow({ e }: { e: EntitlementStatus }) {
  const pct = e.limit && e.usage !== null ? Math.min(100, Math.round((e.usage / e.limit) * 100)) : 0
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-slate">{e.label}</span>
        <span className="flex items-center gap-2 text-sm text-secondary">
          {e.limit === null
            ? e.usage === null
              ? 'Unlimited'
              : `${fmt(e.usage)} · unlimited`
            : e.usage === null
              ? fmt(e.limit)
              : `${fmt(e.usage)} of ${fmt(e.limit)}`}
          {e.overLimit ? <StatusBadge status="ATTENTION" label="Over limit" /> : null}
        </span>
      </div>
      {e.limit !== null && e.usage !== null ? (
        <div
          role="progressbar"
          aria-label={`${e.label} used`}
          aria-valuemin={0}
          aria-valuemax={e.limit}
          aria-valuenow={Math.min(e.usage, e.limit)}
          className="h-1.5 overflow-hidden rounded-full bg-neutral-soft"
        >
          <div
            className={e.overLimit || pct >= 90 ? 'h-full bg-warning' : 'h-full bg-primary'}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {e.overLimit ? (
        <p className="text-sm text-secondary">
          Nothing is removed. Adding more is paused until usage is back within the limit or the plan
          changes; incoming messages and customers are never refused.
        </p>
      ) : null}
    </li>
  )
}

function PlanCard({
  plan,
  current,
  requested,
  canRequest,
  onRequest,
  busy,
}: {
  plan: Plan
  current: boolean
  requested: boolean
  canRequest: boolean
  onRequest: () => void
  busy: boolean
}) {
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-md font-semibold text-slate">{plan.name}</h3>
        {current ? <StatusBadge status="ACTIVE" label="Current plan" /> : null}
        {requested && !current ? <StatusBadge status="PENDING" label="Requested" /> : null}
      </div>
      <p className="text-sm text-secondary">
        {plan.price
          ? `${(plan.price.amountMinor / 100).toLocaleString('en-IN')} ${plan.price.currency} / month`
          : 'Pricing: contact us'}
      </p>
      <ul className="flex flex-col gap-1.5 text-sm text-slate">
        {PLAN_HIGHLIGHTS.filter((k) => k in plan.entitlements).map((k) => (
          <li key={k}>{HIGHLIGHT_LABEL[k]!(plan.entitlements[k])}</li>
        ))}
        <li>{plan.entitlements.api_enabled ? 'API and webhooks' : 'No API or webhooks'}</li>
      </ul>
      {canRequest && !current ? (
        <Button
          variant="secondary"
          className="mt-auto"
          loading={busy}
          disabled={requested}
          onClick={onRequest}
        >
          {requested ? 'Requested' : `Request ${plan.name}`}
        </Button>
      ) : null}
    </Card>
  )
}

/** Subscription (Phase 11 Step 4): plan, trial and limits. Wallet credits are separate. */
export default function SubscriptionPage() {
  const { can } = useSession()
  const sub = useSubscription()
  const plans = usePlans()
  const ents = useEntitlements()
  const request = useRequestPlan()

  if (!can('billing.read'))
    return <PermissionState what="the subscription" permission="billing.read" />
  if (sub.isLoading || plans.isLoading || ents.isLoading) return <Skeleton className="h-64" />
  if (sub.isError || plans.isError || ents.isError || !sub.data)
    return (
      <ErrorState
        onRetry={() => void Promise.all([sub.refetch(), plans.refetch(), ents.refetch()])}
      />
    )

  const s = sub.data
  const limits = (ents.data ?? []).filter(
    (e) => e.kind === 'limit' && (e.limit !== null || e.usage !== null),
  )
  const capabilities = (ents.data ?? []).filter((e) => e.kind === 'capability')
  const inactive = s.status === 'EXPIRED' || s.status === 'CANCELLED'

  const headline =
    s.status === 'TRIALING'
      ? `Trial · ${s.trialDaysLeft ?? 0} day${s.trialDaysLeft === 1 ? '' : 's'} left`
      : s.plan
        ? `${s.plan.name} plan`
        : STATUS_LABEL[s.status]
  const detail =
    s.status === 'TRIALING' && s.trialEndsAt
      ? `Includes Growth-level features until ${date(s.trialEndsAt)}.`
      : s.status === 'ACTIVE' && s.currentPeriodEnd
        ? s.cancelAtPeriodEnd
          ? `Ends ${date(s.currentPeriodEnd)}.`
          : `Monthly · renews ${date(s.currentPeriodEnd)}.`
        : inactive
          ? 'Template messages, campaigns, API keys and webhooks are paused. Your data is kept and inbound messages keep arriving.'
          : ''

  return (
    <SettingsPage
      header={{
        title: 'Subscription',
        description: 'Your plan, what it includes, and how much of it you are using.',
      }}
      banner={
        s.requestedPlan ? (
          <Alert tone="info" title={`${s.requestedPlan.name} requested`}>
            The Fenwira team activates plans and will be in touch. You can keep working meanwhile.
          </Alert>
        ) : null
      }
    >
      <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate">{headline}</h2>
          {detail ? <p className="max-w-xl text-base text-secondary">{detail}</p> : null}
        </div>
        <StatusBadge
          status={inactive ? 'EXPIRED' : s.status === 'TRIALING' ? 'PENDING' : 'ACTIVE'}
          label={STATUS_LABEL[s.status]}
        />
      </Card>

      <section aria-labelledby="limits-heading" className="flex flex-col gap-1">
        <h2 id="limits-heading" className="text-md font-semibold text-slate">
          Limits
        </h2>
        <ul className="divide-y divide-border">
          {limits.map((e) => (
            <LimitRow key={e.key} e={e} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="features-heading" className="flex flex-col gap-3">
        <h2 id="features-heading" className="text-md font-semibold text-slate">
          Features
        </h2>
        <ul className="flex flex-wrap gap-2">
          {capabilities.map((e) => (
            <li key={e.key}>
              <StatusBadge
                status={e.enabled ? 'ACTIVE' : 'INACTIVE'}
                label={`${e.label}: ${e.enabled ? 'included' : 'not included'}`}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="plans-heading" className="flex flex-col gap-3">
        <h2 id="plans-heading" className="text-md font-semibold text-slate">
          Plans
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {(plans.data ?? []).map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              current={s.status === 'ACTIVE' && s.plan?.id === p.id}
              requested={s.requestedPlan?.id === p.id}
              canRequest={can('billing.manage')}
              busy={request.isPending && request.variables === p.id}
              onRequest={() =>
                request.mutate(p.id, {
                  onSuccess: () =>
                    toast.success(`${p.name} requested — the Fenwira team will activate it`),
                  onError: (err) =>
                    toast.error(
                      err instanceof ApiError ? err.message : 'Could not request the plan.',
                    ),
                })
              }
            />
          ))}
        </div>
      </section>

      <p className="text-sm text-secondary">
        Wallet credits pay for WhatsApp messages and are separate from your plan.{' '}
        <Link
          href="/billing/wallet"
          className="font-medium text-slate underline underline-offset-4"
        >
          View wallet
        </Link>
      </p>
    </SettingsPage>
  )
}
