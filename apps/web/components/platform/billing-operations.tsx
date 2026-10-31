'use client'
import {
  billingDashboardSchema,
  invoiceReminderResultSchema,
  platformOverviewSchema,
  type PendingPayment,
} from '@fenwira/contracts'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  ListPage,
  MetricCard,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  StatusBadge,
  TableRow,
  toast,
  TrendChart,
  textLink,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { type ReactNode, useState } from 'react'
import { errorText } from '@/lib/api/client'
import { formatMoney } from '@/lib/billing'
import { platformMoney, platformRequest } from '@/lib/platform'
import { CreateInvoiceFlow } from './create-invoice'
import { useIdentityRequest } from './identity'
import { ReviewDrawer } from './payments-view'
import { usePlatform } from './platform-shell'
import { useWorkspaceList } from './workspace-search'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')
const STATUS_LABEL: Record<string, string> = {
  TRIALING: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  NONE: 'No subscription',
}

export function reminderMessage(workspace: string, amountMinor: string, dueAt: string | null) {
  return [
    `Hello from Fenwira. A payment of ${platformMoney(amountMinor)} for ${workspace} is ${dueAt && new Date(dueAt).getTime() < Date.now() ? `overdue since ${new Date(dueAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : 'waiting'}.`,
    `Pay by UPI in Fenwira → Billing → Invoices: ${window.location.origin}/billing/invoices`,
    'After paying, enter the UTR from your bank on that page so we can confirm it.',
  ].join('\n')
}

const lastReminded = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : 'Never'

/**
 * Send reminder emails every open invoice of the workspace to its billing members (once per
 * invoice per day); Copy text gives the same message for WhatsApp or a personal email.
 */
function ReminderActions({
  id,
  name,
  canSend,
  text,
  onSent,
}: {
  id: string
  name: string
  canSend: boolean
  text: string
  onSent: () => void
}) {
  const request = useIdentityRequest()
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true)
    try {
      const r = invoiceReminderResultSchema.parse(
        await request(`/workspaces/${id}/invoices/remind`, {}),
      )
      toast.success(
        r.sent
          ? `Reminder emailed to ${name} for ${r.sent} invoice${r.sent === 1 ? '' : 's'}.`
          : `${name} was already reminded today; no new email sent.`,
      )
      onSent()
    } catch (err) {
      toast.error(errorText(err, 'The reminder was not sent. Try again.'))
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Reminder copied. Paste it into WhatsApp or email.')
    } catch {
      toast.error('Copy failed.')
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {canSend ? (
        <Button
          size="sm"
          loading={busy}
          aria-label={`Send reminder to ${name}`}
          onClick={() => void send()}
        >
          Send reminder
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Copy reminder for ${name}`}
        onClick={() => void copy()}
      >
        Copy text
      </Button>
    </div>
  )
}

/**
 * Billing operations (ADR-0027 manual UPI): what needs money attention today, each with its
 * one-click next step. Rare manual corrections stay on the workspace page (Billing adjustments).
 */
