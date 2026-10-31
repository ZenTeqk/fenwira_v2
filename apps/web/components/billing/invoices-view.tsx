'use client'

import {
  type EntitlementStatus,
  type Invoice,
  type InvoiceDetail,
  type InvoiceDisplayStatus,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_MIME_TYPES,
  submitPaymentProofRequestSchema,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  DetailDrawer,
  DetailPage,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PermissionState,
  Progress,
  SectionHeader,
  Skeleton,
  StatusBadge,
  type StatusKey,
  SummaryItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  textLink,
  toast,
} from '@fenwira/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, FileText, Receipt } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError, download, get, post } from '@/lib/api/client'
import { formatMoney, useWallet } from '@/lib/billing'
import {
  STATUS_BADGE,
  STATUS_LABEL,
  useEntitlements,
  usePlans,
  useRequestPlan,
  useSubscription,
} from '@/lib/subscription'
import { keys } from '@/lib/api/keys'

const STATUS: Record<InvoiceDisplayStatus, { status: StatusKey; label: string }> = {
  DUE: { status: 'PENDING', label: 'Due' },
  OVERDUE: { status: 'ATTENTION', label: 'Overdue' },
  PAYMENT_SUBMITTED: { status: 'PROCESSING', label: 'Verifying payment' },
  PAID: { status: 'COMPLETED', label: 'Paid' },
  VOID: { status: 'CANCELLED', label: 'Void' },
}
/** A submitted reference is only a claim: it reads "Pending verification" until an operator approves it. */
const PROOF: Record<
  InvoiceDetail['proofs'][number]['status'],
  { status: StatusKey; label: string }
> = {
  PENDING: { status: 'PENDING', label: 'Pending verification' },
  APPROVED: { status: 'APPROVED', label: 'Verified' },
  REJECTED: { status: 'REJECTED', label: 'Rejected' },
}
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'
const message = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong.')

/**
 * Billing (ADR-0027 Managed Launch Mode; `/billing/invoices`): the current plan, plans to choose,
 * usage against limits, the open invoice with its UPI QR and UTR form, all invoices, how to pay
 * and who to contact. Outside Managed Launch it is the plain invoice list.
 */
