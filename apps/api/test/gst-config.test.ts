import { describe, expect, it } from 'vitest'
import { manualBillingFromEnv } from '../src/modules/billing/billing.options'
import { taxFor } from '../src/modules/billing/invoices.core'

const base = {
  MANAGED_LAUNCH_MODE: true,
  BILLING_GRACE_DAYS: 7,
  BILLING_INVOICE_LEAD_DAYS: 3,
  UPI_VPA: 'pay@bank',
  UPI_PAYEE_NAME: 'Payee',
}

describe('GST configuration', () => {
  it('adds one GST line only when both GSTIN and rate are set', () => {
    const both = manualBillingFromEnv({
      ...base,
      BILLING_GSTIN: '33ABCDE1234F1Z5',
      BILLING_GST_RATE_BPS: 1800,
    })
    expect(taxFor(129900n, both)).toEqual([{ label: 'GST 18%', rateBps: 1800, amountMinor: 23382 }])
  })

  it('adds nothing without GST, or with only one of the two values', () => {
    expect(taxFor(129900n, manualBillingFromEnv(base))).toEqual([])
    expect(
      taxFor(129900n, manualBillingFromEnv({ ...base, BILLING_GSTIN: '33ABCDE1234F1Z5' })),
    ).toEqual([])
    expect(taxFor(129900n, manualBillingFromEnv({ ...base, BILLING_GST_RATE_BPS: 1800 }))).toEqual(
      [],
    )
  })
})
