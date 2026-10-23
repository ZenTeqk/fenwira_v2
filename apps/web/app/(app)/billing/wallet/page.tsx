'use client'

import { useManagedBillingRedirect } from '@/components/billing/managed-billing'
import { type Wallet, WALLET_TRANSACTION_TYPES, type WalletTransaction } from '@fenwira/contracts'
import {
  Alert,
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  DetailPage,
  FilterBar,
  Input,
  Label,
  Card,
  ModuleTabs,
  Skeleton,
  PermissionState,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
  toast,
} from '@fenwira/ui'
import { useMutation } from '@tanstack/react-query'
import { CalendarClock, Download, Hourglass, Wallet as WalletIcon } from 'lucide-react'
import Link from 'next/link'
import { WalletPlanContext } from '@/components/billing/wallet-plan-context'
import { useState } from 'react'
import { useSession } from '@/components/session/session-provider'
import { ApiError } from '@/lib/api/client'
import {
  exportTransactions,
  formatMoney,
  type TransactionFilters,
  TRANSACTION_TYPE_LABEL,
  useWallet,
  useWalletTransactions,
} from '@/lib/billing'

const ALL = 'ALL'

type Support = Wallet['support']

/** P11-D20: top-ups are manual (P11-D13); the contact comes from configuration, never code. */
function TopUpLine({ support }: { support: Support }) {
  return support.email || support.url ? (
    <>Credits are added by the Fenwira team: contact billing to arrange a top-up.</>
  ) : (
    <>Credits are added by the Fenwira team: contact Fenwira to arrange a top-up.</>
  )
}