export function InvoicesView() {
  const { tenantId, can, me } = useSession()
  const managed = me.features.managedLaunch
  const params = useSearchParams()
  const router = useRouter()
  const openId = params.get('invoice')
  const list = useQuery({
    queryKey: keys.tenant(tenantId, 'invoices'),
    queryFn: () => get<{ data: Invoice[] }>('/billing/invoices').then((r) => r.data),
    enabled: can('billing.read'),
  })
  const open = (id: string | null) =>
    router.replace(id ? `/billing/invoices?invoice=${id}` : '/billing/invoices', { scroll: false })
  const internal = useSubscription().data?.internal ?? false

  if (!can('billing.read')) return <PermissionState what="billing" />
  const due = list.data?.filter((i) => i.status === 'OPEN') ?? []
  return (
    <DetailPage
      header={{
        title: managed ? 'Billing' : 'Invoices',
        description: managed
          ? 'Your plan, usage and invoices. Pay by UPI, then enter the UTR so we can confirm it.'
          : 'Payment requests for your Fenwira subscription and WhatsApp credits.',
      }}
      banner={
        <Alert tone="info" title="Meta charges are billed separately">
          WhatsApp conversation charges from Meta are billed by Meta to the payment method in your
          Meta Business account. Fenwira invoices cover only your Fenwira subscription
          {managed ? '' : ' and wallet credits'}.
        </Alert>
      }
    >
      {managed && internal ? (
        <Alert tone="info" title="Internal workspace">
          This is a Fenwira internal workspace: Business limits with every feature on, and billing
          is off.
        </Alert>
      ) : managed ? (
        <>
          <CurrentPlan hasOpenInvoice={due.length > 0} />
          {due[0] ? <OpenInvoice id={due[0].id} /> : null}
          <PlanChooser />
          <UsageMeters />
        </>
      ) : null}
      <section aria-labelledby="invoices-heading" className="flex flex-col gap-3">
        <SectionHeader id="invoices-heading" title="Invoices" />
        {list.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : list.isError ? (
          <ErrorState onRetry={() => void list.refetch()} />
        ) : list.data.length === 0 ? (
          <EmptyState
            icon={<FileText aria-hidden="true" />}
            title="No invoices yet"
            description={
              managed
                ? 'Choose a plan above to get your first invoice now, or we will send one 3 days before your trial ends. Pay it by UPI and submit the UTR.'
                : 'Payment requests from Fenwira appear here. Pay them by UPI and submit the reference number.'
            }
          />
        ) : (
          <Table containerLabel="Invoices">
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>For</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Button variant="link" className="h-auto p-0" onClick={() => open(inv.id)}>
                      {inv.number}
                    </Button>
                  </TableCell>
                  <TableCell>{inv.description}</TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                    {formatMoney(inv.totalMinor, inv.currency)}
                  </TableCell>
                  <TableCell>{day(inv.dueAt)}</TableCell>
                  <TableCell>
                    <StatusBadge {...STATUS[inv.displayStatus]} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      {managed && !internal ? <HowToPay /> : null}
      <InvoiceDrawer id={openId} onClose={() => open(null)} />
    </DetailPage>
  )
}

const PAY_PANEL_ID = 'pay-now'
const PLANS_ID = 'plans'
const scrollToId = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** Current plan: status, trial days left, next due date, price, and Upgrade / Request change. */
function CurrentPlan({ hasOpenInvoice }: { hasOpenInvoice: boolean }) {
  const { can } = useSession()
  const subscription = useSubscription()
  const plans = usePlans()
  const s = subscription.data
  if (subscription.isPending) return <Skeleton className="h-36 w-full" />
  if (subscription.isError || !s) return <ErrorState onRetry={() => void subscription.refetch()} />
  const trial = s.status === 'TRIALING'
  const plan = plans.data?.find((p) => p.key === s.plan?.key) ?? null
  const due = trial ? s.trialEndsAt : s.currentPeriodEnd
  const headline = trial
    ? `Free trial · ${s.trialDaysLeft ?? 0} day${s.trialDaysLeft === 1 ? '' : 's'} left`
    : s.plan && s.status === 'ACTIVE'
      ? `${s.plan.name} plan`
      : STATUS_LABEL[s.status]
  const detail =
    s.status === 'TRIALING'
      ? 'Upgrade any time: your paid month starts the day we confirm your payment.'
      : s.status === 'ACTIVE'
        ? s.cancelAtPeriodEnd
          ? `Ends ${day(s.currentPeriodEnd)}.`
          : 'To change plan, use Request change and we will send the invoice.'
        : s.status === 'PAST_DUE'
          ? 'Your billing period ended without a confirmed payment. Everything keeps working during the grace period. Pay the open invoice below.'
          : s.status === 'SUSPENDED'
            ? 'Sending is paused for an unpaid invoice. Inbound messages keep arriving and your data is kept. Pay to resume.'
            : 'Choose a plan to keep sending template messages and campaigns. Your data is kept.'
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold text-fg">{headline}</h2>
          <p className="max-w-2xl text-sm text-fg-secondary">{detail}</p>
        </div>
        <StatusBadge status={STATUS_BADGE[s.status]} label={STATUS_LABEL[s.status]} />
      </div>
      <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <SummaryItem label="Plan">
          {s.plan?.name ?? (trial ? 'Free trial' : 'No plan yet')}
        </SummaryItem>
        <SummaryItem label="Monthly price">
          {plan?.price
            ? formatMoney(plan.price.amountMinor, plan.price.currency)
            : trial
              ? 'Free during the trial'
              : '—'}
        </SummaryItem>
        <SummaryItem label={trial ? 'Trial ends' : 'Next payment due'}>{day(due)}</SummaryItem>
      </dl>
      {can('billing.manage') ? (
        <div className="flex flex-wrap gap-2">
          {hasOpenInvoice ? (
            <Button onClick={() => scrollToId(PAY_PANEL_ID)}>Pay now</Button>
          ) : null}
          <Button
            variant={hasOpenInvoice ? 'secondary' : 'primary'}
            onClick={() => scrollToId(PLANS_ID)}
          >
            {s.canUpgrade ? 'Upgrade' : 'Request change'}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-fg-secondary">
          The workspace owner manages the plan and payments.
        </p>
      )}
    </Card>
  )
}

/** The entitlements a plan card summarises, in this order. */
const PLAN_HIGHLIGHTS = ['max_users', 'max_contacts', 'max_active_flows'] as const
const count = (n: number) => n.toLocaleString('en-IN')
const HIGHLIGHT: Record<(typeof PLAN_HIGHLIGHTS)[number], (v: unknown) => string> = {
  max_users: (v) => (v === null ? 'Unlimited team members' : `${count(Number(v))} team members`),
  max_contacts: (v) => (v === null ? 'Unlimited contacts' : `${count(Number(v))} contacts`),
  max_active_flows: (v) =>
    v === null ? 'Unlimited active automations' : `${count(Number(v))} active automations`,
}

/** Three plans: Choose plan (no active plan: invoice at once) or Request change (paid plan). */
function PlanChooser() {
  const { tenantId, can } = useSession()
  const queryClient = useQueryClient()
  const subscription = useSubscription()
  const plans = usePlans()
  const request = useRequestPlan()
  const choose = useMutation({
    mutationFn: (planId: string) =>
      post<{ data: InvoiceDetail }>('/billing/subscription/upgrade', { planId }).then(
        (r) => r.data,
      ),
    onSuccess: async (inv) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'invoices') }),
        queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'subscription') }),
      ])
      toast.success(`Invoice ${inv.number} is ready. Scan the QR to pay.`)
      requestAnimationFrame(() => scrollToId(PAY_PANEL_ID))
    },
    onError: (err) => toast.error(message(err)),
  })
  const s = subscription.data
  if (plans.isPending || !s) return <Skeleton className="h-56 w-full" />
  if (plans.isError) return <ErrorState onRetry={() => void plans.refetch()} />
  const manage = can('billing.manage')
  return (
    <section
      id={PLANS_ID}
      aria-labelledby="plans-heading"
      className="flex scroll-mt-6 flex-col gap-3"
    >
      <SectionHeader
        id="plans-heading"
        title="Plans"
        description={
          s.canUpgrade
            ? 'Choose a plan to get its invoice now. The paid month starts when we confirm your payment; the rest of the trial is not added.'
            : 'Changing plan? Request it and the Fenwira team will send the invoice.'
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        {plans.data.map((p) => {
          const current = s.status === 'ACTIVE' && s.plan?.id === p.id
          const requested = !s.canUpgrade && s.requestedPlan?.id === p.id
          return (
            <Card key={p.id} className="flex flex-col gap-4 p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-md font-semibold text-fg">{p.name}</h3>
                {current ? <StatusBadge status="ACTIVE" label="Current plan" /> : null}
                {requested && !current ? <StatusBadge status="PENDING" label="Requested" /> : null}
              </div>
              <p className="text-xl font-semibold text-fg">
                {p.price ? formatMoney(p.price.amountMinor, p.price.currency) : 'Contact us'}
                {p.price ? (
                  <span className="text-sm font-normal text-fg-secondary"> / month</span>
                ) : null}
              </p>
              <ul className="flex flex-col gap-1.5 text-sm text-fg">
                {PLAN_HIGHLIGHTS.filter((k) => k in p.entitlements).map((k) => (
                  <li key={k}>{HIGHLIGHT[k](p.entitlements[k])}</li>
                ))}
                <li>{p.entitlements.api_enabled ? 'API and webhooks' : 'No API or webhooks'}</li>
              </ul>
              {manage && !current ? (
                s.canUpgrade ? (
                  <Button
                    className="mt-auto"
                    disabled={!p.price || choose.isPending}
                    loading={choose.isPending && choose.variables === p.id}
                    onClick={() => choose.mutate(p.id)}
                  >
                    Choose {p.name}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    className="mt-auto"
                    disabled={requested}
                    loading={request.isPending && request.variables === p.id}
                    onClick={() =>
                      request.mutate(p.id, {
                        onSuccess: () =>
                          toast.success(`${p.name} requested. We will send the invoice.`),
                        onError: (err) => toast.error(message(err)),
                      })
                    }
                  >
                    {requested ? 'Requested' : 'Request change'}
                  </Button>
                )
              ) : null}
            </Card>
          )
        })}
      </div>
    </section>
  )
}

