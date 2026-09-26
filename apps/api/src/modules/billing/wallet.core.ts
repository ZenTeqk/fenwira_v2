import { type Wallet } from '@fenwira/contracts'
import { type TenantTx } from '@fenwira/database'
import { AppError } from '../../core/http/app-error'

/**
 * Wallet ledger and B4 reservations (docs/BILLING.md → Wallet, Reservations). Every write locks
 * the tenant's wallet row (`FOR UPDATE`), so concurrent workers serialize and can never reserve
 * the same funds. Balances change only by inserting ledger rows (the trigger maintains the cache).
 */

type WalletRow = {
  id: string
  currency: string
  balance_minor: bigint
  credit_limit_minor: bigint
  reserved_minor: bigint
}

/**
 * Platform billing configuration (P9-D1). `enforced` is the platform switch (BILLING_ENFORCED:
 * off in development and tests, on in production); each tenant's billing mode then decides.
 */
export type BillingPlatform = {
  enforced: boolean
  /** Trial/promotional credit granted once when a TRIAL tenant's wallet is created. */
  trialCreditMinor: number
}
export const NO_BILLING: BillingPlatform = { enforced: false, trialCreditMinor: 0 }

/** Whether this tenant's billable sends reserve funds: platform switch on and not FREE. */
export async function billingEnforcedFor(
  tx: TenantTx,
  tenantId: string,
  platform: BillingPlatform,
): Promise<boolean> {
  if (!platform.enforced) return false
  const t = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { billingMode: true },
  })
  return t.billingMode !== 'FREE'
}

/**
 * The wallet, created on first use (a TRIAL tenant gets its trial credit then, once), locked for
 * the rest of the transaction.
 */
export async function lockWallet(
  tx: TenantTx,
  tenantId: string,
  platform: BillingPlatform = NO_BILLING,
): Promise<WalletRow> {
  const created = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO wallets (id, tenant_id, updated_at) VALUES (gen_random_uuid(), ${tenantId}::uuid, now())
    ON CONFLICT (tenant_id) DO NOTHING RETURNING id`
  if (created[0] && platform.trialCreditMinor > 0) {
    const t = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { billingMode: true },
    })
    if (t.billingMode === 'TRIAL') {
      const amount = BigInt(platform.trialCreditMinor)
      await tx.walletTransaction.createMany({
        data: [
          {
            tenantId,
            walletId: created[0].id,
            type: 'CREDIT',
            amountMinor: amount,
            balanceAfterMinor: amount,
            reason: 'Trial credits',
            referenceType: 'promotion',
            idempotencyKey: `trial:${tenantId}`,
          },
        ],
        skipDuplicates: true,
      })
    }
  }
  const [row] = await tx.$queryRaw<WalletRow[]>`
    SELECT id, currency, balance_minor, credit_limit_minor, reserved_minor
    FROM wallets WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
  return row!
}

export const availableOf = (w: WalletRow) =>
  w.balance_minor + w.credit_limit_minor - w.reserved_minor

export function toWallet(
  w: WalletRow,
  enforced: boolean,
  billingMode: Wallet['billingMode'],
): Wallet {
  return {
    currency: w.currency,
    balanceMinor: Number(w.balance_minor),
    creditLimitMinor: Number(w.credit_limit_minor),
    reservedMinor: Number(w.reserved_minor),
    availableMinor: Number(availableOf(w)),
    enforced,
    billingMode,
  }
}

export type Price = {
  /** What the tenant is charged (the ledger debit). */
  customerPriceMinor: bigint
  /** What Meta charges Fenwira, when known (reporting). */
  providerCostMinor: bigint | null
  currency: string
  placeholder: boolean
}

/**
 * Price book lookup (decisions B1, P9-D2: configuration, never code): (category, country), else
 * (category, default). Services use the result; they never embed prices.
 */
export async function unitPrice(
  tx: TenantTx,
  category: string,
  country: string | null,
  at = new Date(),
): Promise<Price | null> {
  const rows = await tx.priceBookEntry.findMany({
    where: {
      category: category.toUpperCase(),
      OR: [{ country: country ?? '__' }, { country: null }],
      effectiveFrom: { lte: at },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }],
    },
    orderBy: { effectiveFrom: 'desc' },
  })
  const hit = rows.find((r) => r.country === country) ?? rows.find((r) => r.country === null)
  return hit
    ? {
        customerPriceMinor: hit.customerPriceMinor,
        providerCostMinor: hit.providerCostMinor,
        currency: hit.currency,
        placeholder: hit.isPlaceholder,
      }
    : null
}