export function BillingOperations() {
  const me = usePlatform()
  const cache = useQueryClient()
  const canManage = me?.permissions.includes('payments.manage') ?? false
  const overview = useQuery({
    queryKey: ['platform', 'overview'],
    retry: false,
    queryFn: async () => platformOverviewSchema.parse(await platformRequest('/overview')),
  })
  const dashboard = useQuery({
    queryKey: ['platform', 'billing-dashboard'],
    retry: false,
    queryFn: async () => billingDashboardSchema.parse(await platformRequest('/billing/dashboard')),
  })
  const list = useWorkspaceList()
  const [invoiceFor, setInvoiceFor] = useState<{ id: string; name: string } | null | 'pick'>(null)
  const [reviewing, setReviewing] = useState<{
    p: PendingPayment
    mode: 'approve' | 'reject'
  } | null>(null)
  const refresh = () =>
    void Promise.all(
      [
        ['platform', 'billing-dashboard'],
        ['platform', 'overview'],
        ['platform', 'workspace-list'],
      ].map((queryKey) => cache.invalidateQueries({ queryKey })),
    )

  const header = {
    title: 'Billing operations',
    description:
      'Money that needs attention: payments to verify, overdue workspaces, trials ending and unpaid invoices, each with its next step. See docs/MANAGED_LAUNCH.md § 4 Billing operations.',
    actions: canManage ? (
      <Button onClick={() => setInvoiceFor('pick')}>Create invoice</Button>
    ) : undefined,
  }
  if (overview.isPending || dashboard.isPending || list.isPending)
    return (
      <ListPage header={header}>
        <Skeleton className="h-64 w-full" />
      </ListPage>
    )
  if (overview.isError || dashboard.isError || list.isError)
    return (
      <ListPage header={header}>
        <ErrorState
          onRetry={() =>
            void Promise.all([overview.refetch(), dashboard.refetch(), list.refetch()])
          }
        />
      </ListPage>
    )
  const o = overview.data,
    { pending, overdue, revenue } = dashboard.data
  const mrr = o.mrr.find((m) => m.currency === 'INR')
  const unpaid = list.data.filter((w) => w.openInvoices > 0)
  const byId = new Map(list.data.map((w) => [w.id, w]))
  const unpaidTotal = unpaid.reduce((n, w) => n + BigInt(w.openTotalMinor), 0n)
  const statusOrder = [
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'SUSPENDED',
    'EXPIRED',
    'CANCELLED',
    'NONE',
  ]

  return (
    <ListPage header={header}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="MRR"
          value={mrr ? formatMoney(mrr.amountMinor, 'INR') : '₹0'}
          hint={`${mrr?.workspaces ?? 0} paying, before GST`}
        />
        <MetricCard label="Pending payments" value={String(pending.length)} hint="UTRs to verify" />
        <MetricCard label="Overdue" value={String(overdue.length)} hint="Workspaces past due" />
        <MetricCard
          label="Trials ending in 7 days"
          value={String(o.trialsEnding.length)}
          hint="Send the first invoice"
        />
        <MetricCard
          label="Unpaid invoices"
          value={String(unpaid.reduce((n, w) => n + w.openInvoices, 0))}
          hint={platformMoney(unpaidTotal.toString())}
        />
      </div>

      <Section
        id="pending"
        title="Payments to verify"
        empty="No payments to verify. When a customer pays by UPI and enters the UTR, it appears here; match the UTR and amount with your bank statement, then approve."
        rows={pending.length}
      >
        <Table containerLabel="Payments to verify">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>UTR</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map((p) => (
              <TableRow key={p.proofId}>
                <TableCell>
                  <WorkspaceLink id={p.workspaceId} name={p.workspaceName} />
                </TableCell>
                <TableCell className="font-mono">{p.invoiceNumber}</TableCell>
                <TableCell className="text-right font-semibold whitespace-nowrap tabular-nums">
                  {platformMoney(p.totalMinor, p.currency)}
                </TableCell>
                <TableCell className="font-mono">{p.utr}</TableCell>
                <TableCell>{new Date(p.submittedAt).toLocaleString()}</TableCell>
                <TableCell>
                  <StatusBadge status="PENDING" label="Pending verification" />
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <Button
                      size="sm"
                      onClick={() => setReviewing({ p, mode: 'approve' })}
                      aria-label={`Approve ${p.invoiceNumber}`}
                    >
                      Approve
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        id="overdue"
        title="Overdue workspaces"
        empty="No overdue workspaces. A workspace appears here when an invoice passes its due date or the subscription is past due; Send reminder emails its billing members."
        rows={overdue.length}
      >
        <Table containerLabel="Overdue workspaces">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Owed</TableHead>
              <TableHead>Due since</TableHead>
              <TableHead>Last reminded</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overdue.map((w) => (
              <TableRow key={w.workspaceId}>
                <TableCell>
                  <WorkspaceLink id={w.workspaceId} name={w.workspaceName} />
                </TableCell>
                <TableCell>
                  {w.subscriptionStatus === 'PAST_DUE' ? (
                    <StatusBadge status="ATTENTION" label={STATUS_LABEL.PAST_DUE ?? 'Past due'} />
                  ) : w.subscriptionStatus === 'SUSPENDED' ? (
                    <StatusBadge status="PAUSED" label={STATUS_LABEL.SUSPENDED ?? 'Suspended'} />
                  ) : (
                    (STATUS_LABEL[w.subscriptionStatus ?? 'NONE'] ?? w.subscriptionStatus)
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {w.openInvoices} · {platformMoney(w.openTotalMinor)}
                </TableCell>
                <TableCell>{day(w.oldestDueAt)}</TableCell>
                <TableCell>{lastReminded(byId.get(w.workspaceId)?.lastRemindedAt)}</TableCell>
                <TableCell>
                  <ReminderActions
                    id={w.workspaceId}
                    name={w.workspaceName}
                    canSend={canManage}
                    text={reminderMessage(w.workspaceName, w.openTotalMinor, w.oldestDueAt)}
                    onSent={refresh}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        id="trials"
        title="Trials ending in 7 days"
        empty="No trials end in the next 7 days. Trials ending soon appear here so you can send the first invoice before access stops."
        rows={o.trialsEnding.length}
      >
        <Table containerLabel="Trials ending in 7 days">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Trial ends</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {o.trialsEnding.map((t) => (
              <TableRow key={t.workspaceId}>
                <TableCell>
                  <WorkspaceLink id={t.workspaceId} name={t.name} />
                </TableCell>
                <TableCell>{day(t.trialEndsAt)}</TableCell>
                <TableCell>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Create invoice for ${t.name}`}
                      onClick={() => setInvoiceFor({ id: t.workspaceId, name: t.name })}
                    >
                      Create invoice
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        id="unpaid"
        title="Unpaid invoices"
        empty="No unpaid invoices. Every open payment request appears here until it is paid or voided; use Create invoice to send a new one."
        rows={unpaid.length}
      >
        <Table containerLabel="Unpaid invoices">
          <TableHeader>
            <TableRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Open invoices</TableHead>
              <TableHead>Next due</TableHead>
              <TableHead>Last reminded</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {unpaid.map((w) => (
              <TableRow key={w.id}>
                <TableCell>
                  <WorkspaceLink id={w.id} name={w.name} />
                </TableCell>
                <TableCell>
                  {w.openInvoices} · {platformMoney(w.openTotalMinor)}
                </TableCell>
                <TableCell>{day(w.nextDueAt)}</TableCell>
                <TableCell>{lastReminded(w.lastRemindedAt)}</TableCell>
                <TableCell>
                  <ReminderActions
                    id={w.id}
                    name={w.name}
                    canSend={canManage}
                    text={reminderMessage(w.name, w.openTotalMinor, w.nextDueAt)}
                    onSent={refresh}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle as="h2">Revenue by month</CardTitle>
          </CardHeader>
          <CardContent>
            {revenue.length === 0 ? (
              <p className="text-sm text-fg-secondary">
                No payments approved yet. Approved UPI payments are totalled here by month.
              </p>
            ) : (
              <TrendChart
                label="Revenue by month"
                variant="bar"
                pointHeader="Month"
                data={[...revenue]
                  .reverse()
                  .map((r) => ({ label: r.month, values: { n: Number(r.totalMinor) } }))}
                series={[{ key: 'n', label: 'Collected', tone: 'blue' }]}
                formatValue={(v) => formatMoney(v, 'INR')}
              />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle as="h2">Workspaces by status</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart
              label="Workspaces by status"
              variant="bar"
              pointHeader="Status"
              data={statusOrder
                .filter((s) => o.statusCounts[s])
                .map((s) => ({ label: STATUS_LABEL[s] ?? s, values: { n: o.statusCounts[s]! } }))}
              series={[{ key: 'n', label: 'Workspaces', tone: 'blue' }]}
            />
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
      <CreateInvoiceFlow
        open={invoiceFor !== null}
        onOpenChange={(v) => !v && setInvoiceFor(null)}
        workspace={invoiceFor && invoiceFor !== 'pick' ? invoiceFor : undefined}
        onDone={refresh}
      />
    </ListPage>
  )
}

function WorkspaceLink({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/platform/workspaces/${id}`} className={textLink}>
      {name}
    </Link>
  )
}

function Section({
  id,
  title,
  empty,
  rows,
  children,
}: {
  id: string
  title: string
  empty: string
  rows: number
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {title} <span className="text-fg-secondary">({rows})</span>
      </h2>
      {rows === 0 ? (
        <p className="rounded-md border border-border-subtle bg-surface p-4 text-sm text-fg-secondary">
          {empty}
        </p>
      ) : (
        children
      )}
    </section>
  )
}