/** Usage against the plan: team members, contacts and active automations. */
const METERS = ['max_users', 'max_contacts', 'max_active_flows'] as const
function UsageMeters() {
  const ents = useEntitlements()
  if (ents.isPending) return <Skeleton className="h-32 w-full" />
  if (ents.isError) return <ErrorState onRetry={() => void ents.refetch()} />
  const rows = METERS.map((k) => ents.data.find((e) => e.key === k)).filter(
    (e): e is EntitlementStatus => Boolean(e),
  )
  return (
    <section aria-labelledby="usage-heading" className="flex flex-col gap-3">
      <SectionHeader id="usage-heading" title="Usage" />
      <Card className="grid gap-5 p-5 md:grid-cols-3">
        {rows.map((e) => (
          <div key={e.key} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-fg">{e.label}</span>
              <span className="text-fg-secondary">
                {e.limit === null
                  ? `${count(e.usage ?? 0)} · unlimited`
                  : `${count(e.usage ?? 0)} of ${count(e.limit)}`}
              </span>
            </div>
            {e.limit !== null ? (
              <Progress
                label={`${e.label} used`}
                value={e.usage ?? 0}
                max={e.limit}
                tone={e.overLimit ? 'warning' : 'primary'}
              />
            ) : null}
            {e.overLimit ? <StatusBadge status="ATTENTION" label="Over limit" /> : null}
          </div>
        ))}
      </Card>
    </section>
  )
}

