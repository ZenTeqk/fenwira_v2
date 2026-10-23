'use client'
import { platformPlanSchema, type PlatformPlan } from '@fenwira/contracts'
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Input,
  ListPage,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@fenwira/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/lib/api/client'
import { formatMoney } from '@/lib/billing'
import { platformRequest } from '@/lib/platform'
import { usePlatform } from './platform-shell'

const failure = (err: unknown) =>
  err instanceof ApiError
    ? err.code === 'TOTP_REQUIRED'
      ? 'Verify your identity again (Commercial operations card in any workspace), then retry.'
      : err.message
    : 'Request failed.'

/** Monthly plan prices used for automatic renewal invoices (docs/BILLING.md → Manual invoices). */
export function PlansView() {
  const me = usePlatform()
  const canEdit = !!me?.permissions.includes('subscription.manage')
  const plans = useQuery({
    queryKey: ['platform', 'plans'],
    retry: false,
    queryFn: async () => z.array(platformPlanSchema).parse(await platformRequest('/plans')),
  })
  return (
    <ListPage
      header={{
        title: 'Plans & prices',
        description:
          'Monthly prices in INR, before GST. Renewal invoices use these automatically; invoices already issued keep their amount. See docs/MANAGED_LAUNCH.md § 4 Billing operations.',
      }}
    >
      {plans.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : plans.isError ? (
        <ErrorState onRetry={() => void plans.refetch()} />
      ) : plans.data.length === 0 ? (
        <EmptyState title="No plans configured" />
      ) : (
        <Table containerLabel="Plans and prices">
          <TableHeader>
            <TableRow>
              <TableHead>Plan</TableHead>
              <TableHead>Monthly price</TableHead>
              <TableHead>{canEdit ? 'Change price (₹)' : ''}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.data.map((p) => (
              <TableRow key={p.key}>
                <TableCell>{p.name}</TableCell>
                <TableCell>
                  {p.monthly ? formatMoney(p.monthly.amountMinor, p.monthly.currency) : 'Not set'}
                </TableCell>
                <TableCell>{canEdit ? <PriceEditor plan={p} /> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ListPage>
  )
}

function PriceEditor({ plan }: { plan: PlatformPlan }) {
  const qc = useQueryClient()
  const [rupees, setRupees] = useState(plan.monthly ? String(plan.monthly.amountMinor / 100) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setError('')
    const amountMinor = Math.round(Number(rupees) * 100)
    if (!Number.isFinite(amountMinor) || amountMinor < 100)
      return setError('Enter a price of at least ₹1.')
    setBusy(true)
    try {
      await platformRequest(`/plans/${plan.key}/price`, { currency: 'INR', amountMinor })
      toast.success(`${plan.name} price saved`)
      await qc.invalidateQueries({ queryKey: ['platform', 'plans'] })
    } catch (err) {
      setError(failure(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          inputMode="decimal"
          aria-label={`${plan.name} monthly price in rupees`}
          value={rupees}
          onChange={(e) => setRupees(e.target.value)}
        />
        <Button size="sm" loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
      {error ? (
        <Alert tone="danger" title="Not saved">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}
