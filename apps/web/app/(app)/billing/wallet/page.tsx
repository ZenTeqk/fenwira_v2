'use client'

import { WALLET_TRANSACTION_TYPES, type WalletTransaction } from '@fenwira/contracts'
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
  MetricCard,
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
const MODE_LABEL = { FREE: 'Free', TRIAL: 'Trial', PREPAID: 'Prepaid' } as const
const dateFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Wallet (docs/plans/PHASE_11_PLAN.md §2.3–2.4, UX_PATTERNS → Billing): the backend's wallet
 * state, funds held for sends in progress, this month's usage, and the append-only ledger.
 * Top-ups are manual and made by the Fenwira team (P11-D13); there is no payment flow (P11-D19).
 */
export default function WalletPage() {
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
        title: 'Wallet',
        description:
          'Credits for template messages. A send holds its price until Meta confirms the charge.',
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
          <Alert tone="danger" title="Your wallet is out of credits">
            Template messages, campaigns and automations that send templates are paused. Replies
            inside the 24-hour window still work. Credits are added by the Fenwira team: contact
            Fenwira to arrange a top-up.
          </Alert>
        ) : w?.state === 'LOW_BALANCE' ? (
          <Alert tone="warning" title="Wallet balance is low">
            {money(w.availableMinor)} available. Template messages stop when it runs out. Credits
            are added by the Fenwira team: contact Fenwira to arrange a top-up.
          </Alert>
        ) : w?.state === 'NOT_ENFORCED' ? (
          <Alert tone="info" title="Messages aren’t billed in this workspace">
            Sends don’t use credits right now. The ledger below still records any credits.
          </Alert>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Available"
          icon={<WalletIcon />}
          loading={wallet.isPending}
          value={w ? money(w.availableMinor) : '—'}
          hint={
            w ? (
              <span className="flex flex-wrap items-center gap-2">
                <StatusBadge status={w.state} />
                {w.state !== 'NOT_ENFORCED' ? (
                  <span>Low-balance alert at {money(w.lowBalanceThresholdMinor)}</span>
                ) : null}
              </span>
            ) : undefined
          }
        />
        <MetricCard
          label="Held for sends in progress"
          icon={<Hourglass />}
          loading={wallet.isPending}
          value={w ? money(w.reservedMinor) : '—'}
          hint="Charged or returned when Meta reports the outcome"
        />
        <MetricCard
          label="Usage this month"
          icon={<CalendarClock />}
          loading={wallet.isPending}
          value={w ? money(w.spentThisMonthMinor) : '—'}
          hint="Message charges since the 1st (UTC)"
        />
        <MetricCard
          label="Billing mode"
          loading={wallet.isPending}
          value={w ? MODE_LABEL[w.billingMode] : '—'}
          hint={w ? `Balance ${money(w.balanceMinor)}` : undefined}
        />
      </div>
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
    </DetailPage>
  )
}