/** How to pay, the confirmation promise (config) and the support contact (config). */
function HowToPay() {
  const subscription = useSubscription()
  const wallet = useWallet()
  const hours = subscription.data?.paymentConfirmHours ?? null
  const support = wallet.data?.support
  const href = support?.url ?? (support?.email ? `mailto:${support.email}` : null)
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-md font-semibold text-fg">How to pay</h2>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-fg">
        <li>
          Open the invoice under Pay now and scan the QR with any UPI app (or copy the UPI link).
        </li>
        <li>Check the amount and the invoice number in the note, then pay.</li>
        <li>
          Copy the 12-digit UTR from your UPI app and submit it here, with a screenshot if you like.
        </li>
        <li>
          We confirm the payment by hand and email your receipt. Your plan starts on confirmation.
        </li>
      </ol>
      {hours ? (
        <p className="text-sm text-fg-secondary">
          We confirm payments within {hours} hour{hours === 1 ? '' : 's'}.
        </p>
      ) : null}
      <p className="text-sm text-fg-secondary">
        Questions about a payment?{' '}
        {href ? (
          <a
            href={href}
            className={`font-medium ${textLink}`}
            {...(support?.url ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {support?.email ?? 'Contact billing'}
          </a>
        ) : (
          'Contact the Fenwira team.'
        )}
      </p>
    </Card>
  )
}

/** Managed Launch: the open payment request shown in full (UPI QR, copyable link, UTR form). */
function OpenInvoice({ id }: { id: string }) {
  const { tenantId } = useSession()
  const detail = useQuery({
    queryKey: keys.tenant(tenantId, 'invoices', id),
    queryFn: () => get<{ data: InvoiceDetail }>(`/billing/invoices/${id}`).then((r) => r.data),
  })
  if (detail.isPending) return <Skeleton className="h-64 w-full" />
  if (detail.isError) return <ErrorState onRetry={() => void detail.refetch()} />
  return (
    <Card id={PAY_PANEL_ID} className="flex scroll-mt-6 flex-col gap-4 p-5">
      <SectionHeader
        title="Pay now"
        description={`${detail.data.number}: ${detail.data.description}`}
      />
      <InvoiceBody inv={detail.data} />
    </Card>
  )
}

function InvoiceDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { tenantId } = useSession()
  const detail = useQuery({
    queryKey: keys.tenant(tenantId, 'invoices', id ?? ''),
    queryFn: () => get<{ data: InvoiceDetail }>(`/billing/invoices/${id}`).then((r) => r.data),
    enabled: Boolean(id),
  })
  const inv = detail.data
  return (
    <DetailDrawer
      open={Boolean(id)}
      onOpenChange={(v) => !v && onClose()}
      title={inv ? `Invoice ${inv.number}` : 'Invoice'}
      description={inv?.description}
    >
      {detail.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : detail.isError ? (
        <ErrorState onRetry={() => void detail.refetch()} />
      ) : inv ? (
        <InvoiceBody inv={inv} />
      ) : null}
    </DetailDrawer>
  )
}

