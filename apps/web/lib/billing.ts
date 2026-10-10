'use client'

import {
  type Page,
  type Wallet,
  type WalletTransaction,
  type WalletTransactionsQuery,
} from '@fenwira/contracts'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useSession } from '@/components/session/session-provider'
import { download, get } from '@/lib/api/client'
import { keys } from '@/lib/api/keys'

/** Minor units → money in the wallet currency (INR has 2 digits; P11-D8 currency awareness). */
export function formatMoney(minor: number, currency: string): string {
  const f = new Intl.NumberFormat('en-IN', { style: 'currency', currency })
  return f.format(minor / 10 ** (f.resolvedOptions().maximumFractionDigits ?? 2))
}

export const walletKey = (tenantId: string | undefined, ...rest: string[]) =>
  keys.tenant(tenantId, 'wallet', ...rest)

/** Balance, holds and the backend's wallet state (members with billing.read). */
export function useWallet() {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: walletKey(tenantId),
    queryFn: () => get<{ data: Wallet }>('/billing/wallet').then((r) => r.data),
    enabled: can('billing.read'),
    staleTime: 60_000,
  })
}

export type TransactionFilters = Pick<WalletTransactionsQuery, 'type' | 'from' | 'to'>

const query = (f: TransactionFilters) => {
  const p = new URLSearchParams()
  if (f.type) p.set('type', f.type)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  return p
}

export function useWalletTransactions(filters: TransactionFilters, cursor: string | undefined) {
  const { tenantId, can } = useSession()
  return useQuery({
    queryKey: walletKey(tenantId, 'transactions', JSON.stringify(filters), cursor ?? ''),
    queryFn: () => {
      const p = query(filters)
      p.set('limit', '25')
      if (cursor) p.set('cursor', cursor)
      return get<{ data: WalletTransaction[]; page: Page }>(
        `/billing/wallet/transactions?${p.toString()}`,
      )
    },
    enabled: can('billing.read'),
    placeholderData: keepPreviousData,
  })
}

/** The filtered ledger as a CSV file (the API refuses very large ranges with EXPORT_TOO_LARGE). */
export const exportTransactions = (filters: TransactionFilters) =>
  download(
    '/billing/wallet/transactions/export',
    filters,
    `wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
  )

export const TRANSACTION_TYPE_LABEL: Record<WalletTransaction['type'], string> = {
  CREDIT: 'Credit',
  DEBIT: 'Usage',
  ADJUSTMENT: 'Adjustment',
  REFUND: 'Refund',
}
