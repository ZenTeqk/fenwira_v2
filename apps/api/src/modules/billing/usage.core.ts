import { type TenantTx } from '@fenwira/database'
import { countryOf } from '../../core/phone'
import {
  type BillingPlatform,
  NO_BILLING,
  releaseReservation,
  settleReservation,
} from './wallet.core'

export type StatusPricing = { billable?: boolean; category?: string }
export type PricingOutcome = 'settled' | 'released' | 'none' | 'no-pricing' | 'unknown-message'

/**
 * One message status with Meta's pricing (docs/BILLING.md → Reservations): FAILED or
 * non-billable releases the hold; billable pricing settles it at the price book's price for
 * Meta's category and the recipient's country. Idempotent per message.
 */
export async function applyStatusPricing(
  tx: TenantTx,
  tenantId: string,
  input: { messageId: string; to: string; pricing: StatusPricing | null },
  platform: BillingPlatform = NO_BILLING,
): Promise<PricingOutcome> {
  const { messageId, pricing } = input
  if (input.to === 'FAILED')
    return (await releaseReservation(tx, tenantId, messageId, 'failed', platform))
      ? 'released'
      : 'none'
  if (!pricing) return 'no-pricing'
  if (pricing.billable === false)
    return (await releaseReservation(tx, tenantId, messageId, 'not billable', platform))
      ? 'released'
      : 'none'
  const message = await tx.message.findFirst({
    where: { id: messageId },
    select: { contact: { select: { phoneE164: true, country: true } } },
  })
  if (!message) return 'unknown-message'
  return settleReservation(
    tx,
    tenantId,
    {
      messageId,
      category: (pricing.category ?? 'UTILITY').toUpperCase(),
      country: message.contact.country ?? countryOf(message.contact.phoneE164),
      pricing,
    },
    platform,
  )
}

/**
 * Stale-reservation recovery for one message (docs/plans/PHASE_11_PLAN.md §2.1). If a status
 * event with Meta's pricing was recorded but never applied (a lost or dead-lettered job), it is
 * applied now: billable pricing settles. Otherwise the hold is released, because nothing says
 * Meta charged for the message (docs/BILLING.md → Reservations). Idempotent.
 */
export async function recoverReservation(
  tx: TenantTx,
  tenantId: string,
  messageId: string,
  platform: BillingPlatform = NO_BILLING,
): Promise<'settled' | 'released' | 'none'> {
  const r = await tx.walletReservation.findFirst({ where: { messageId, status: 'ACTIVE' } })
  if (!r) return 'none'
  const events = await tx.outboxEvent.findMany({
    where: {
      tenantId,
      createdAt: { gte: r.createdAt },
      eventType: 'message.status.changed',
      aggregateId: messageId,
    },
    select: { payload: true },
    orderBy: { createdAt: 'asc' },
  })
  const priced = events
    .map((e) => e.payload as { to?: string; pricing?: StatusPricing | null })
    .find((p) => p.pricing)
  if (priced?.pricing) {
    const out = await applyStatusPricing(
      tx,
      tenantId,
      { messageId, to: priced.to ?? 'SENT', pricing: priced.pricing },
      platform,
    )
    if (out === 'settled' || out === 'released') return out
  }
  return (await releaseReservation(
    tx,
    tenantId,
    messageId,
    'recovered: no pricing received',
    platform,
  ))
    ? 'released'
    : 'none'
}

/** Ledger figures for one wallet (the daily check reports drift; it never corrects it). */
export async function ledgerFigures(tx: TenantTx, walletId: string) {
  const w = await tx.wallet.findFirstOrThrow({ where: { id: walletId } })
  const ledger = await tx.walletTransaction.aggregate({
    where: { walletId },
    _sum: { amountMinor: true },
  })
  const holds = await tx.walletReservation.aggregate({
    where: { walletId, status: 'ACTIVE' },
    _sum: { amountMinor: true },
  })
  return {
    balanceMinor: w.balanceMinor,
    ledgerMinor: ledger._sum.amountMinor ?? 0n,
    reservedMinor: w.reservedMinor,
    activeHoldsMinor: holds._sum.amountMinor ?? 0n,
  }
}