function InvoiceBody({ inv }: { inv: InvoiceDetail }) {
  const { can } = useSession()
  const pending = inv.proofs.find((p) => p.status === 'PENDING')
  const doc = (kind: 'document' | 'receipt') =>
    download(
      `/billing/invoices/${inv.id}/${kind}?download=1`,
      undefined,
      `${kind === 'receipt' ? (inv.receiptNumber ?? 'receipt') : inv.number}.html`,
      'GET',
    ).catch((err: unknown) => toast.error(message(err)))
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-border-subtle bg-surface-muted p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm text-fg-secondary">
            {inv.status === 'PAID'
              ? 'Amount paid'
              : inv.taxLines.length
                ? 'Total to pay'
                : 'Amount to pay'}
          </span>
          <span className="text-2xl font-semibold break-all text-fg tabular-nums">
            {formatMoney(inv.totalMinor, inv.currency)}
          </span>
          <span className="text-sm text-fg-secondary">
            {inv.currency} · {inv.kind === 'PLAN_RENEWAL' ? 'Plan' : 'Wallet credits'}
          </span>
        </div>
        <StatusBadge {...STATUS[inv.displayStatus]} />
      </div>
      <dl className="grid grid-cols-2 gap-4">
        <SummaryItem label="Due">{day(inv.dueAt)}</SummaryItem>
        <SummaryItem label="Issued">{day(inv.issuedAt)}</SummaryItem>
        {inv.paidAt ? <SummaryItem label="Paid on">{day(inv.paidAt)}</SummaryItem> : null}
        {inv.taxLines.length ? (
          <SummaryItem label="Amount (before GST)">
            {formatMoney(inv.subtotalMinor, inv.currency)}
          </SummaryItem>
        ) : null}
        {inv.taxLines.map((t) => (
          <SummaryItem key={t.label} label={t.label}>
            {formatMoney(t.amountMinor, inv.currency)}
          </SummaryItem>
        ))}
        {inv.receiptNumber ? <SummaryItem label="Receipt">{inv.receiptNumber}</SummaryItem> : null}
        {inv.voidReason ? <SummaryItem label="Void reason">{inv.voidReason}</SummaryItem> : null}
      </dl>

      {inv.upi && !pending ? (
        <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL QR code */}
          <img
            src={inv.upi.qrDataUrl}
            alt={`UPI QR code to pay ${formatMoney(inv.totalMinor, inv.currency)} for ${inv.number}`}
            width={256}
            height={256}
            // The PNG carries its own white quiet zone; shown unscaled-looking and square.
            className="size-64 shrink-0 self-center rounded-md border border-border-subtle [image-rendering:pixelated]"
          />
          <div className="flex min-w-0 flex-col gap-3">
            <p className="font-medium text-fg">Scan with any UPI app</p>
            <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-fg-secondary">Pay to</dt>
              <dd className="col-span-2 min-w-0 text-fg">{inv.payee.name}</dd>
              <dt className="text-fg-secondary">UPI ID</dt>
              <dd className="col-span-2 min-w-0 font-mono break-all text-fg">{inv.payee.vpa}</dd>
              <dt className="text-fg-secondary">Amount</dt>
              <dd className="col-span-2 min-w-0 font-medium text-fg tabular-nums">
                {formatMoney(inv.totalMinor, inv.currency)}
              </dd>
              <dt className="text-fg-secondary">Note</dt>
              <dd className="col-span-2 min-w-0 font-mono text-fg">{inv.number}</dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <a href={inv.upi.deepLink}>Open in UPI app</a>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(inv.upi!.deepLink)
                    .then(() => toast.success('UPI payment link copied'))
                }
              >
                <Copy aria-hidden="true" />
                Copy UPI link
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {pending ? (
        <Alert tone="info" title="We're verifying your payment">
          UTR <span className="font-mono">{pending.utr}</span>, submitted {day(pending.submittedAt)}
          . It isn&apos;t confirmed until we match it with our bank statement; you&apos;ll be
          notified once it is.
        </Alert>
      ) : null}
      {inv.status === 'OPEN' && !pending ? (
        can('billing.manage') ? (
          <ProofForm invoiceId={inv.id} />
        ) : (
          <p className="text-sm text-fg-secondary">
            The workspace owner submits the payment reference after paying.
          </p>
        )
      ) : null}

      {inv.proofs.length ? (
        <section aria-labelledby="proofs-heading" className="flex flex-col gap-2">
          <h3 id="proofs-heading" className="text-md font-semibold text-fg">
            Payment submissions
          </h3>
          <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
            {inv.proofs.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <StatusBadge {...PROOF[p.status]} />
                  <span className="font-mono break-all text-fg">UTR {p.utr}</span>
                  <span className="text-fg-secondary">Submitted {day(p.submittedAt)}</span>
                </div>
                {p.rejectionReason ? (
                  <p className="text-fg-secondary">Reason: {p.rejectionReason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void doc('document')}>
          <Download aria-hidden="true" />
          Payment request
        </Button>
        {inv.status === 'PAID' ? (
          <Button variant="secondary" size="sm" onClick={() => void doc('receipt')}>
            <Receipt aria-hidden="true" />
            Receipt
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ProofForm({ invoiceId }: { invoiceId: string }) {
  const { tenantId } = useSession()
  const queryClient = useQueryClient()
  const [utr, setUtr] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    const parsed = submitPaymentProofRequestSchema.shape.utr.safeParse(utr)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the UTR.')
    if (file && !(PAYMENT_PROOF_MIME_TYPES as readonly string[]).includes(file.type))
      return setError('Attach a PNG, JPEG or PDF.')
    if (file && file.size > PAYMENT_PROOF_MAX_BYTES)
      return setError('The screenshot must be 5 MB or smaller.')
    setBusy(true)
    try {
      let fileId: string | undefined
      if (file) {
        const up = await post<{
          data: { fileId: string; url: string; headers: Record<string, string> }
        }>(`/billing/invoices/${invoiceId}/proof-uploads`, {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        })
        const put = await fetch(up.data.url, {
          method: 'PUT',
          headers: up.data.headers,
          body: file,
        })
        if (!put.ok) throw new Error('upload')
        fileId = up.data.fileId
      }
      await post(`/billing/invoices/${invoiceId}/proofs`, {
        utr: parsed.data,
        ...(fileId ? { fileId } : {}),
      })
      toast.success('Payment submitted. We will confirm it shortly.')
      setUtr('')
      setFile(null)
      void queryClient.invalidateQueries({ queryKey: keys.tenant(tenantId, 'invoices') })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The screenshot could not be uploaded.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-labelledby="proof-heading">
      <h3 id="proof-heading" className="text-md font-semibold text-fg">
        Already paid? Confirm your payment
      </h3>
      <Field label="UTR / UPI reference number" hint="12 digits in most UPI apps" required>
        <Input
          required
          autoComplete="off"
          value={utr}
          onChange={(e) => setUtr(e.target.value)}
          aria-invalid={Boolean(error)}
        />
      </Field>
      <Field label="Screenshot (optional)" hint="PNG, JPEG or PDF, up to 5 MB">
        <Input
          type="file"
          accept={PAYMENT_PROOF_MIME_TYPES.join(',')}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-status-error-fg">
          {error}
        </p>
      ) : null}
      <Button type="submit" loading={busy} className="self-start">
        Submit payment
      </Button>
    </form>
  )
}