/** Appends a ledger row; replay-safe on `idempotencyKey`. Returns the row id. */
export async function postTransaction(
  tx: TenantTx,
  tenantId: string,
  input: {
    type: 'CREDIT' | 'DEBIT' | 'ADJUSTMENT' | 'REFUND'
    amountMinor: bigint
    reason: string
    idempotencyKey: string
    referenceType?: string
    referenceId?: string
    createdBy?: string
  },
): Promise<string> {
  const existing = await tx.walletTransaction.findFirst({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  })
  if (existing) return existing.id
  const w = await lockWallet(tx, tenantId)
  const row = await tx.walletTransaction.create({
    data: {
      tenantId,
      walletId: w.id,
      type: input.type,
      amountMinor: input.amountMinor,
      balanceAfterMinor: w.balance_minor + input.amountMinor,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      createdBy: input.createdBy ?? null,
    },
  })
  return row.id
}

/**
 * Reserves the estimated cost of an accepted billable message, atomically with its acceptance
 * (same transaction). Idempotent per message. Throws 422 INSUFFICIENT_BALANCE when
 * balance + credit limit − active reservations can't cover it.
 */
export async function reserveForMessage(
  tx: TenantTx,
  tenantId: string,
  input: { messageId: string; category: string; country: string | null },
  platform: BillingPlatform = NO_BILLING,
): Promise<bigint> {
  const price = await unitPrice(tx, input.category, input.country)
  const amount = price?.customerPriceMinor ?? 0n
  const w = await lockWallet(tx, tenantId, platform)
  const existing = await tx.walletReservation.findFirst({ where: { messageId: input.messageId } })
  if (existing) return existing.amountMinor
  if (amount > 0n && availableOf(w) < amount)
    throw new AppError(
      'INSUFFICIENT_BALANCE',
      422,
      'Not enough credits to send this message. Add credits, then try again.',
      {
        availableMinor: Number(availableOf(w)),
        requiredMinor: Number(amount),
        currency: w.currency,
      },
    )
  await tx.walletReservation.create({
    data: { tenantId, walletId: w.id, messageId: input.messageId, amountMinor: amount },
  })
  await tx.$executeRaw`UPDATE wallets SET reserved_minor = reserved_minor + ${amount}, updated_at = now()
    WHERE id = ${w.id}::uuid`
  return amount
}

/** Final non-billable outcome: the hold is returned. Idempotent. */
export async function releaseReservation(
  tx: TenantTx,
  tenantId: string,
  messageId: string,
  reason: string,
): Promise<boolean> {
  const w = await lockWallet(tx, tenantId)
  const r = await tx.walletReservation.findFirst({ where: { messageId, status: 'ACTIVE' } })
  if (!r) return false
  await tx.walletReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', reason } })
  await tx.$executeRaw`UPDATE wallets SET reserved_minor = reserved_minor - ${r.amountMinor}, updated_at = now()
    WHERE id = ${w.id}::uuid`
  return true
}

/**
 * Meta priced the message: DEBIT the actual price (price book by Meta's category and the
 * recipient's country), close the reservation at its estimate, and record the usage event. A
 * difference between estimate and actual is recorded as-is (reconciliation). Idempotent.
 */
export async function settleReservation(
  tx: TenantTx,
  tenantId: string,
  input: { messageId: string; category: string; country: string | null; pricing: unknown },
): Promise<'settled' | 'none'> {
  const r = await tx.walletReservation.findFirst({
    where: { messageId: input.messageId, status: 'ACTIVE' },
  })
  if (!r) return 'none'
  const price = await unitPrice(tx, input.category, input.country)
  const actual = price?.customerPriceMinor ?? r.amountMinor
  const txId = await postTransaction(tx, tenantId, {
    type: 'DEBIT',
    amountMinor: -actual,
    reason: `WhatsApp ${input.category.toLowerCase()} message`,
    idempotencyKey: `usage:${input.messageId}`,
    referenceType: 'message',
    referenceId: input.messageId,
  })
  const w = await lockWallet(tx, tenantId)
  await tx.walletReservation.update({
    where: { id: r.id },
    data: {
      status: 'SETTLED',
      settledTransactionId: txId,
      reason: actual === r.amountMinor ? null : `estimate ${r.amountMinor}, actual ${actual}`,
    },
  })
  await tx.$executeRaw`UPDATE wallets SET reserved_minor = reserved_minor - ${r.amountMinor}, updated_at = now()
    WHERE id = ${w.id}::uuid`
  await tx.usageEvent.createMany({
    data: [
      {
        tenantId,
        type: 'WA_MESSAGE_BILLABLE',
        messageId: input.messageId,
        category: input.category.toUpperCase(),
        country: input.country,
        unitPriceMinor: actual,
        amountMinor: actual,
        providerCostMinor: price?.providerCostMinor ?? null,
        currency: price?.currency ?? w.currency,
        ...(input.pricing ? { pricingRef: input.pricing as object } : {}),
      },
    ],
    skipDuplicates: true,
  })
  return 'settled'
}
