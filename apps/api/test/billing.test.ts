import { describe, expect, it } from 'vitest'
import { textCell } from '../src/modules/billing/billing.service'
import { formatMoney } from '../src/modules/notifications/notifications-dispatch.processor'
import {
  DEFAULT_LOW_BALANCE_THRESHOLD_MINOR,
  fundsStateOf,
  NO_BILLING,
  walletStateOf,
} from '../src/modules/billing/wallet.core'

describe('wallet state (P11-D12)', () => {
  it('defaults the threshold to ₹100', () => {
    expect(DEFAULT_LOW_BALANCE_THRESHOLD_MINOR).toBe(10_000)
    expect(NO_BILLING.lowBalanceThresholdMinor).toBe(10_000)
  })

  it.each([
    [10_001n, 'NORMAL'],
    [10_000n, 'LOW_BALANCE'], // exactly at the threshold
    [1n, 'LOW_BALANCE'],
    [0n, 'INSUFFICIENT_FUNDS'],
    [-500n, 'INSUFFICIENT_FUNDS'], // over-reserved within a credit limit
  ] as const)('available %s → %s', (available, state) => {
    expect(fundsStateOf(available, 10_000)).toBe(state)
    expect(walletStateOf(available, true, 10_000)).toBe(state)
  })

  it('is NOT_ENFORCED whenever sends are not billed, whatever the balance', () => {
    expect(walletStateOf(0n, false, 10_000)).toBe('NOT_ENFORCED')
    expect(walletStateOf(1_000_000n, false, 10_000)).toBe('NOT_ENFORCED')
  })

  it('a zero threshold means LOW_BALANCE never applies', () => {
    expect(fundsStateOf(1n, 0)).toBe('NORMAL')
    expect(fundsStateOf(0n, 0)).toBe('INSUFFICIENT_FUNDS')
  })
})

describe('billing formatting', () => {
  it('formats minor units in the wallet currency', () => {
    expect(formatMoney(10_000, 'INR')).toBe('₹100.00')
    expect(formatMoney(-30, 'INR')).toBe('-₹0.30')
    expect(formatMoney(500, 'JPY')).toBe('JP¥500')
  })

  it('guards CSV text cells against formula injection', () => {
    expect(textCell('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`)
    expect(textCell('@SUM(A1)')).toBe(`'@SUM(A1)`)
    expect(textCell('-1+1')).toBe(`'-1+1`)
    expect(textCell('Manual top-up')).toBe('Manual top-up')
  })
})