function ContactBilling({ support }: { support: Support }) {
  const href = support.url ?? (support.email ? `mailto:${support.email}` : null)
  if (!href) return null
  return (
    <Button variant="secondary" size="sm" asChild>
      <a href={href} {...(support.url ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        Contact billing
      </a>
    </Button>
  )
}
const MODE_LABEL = { FREE: 'Free', TRIAL: 'Trial', PREPAID: 'Prepaid' } as const
const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Wallet (docs/plans/PHASE_11_PLAN.md §2.3–2.4, UX_PATTERNS → Billing): the backend's wallet
 * state, funds held for sends in progress, this month's usage, and the append-only ledger.
 * Top-ups are manual and made by the Fenwira team (P11-D13); there is no payment flow (P11-D19).
 */
function WalletPageContent() {
  const { can } = useSession()
  const wallet = useWallet()
  const [type, setType] = useState<string>(ALL)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cursors, setCursors] = useState<string[]>([])
  const cursor = cursors[cursors.length - 1]
  const filters: TransactionFilters = {
    ...(type !== ALL ? { type: type as TransactionFilters['type'] } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }
  const transactions = useWalletTransactions(filters, cursor)
  const exporter = useMutation({
    mutationFn: () => exportTransactions(filters),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'The export failed. Try again.'),
  })
  const reset = (fn: () => void) => {
    fn()
    setCursors([])
  }

  if (!can('billing.read')) return <PermissionState what="billing" permission="billing.read" />

  const w = wallet.data
  const money = (minor: number) => (w ? formatMoney(minor, w.currency) : '—')
  const activeFilters = (type !== ALL ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)

  const columns: Array<ColumnDef<WalletTransaction>> = [
    {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {dateFormat.format(new Date(row.original.createdAt))}
        </span>
      ),
    },
    {
      id: 'description',
      header: 'Description',
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-slate">{row.original.reason}</span>
          {row.original.fundType === 'PROMOTIONAL' ? <Badge tone="info">Promotional</Badge> : null}
        </span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => TRANSACTION_TYPE_LABEL[row.original.type],
    },
    {
      id: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span
          className={
            row.original.amountMinor > 0 ? 'font-medium text-success-strong' : 'text-slate'
          }
        >
          {row.original.amountMinor > 0 ? '+' : ''}
          {formatMoney(row.original.amountMinor, row.original.currency)}
        </span>
      ),
    },
    {
      id: 'balance',
      header: 'Balance after',
      meta: { align: 'right' },
      cell: ({ row }) => formatMoney(row.original.balanceAfterMinor, row.original.currency),
    },
  ]

  return (
    <DetailPage
      header={{
        title: 'Billing',
        description: 'Manage your plan, WhatsApp balance and usage.',
        actions: (
          <Button
            variant="secondary"
            loading={exporter.isPending}
            onClick={() => exporter.mutate()}
          >
            <Download aria-hidden="true" />
            Export CSV
          </Button>
        ),
      }}
      banner={
        w?.state === 'INSUFFICIENT_FUNDS' ? (
          <Alert
            tone="danger"
            title="Your wallet is out of credits"
            action={<ContactBilling support={w.support} />}
          >
            Template messages, campaigns and automations that send templates are paused. Replies
            inside the 24-hour window still work. <TopUpLine support={w.support} />
          </Alert>
        ) : w?.state === 'LOW_BALANCE' ? (
          <Alert
            tone="warning"
            title="Wallet balance is low"
            action={<ContactBilling support={w.support} />}
          >
            {money(w.availableMinor)} available. Template messages stop when it runs out.{' '}
            <TopUpLine support={w.support} />
          </Alert>
        ) : w?.state === 'NOT_ENFORCED' ? (
          <Alert tone="info" title="Messages aren’t billed in this workspace">
            Sends don’t use credits right now. The ledger below still records any credits.
          </Alert>
        ) : undefined
      }
    >
      <ModuleTabs
        label="Billing pages"
        className="bg-transparent"
        linkAs={Link}
        items={[
          {
            id: 'subscription',
            label: 'Subscription',
            href: '/billing/subscription',
            active: false,
          },
          { id: 'invoices', label: 'Invoices', href: '/billing/invoices', active: false },
          { id: 'wallet', label: 'Wallet', href: '/billing/wallet', active: true },
          { id: 'usage', label: 'Usage', href: '/billing/usage', active: false },
        ]}
      />
      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <Card className="flex flex-col gap-4 p-4" aria-labelledby="available-balance">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-2">
                <h2 id="available-balance" className="text-md font-semibold">
                  Available balance
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                  {wallet.isPending ? (
                    <Skeleton className="h-8 w-40" />
                  ) : (
                    <p className="break-all text-2xl font-semibold tabular-nums">
                      {w ? money(w.availableMinor) : '—'}
                    </p>
                  )}
                  {w ? <StatusBadge status={w.state} /> : null}
                </div>
                <p className="text-sm text-secondary">
                  Use wallet credits for billable WhatsApp template messages.
                </p>
              </div>
              {w ? <ContactBilling support={w.support} /> : null}
            </div>
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-3">
              {[
                {
                  label: 'Wallet balance',
                  icon: WalletIcon,
                  value: w ? money(w.balanceMinor) : '—',
                  hint: 'Before active holds',
                },
                {
                  label: 'Reserved',
                  icon: Hourglass,
                  value: w ? money(w.reservedMinor) : '—',
                  hint: 'Held for sends in progress',
                },
                {
                  label: 'Usage this month',
                  icon: CalendarClock,
                  value: w ? money(w.spentThisMonthMinor) : '—',
                  hint: 'Message charges since the 1st (UTC)',
                },
              ].map(({ label, icon: Icon, value, hint }) => (
                <div key={label} className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong"
                  >
                    <Icon className="size-4" />
                  </span>
                  <dl className="min-w-0">
                    <dt className="text-sm text-secondary">{label}</dt>
                    <dd className="break-all text-md font-semibold tabular-nums">{value}</dd>
                    <dd className="text-xs text-secondary">{hint}</dd>
                  </dl>
                </div>
              ))}
            </div>
            {w?.enforced ? (
              <Alert
                tone="info"
                title={`Low-balance alert at ${money(w.lowBalanceThresholdMinor)}`}
              >
                Workspace members with billing access are notified when available funds cross the
                configured threshold.
              </Alert>
            ) : null}
          </Card>
          {wallet.isError ? (
            <Alert
              tone="danger"
              title="Couldn’t load the wallet"
              action={
                <Button variant="secondary" size="sm" onClick={() => void wallet.refetch()}>
                  Try again
                </Button>
              }
            >
              {wallet.error instanceof ApiError ? wallet.error.message : 'Something went wrong.'}
            </Alert>
          ) : null}
          <section aria-labelledby="transactions" className="flex flex-col gap-3">
            <SectionHeader
              id="transactions"
              title="Transactions"
              description="Every credit and charge, newest first. Entries are never edited or deleted."
            />
            <DataTable
              label="Wallet transactions"
              columns={columns}
              data={transactions.data?.data ?? []}
              getRowId={(t) => t.id}
              loading={transactions.isPending}
              error={
                transactions.isError
                  ? {
                      message:
                        transactions.error instanceof ApiError
                          ? transactions.error.message
                          : undefined,
                      onRetry: () => void transactions.refetch(),
                    }
                  : undefined
              }
              toolbar={
                <FilterBar
                  activeCount={activeFilters}
                  onClear={() =>
                    reset(() => {
                      setType(ALL)
                      setFrom('')
                      setTo('')
                    })
                  }
                >
                  <Select value={type} onValueChange={(v) => reset(() => setType(v))}>
                    <SelectTrigger aria-label="Type" className="h-9 w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>Any type</SelectItem>
                      {WALLET_TRANSACTION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TRANSACTION_TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="tx-from" className="text-sm text-secondary">
                      From
                    </Label>
                    <Input
                      id="tx-from"
                      type="date"
                      className="h-9 w-40"
                      value={from}
                      max={to || undefined}
                      onChange={(e) => reset(() => setFrom(e.target.value))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="tx-to" className="text-sm text-secondary">
                      To
                    </Label>
                    <Input
                      id="tx-to"
                      type="date"
                      className="h-9 w-40"
                      value={to}
                      min={from || undefined}
                      onChange={(e) => reset(() => setTo(e.target.value))}
                    />
                  </div>
                </FilterBar>
              }
              empty={
                activeFilters
                  ? { title: 'No matching transactions', description: 'Try another type or dates.' }
                  : {
                      title: 'No transactions yet',
                      description:
                        'Credits added by the Fenwira team and charges for template messages appear here.',
                    }
              }
              pagination={{
                hasPrevious: cursors.length > 0,
                hasNext: Boolean(transactions.data?.page.hasMore),
                onPrevious: () => setCursors((c) => c.slice(0, -1)),
                onNext: () => {
                  const next = transactions.data?.page.nextCursor
                  if (next) setCursors((c) => [...c, next])
                },
                summary: `Page ${cursors.length + 1}`,
              }}
            />
          </section>
        </div>
        <aside aria-label="Wallet and subscription details" className="flex min-w-0 flex-col gap-4">
          <WalletPlanContext />
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong"
              >
                <WalletIcon className="size-4" />
              </span>
              <h2 className="text-md font-semibold">Top up your wallet</h2>
            </div>
            <p className="text-sm text-secondary">
              {w ? (
                <TopUpLine support={w.support} />
              ) : (
                'Wallet funding is arranged manually with Fenwira.'
              )}
            </p>
            {w ? <ContactBilling support={w.support} /> : null}
          </Card>
          <Card className="flex flex-col gap-3 p-4">
            <h2 className="text-md font-semibold">How your wallet works</h2>
            <p className="text-sm text-secondary">
              Wallet credits pay for messages separately from your subscription. Paid and
              promotional funding retain their identity in transaction history.
            </p>
            <dl className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Billing mode</dt>
                <dd className="font-medium">{w ? MODE_LABEL[w.billingMode] : '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-secondary">Currency</dt>
                <dd className="font-medium">{w?.currency ?? '—'}</dd>
              </div>
            </dl>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/billing/usage">View customer usage</Link>
            </Button>
          </Card>
        </aside>
      </div>
    </DetailPage>
  )
}

export default function WalletPage() {
  return useManagedBillingRedirect() ? null : <WalletPageContent />
}
