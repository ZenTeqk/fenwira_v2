import {
  type Permission,
  type Wallet,
  type WalletTransaction,
  type WalletTransactionsQuery,
  type WorkspaceStatus,
} from '@fenwira/contracts'
import { type Prisma } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import Papa from 'papaparse'
import { TenantDb } from '../../core/database/tenant-db'
import { AppError } from '../../core/http/app-error'
import { afterCursor, decodeCursor, toPage } from '../../core/http/cursor'
import { AuditService } from '../audit'
import { currentTenant } from '../tenancy'
import { BILLING_OPTIONS, type BillingOptions } from './billing.options'
import { availableOf, billingEnforcedFor, lockWallet, toWallet, walletStateOf } from './wallet.core'

/** Largest synchronous CSV export; narrower date ranges cover more (docs/BILLING.md → Wallet). */
export const TRANSACTION_EXPORT_MAX_ROWS = 50_000

type TransactionRow = Prisma.WalletTransactionGetPayload<{ include: { wallet: true } }>

@Injectable()
export class BillingService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly audit: AuditService,
    @Inject(BILLING_OPTIONS) private readonly options: BillingOptions,
  ) {}

  /** Balance, holds, state (P11-D12) and whether this tenant's sends are enforced (P9-D1). */
  wallet(): Promise<Wallet> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const w = await lockWallet(tx, tenantId, this.options)
      const t = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { billingMode: true },
      })
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const spent = await tx.walletTransaction.aggregate({
        where: { walletId: w.id, type: 'DEBIT', createdAt: { gte: monthStart } },
        _sum: { amountMinor: true },
      })
      return toWallet(
        w,
        await billingEnforcedFor(tx, tenantId, this.options),
        t.billingMode,
        this.options,
        -(spent._sum.amountMinor ?? 0n),
      )
    })
  }

  /**
   * Shell/dashboard summary: every member sees the wallet state (it explains why sends may be
   * refused); amounts only with `billing.read`.
   */
  status(permissions: readonly Permission[]): Promise<WorkspaceStatus> {
    const { tenantId } = currentTenant()
    return this.tenantDb.run(async (tx) => {
      const w = await lockWallet(tx, tenantId, this.options)
      const enforced = await billingEnforcedFor(tx, tenantId, this.options)
      const available = availableOf(w)
      return {
        wallet: {
          state: walletStateOf(available, enforced, this.options.lowBalanceThresholdMinor),
          currency: w.currency,
          availableMinor: permissions.includes('billing.read') ? Number(available) : null,
        },
      }
    })
  }

  transactions(query: WalletTransactionsQuery) {
    return this.tenantDb.run(async (tx) => {
      const rows = await tx.walletTransaction.findMany({
        where: { ...transactionFilter(query), ...afterCursor(decodeCursor(query.cursor)) },
        include: { wallet: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const { items, page } = toPage(rows, query.limit)
      return { data: items.map(toTransaction), page }
    })
  }

  /** CSV of the filtered ledger (newest first), audited. Refuses above the synchronous limit. */
  exportTransactions(query: Omit<WalletTransactionsQuery, 'cursor' | 'limit'>): Promise<string> {
    return this.tenantDb.run(async (tx) => {
      const where = transactionFilter(query)
      const count = await tx.walletTransaction.count({ where })
      if (count > TRANSACTION_EXPORT_MAX_ROWS)
        throw new AppError(
          'EXPORT_TOO_LARGE',
          422,
          'Too many transactions to export at once. Choose a shorter date range.',
          { rows: count, maxRows: TRANSACTION_EXPORT_MAX_ROWS },
        )
      const rows = await tx.walletTransaction.findMany({
        where,
        include: { wallet: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      await this.audit.write(tx, {
        action: 'billing.transactions.exported',
        targetType: 'wallet',
        targetId: rows[0]?.walletId ?? null,
        changes: { rows: rows.length, ...query },
      })
      return toCsv(rows)
    })
  }
}

function transactionFilter(
  q: Pick<WalletTransactionsQuery, 'type' | 'from' | 'to'>,
): Prisma.WalletTransactionWhereInput {
  return {
    ...(q.type ? { type: q.type } : {}),
    ...(q.from || q.to
      ? {
          createdAt: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to ? { lt: endOf(q.to) } : {}),
          },
        }
      : {}),
  }
}

/** A bare date covers the whole UTC day; a timestamp is inclusive. */
const endOf = (to: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(to)
    ? new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000)
    : new Date(new Date(to).getTime() + 1)

export function toTransaction(r: TransactionRow): WalletTransaction {
  return {
    id: r.id,
    type: r.type,
    fundType: r.fundType,
    amountMinor: Number(r.amountMinor),
    balanceAfterMinor: Number(r.balanceAfterMinor),
    currency: r.wallet.currency,
    reason: r.reason,
    referenceType: r.referenceType,
    referenceId: r.referenceId,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }
}

/** Amounts as decimal major units with the currency column, so spreadsheets sum them. */
function toCsv(rows: TransactionRow[]): string {
  const major = (minor: bigint, currency: string) => {
    const digits = fractionDigits(currency)
    return (Number(minor) / 10 ** digits).toFixed(digits)
  }
  return Papa.unparse({
    fields: [
      'date',
      'type',
      'fund_type',
      'reason',
      'reference_type',
      'reference_id',
      'amount',
      'balance_after',
      'currency',
      'transaction_id',
    ],
    data: rows.map((r) => [
      r.createdAt.toISOString(),
      r.type,
      r.fundType,
      textCell(r.reason),
      textCell(r.referenceType ?? ''),
      textCell(r.referenceId ?? ''),
      major(r.amountMinor, r.wallet.currency),
      major(r.balanceAfterMinor, r.wallet.currency),
      r.wallet.currency,
      r.id,
    ]),
  })
}

/**
 * Spreadsheet formula injection guard for free-text cells (amounts stay numeric, so a negative
 * amount keeps its sign).
 */
export const textCell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v)

/** Minor-unit digits of an ISO 4217 currency (INR 2, JPY 0), per P11-D8 currency awareness. */
const fractionDigits = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2
