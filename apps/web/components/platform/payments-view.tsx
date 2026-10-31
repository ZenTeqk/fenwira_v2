'use client'
import {
  approvePaymentRequestSchema,
  billingDashboardSchema,
  paymentReviewResultSchema,
  rejectPaymentRequestSchema,
  type PendingPayment,
} from '@fenwira/contracts'
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailDrawer,
  EmptyState,
  ErrorState,
  Field,
  Input,
  ListPage,
  MetricCard,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  textLink,
  toast,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { z } from 'zod'
import { errorText } from '@/lib/api/client'
import { platformMoney, platformRequest } from '@/lib/platform'
import { useIdentityRequest } from './identity'
import { usePlatform } from './platform-shell'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')
const failure = (err: unknown) => errorText(err, 'The request failed. Try again.')

/**
 * ADR-0027 manual UPI billing — the operator's payments dashboard: proofs waiting for
 * verification (oldest first), overdue workspaces and revenue by month. Approving checks the UTR
 * against the bank statement; approval is idempotent and applies the subscription or wallet
 * change in the same transaction as its receipt.
 */
export function PaymentsView() {
  const me = usePlatform()
  const queryClient = useQueryClient()
  const canManage = me?.permissions.includes('payments.manage') ?? false
  const dashboard = useQuery({
    queryKey: ['platform', 'billing-dashboard'],
    retry: false,
    queryFn: async () => billingDashboardSchema.parse(await platformRequest('/billing/dashboard')),
  })
  const [reviewing, setReviewing] = useState<{
    p: PendingPayment
    mode: 'approve' | 'reject'
  } | null>(null)
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['platform', 'billing-dashboard'] })

  async function screenshot(p: PendingPayment) {
    try {
      const file = z
        .object({ url: z.string() })
        .parse(
          await platformRequest(`/workspaces/${p.workspaceId}/payment-proofs/${p.proofId}/file`),
        )
      window.open(file.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(failure(err))
    }
  }

  if (dashboard.isPending) return <Skeleton className="h-64 w-full" />
  if (dashboard.isError) return <ErrorState onRetry={() => void dashboard.refetch()} />
  const { pending, overdue, revenue } = dashboard.data
  const thisMonth = revenue[0]
  return (
    <ListPage
      header={{
        title: 'Payments',
        description:
          'Verify UPI payments: match each UTR and amount with the bank statement, then approve or reject. Also overdue workspaces and revenue. See docs/MANAGED_LAUNCH.md § 3 steps 8–9.',
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Waiting for verification" value={String(pending.length)} />
        <MetricCard label="Overdue or suspended workspaces" value={String(overdue.length)} />
        <MetricCard
          label="Collected this month"
          value={thisMonth ? platformMoney(thisMonth.totalMinor, thisMonth.currency) : '—'}
        />
      </div>

      <section aria-labelledby="queue-heading" className="flex flex-col gap-3">
        <h2 id="queue-heading" className="text-lg font-semibold">
          Payment queue
        </h2>
        {pending.length === 0 ? (
          <EmptyState title="Nothing to verify" description="New payment proofs appear here." />
        ) : (
          <Table containerLabel="Payment proofs waiting for verification">
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>UTR</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((p) => (
                <TableRow key={p.proofId}>
                  <TableCell>
                    <Link href={`/platform/workspaces/${p.workspaceId}`} className={textLink}>
                      {p.workspaceName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {p.invoiceNumber}
                    <span className="block text-sm text-fg-secondary">
                      {p.kind === 'PLAN_RENEWAL' ? 'Plan renewal' : 'Wallet top-up'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                    {platformMoney(p.totalMinor, p.currency)}
                  </TableCell>
                  <TableCell className="font-mono">{p.utr}</TableCell>
                  <TableCell>{when(p.submittedAt)}</TableCell>
                  <TableCell>
                    <StatusBadge status="PENDING" label="Pending verification" />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {p.hasFile ? (
                        <Button size="sm" variant="ghost" onClick={() => void screenshot(p)}>
                          Screenshot
                        </Button>
                      ) : null}
                      {canManage ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => setReviewing({ p, mode: 'approve' })}
                            aria-label={`Approve ${p.invoiceNumber}`}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setReviewing({ p, mode: 'reject' })}
                            aria-label={`Reject ${p.invoiceNumber}`}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Overdue workspaces</CardTitle>
          </CardHeader>
          <CardContent>
            {overdue.length === 0 ? (
              <p className="text-sm text-fg-secondary">No overdue workspaces.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {overdue.map((o) => (
                  <li key={o.workspaceId} className="flex flex-wrap items-center gap-2">
                    <Link href={`/platform/workspaces/${o.workspaceId}`} className={textLink}>
                      {o.workspaceName}
                    </Link>
                    {o.subscriptionStatus === 'SUSPENDED' ? (
                      <StatusBadge status="PAUSED" label="Suspended" />
                    ) : o.subscriptionStatus === 'PAST_DUE' ? (
                      <StatusBadge status="ATTENTION" label="Past due" />
                    ) : null}
                    <span className="text-sm text-fg-secondary">
                      {o.openInvoices} open · {platformMoney(o.openTotalMinor)} · due since{' '}
                      {when(o.oldestDueAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Revenue by month</CardTitle>
          </CardHeader>
          <CardContent>
            {revenue.length === 0 ? (
              <p className="text-sm text-fg-secondary">No payments approved yet.</p>
            ) : (
              <Table containerLabel="Revenue by month">
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Payments</TableHead>
                    <TableHead>Collected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenue.map((r) => (
                    <TableRow key={`${r.month}-${r.currency}`}>
                      <TableCell>{r.month}</TableCell>
                      <TableCell>{r.payments}</TableCell>
                      <TableCell>{platformMoney(r.totalMinor, r.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="mt-3 text-sm text-fg-secondary">
              Fenwira subscription and wallet payments only. Meta bills conversation charges to each
              customer directly.
            </p>
          </CardContent>
        </Card>
      </div>

      <ReviewDrawer
        review={reviewing}
        onClose={() => setReviewing(null)}
        onDone={() => {
          setReviewing(null)
          refresh()
        }}
      />
    </ListPage>
  )
}

/** What is being approved or rejected, stated once and unambiguously before the decision. */
function PaymentTarget({ p }: { p: PendingPayment }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border-subtle bg-surface-muted p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-fg-secondary">Amount claimed</span>
          <span className="text-2xl font-semibold break-all text-fg tabular-nums">
            {platformMoney(p.totalMinor, p.currency)}
          </span>
        </div>
        <StatusBadge status="PENDING" label="Pending verification" />
      </div>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-fg-secondary">Workspace</dt>
        <dd className="col-span-2 min-w-0 font-medium break-words text-fg">{p.workspaceName}</dd>
        <dt className="text-fg-secondary">Invoice</dt>
        <dd className="col-span-2 min-w-0 text-fg">
          <span className="font-mono">{p.invoiceNumber}</span> ·{' '}
          {p.kind === 'PLAN_RENEWAL' ? 'Plan renewal' : 'Wallet top-up'}
        </dd>
        <dt className="text-fg-secondary">UTR</dt>
        <dd className="col-span-2 min-w-0 font-mono break-all text-fg">{p.utr}</dd>
        <dt className="text-fg-secondary">Submitted</dt>
        <dd className="col-span-2 min-w-0 text-fg">{when(p.submittedAt)}</dd>
      </dl>
    </div>
  )
}

export function ReviewDrawer({
  review,
  onClose,
  onDone,
}: {
  review: { p: PendingPayment; mode: 'approve' | 'reject' } | null
  onClose: () => void
  onDone: () => void
}) {
  const request = useIdentityRequest()
  const [reference, setReference] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const approve = review?.mode === 'approve'
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!review) return
    setBusy(true)
    setError('')
    try {
      const base = `/workspaces/${review.p.workspaceId}/payment-proofs/${review.p.proofId}`
      const result = paymentReviewResultSchema.parse(
        approve
          ? await request(
              `${base}/approve`,
              approvePaymentRequestSchema.parse({ reference, ...(text ? { note: text } : {}) }),
            )
          : await request(`${base}/reject`, rejectPaymentRequestSchema.parse({ reason: text })),
      )
      toast.success(
        approve
          ? `Approved · receipt ${result.receiptNumber ?? ''}`
          : `Rejected ${review.p.invoiceNumber}`,
      )
      setReference('')
      setText('')
      onDone()
    } catch (err) {
      setError(err instanceof z.ZodError ? 'Fill in the required fields.' : failure(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <DetailDrawer
      open={review !== null}
      onOpenChange={(v) => {
        if (!v && !busy) {
          setError('')
          onClose()
        }
      }}
      title={approve ? 'Approve payment' : 'Reject payment'}
      description={review ? `${review.p.workspaceName} · ${review.p.invoiceNumber}` : undefined}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {review ? <PaymentTarget p={review.p} /> : null}
        {approve ? (
          <>
            <Alert tone="info" title="Match the bank statement first">
              Approve only after this UTR and amount appear in the receiving account. Approval
              {review?.p.kind === 'PLAN_RENEWAL'
                ? ' renews or activates the plan'
                : ' credits the wallet'}{' '}
              immediately and issues a receipt. It can&apos;t be undone here.
            </Alert>
            <Field label="Bank statement reference" required>
              <Input required value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Note (optional)">
              <Input value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Reason shown to the customer" required>
            <Input required value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        {error ? (
          <Alert tone="danger" title="Not saved">
            {error}
          </Alert>
        ) : null}
        <Button type="submit" variant={approve ? 'primary' : 'danger'} loading={busy}>
          {approve ? 'Approve payment' : 'Reject payment'}
        </Button>
      </form>
    </DetailDrawer>
  )
}
