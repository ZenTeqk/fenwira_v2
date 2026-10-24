import { describe, expect, it } from 'vitest'
import { invoiceDocument } from '../src/modules/billing/invoice-document'
import {
  displayStatusOf,
  majorAmount,
  taxFor,
  toInvoiceDetail,
  upiDeepLink,
} from '../src/modules/billing/invoices.core'
import { manualBillingFromEnv } from '../src/modules/billing/billing.options'

/** ADR-0027 manual UPI billing: the pure pieces (deep link, amounts, tax, status, document). */
describe('UPI payment request', () => {
  const inv = {
    payeeVpa: 'fenwira@okaxis',
    payeeName: 'ZenteqK Fenwira & Co',
    totalMinor: 149_950n,
    currency: 'INR',
    number: 'FW-INV-000042',
  }

  it('builds upi://pay with percent-encoded values and a two-decimal amount', () => {
    expect(upiDeepLink(inv)).toBe(
      'upi://pay?pa=fenwira%40okaxis&pn=ZenteqK%20Fenwira%20%26%20Co&am=1499.50&cu=INR&tn=FW-INV-000042',
    )
  })

  it('puts the exact amount, payee, VPA and invoice number in a ~512 px QR', async () => {
    const now = new Date()
    const detail = await toInvoiceDetail({
      id: '00000000-0000-7000-8000-000000000001',
      tenantId: '00000000-0000-7000-8000-000000000002',
      number: inv.number,
      kind: 'PLAN_RENEWAL',
      status: 'OPEN',
      currency: 'INR',
      subtotalMinor: inv.totalMinor,
      taxMinor: 0n,
      totalMinor: inv.totalMinor,
      taxLines: [],
      planId: null,
      plan: null,
      description: 'Growth plan',
      dueAt: now,
      payeeVpa: inv.payeeVpa,
      payeeName: inv.payeeName,
      gstin: null,
      createdByType: 'SYSTEM',
      createdById: null,
      issuedAt: now,
      paidAt: null,
      voidedAt: null,
      voidReason: null,
      commercialOperationId: null,
      createdAt: now,
      updatedAt: now,
      proofs: [],
    })
    const link = new URL(detail.upi!.deepLink.replace('upi://pay', 'https://upi.invalid/pay'))
    expect(Object.fromEntries(link.searchParams)).toEqual({
      pa: 'fenwira@okaxis',
      pn: 'ZenteqK Fenwira & Co',
      am: '1499.50',
      cu: 'INR',
      tn: 'FW-INV-000042',
    })
    const png = Buffer.from(detail.upi!.qrDataUrl.split(',')[1]!, 'base64')
    // IHDR width/height: whole pixels per module, so within a module of 512.
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(500)
    expect(png.readUInt32BE(20)).toBe(png.readUInt32BE(16))
  })

  it('formats minor units exactly, without floating point', () => {
    expect(majorAmount(5n)).toBe('0.05')
    expect(majorAmount(100n)).toBe('1.00')
    expect(majorAmount(123_456_789_01n)).toBe('123456789.01')
  })
})

describe('GST (ML-D3: only when configured)', () => {
  const base = {
    MANAGED_LAUNCH_MODE: true,
    BILLING_GRACE_DAYS: 7,
    BILLING_INVOICE_LEAD_DAYS: 7,
    UPI_VPA: 'a@b',
    UPI_PAYEE_NAME: 'A',
  }
  it('adds no tax line when GST is not configured', () => {
    expect(taxFor(100_000n, manualBillingFromEnv(base))).toEqual([])
    // A GSTIN alone (no rate) still means no GST.
    expect(
      taxFor(100_000n, manualBillingFromEnv({ ...base, BILLING_GSTIN: '29ABCDE1234F1Z5' })),
    ).toEqual([])
  })
  it('adds one rounded GST line when GSTIN and rate are set', () => {
    const manual = manualBillingFromEnv({
      ...base,
      BILLING_GSTIN: '29ABCDE1234F1Z5',
      BILLING_GST_RATE_BPS: 1800,
    })
    expect(taxFor(149_950n, manual)).toEqual([
      { label: 'GST 18%', rateBps: 1800, amountMinor: 26_991 },
    ])
  })
  it('needs both VPA and payee name for a payee', () => {
    expect(manualBillingFromEnv({ ...base, UPI_PAYEE_NAME: undefined }).payee).toBeUndefined()
  })
})

describe('display status', () => {
  const row = (over: Record<string, unknown>) =>
    ({ status: 'OPEN', dueAt: new Date('2026-11-01T00:00:00Z'), proofs: [], ...over }) as never
  const now = new Date('2026-10-23T00:00:00Z')
  it('is DUE before the due date, OVERDUE after, PAYMENT_SUBMITTED with a pending proof', () => {
    expect(displayStatusOf(row({}), now)).toBe('DUE')
    expect(displayStatusOf(row({ dueAt: new Date('2026-10-01T00:00:00Z') }), now)).toBe('OVERDUE')
    expect(
      displayStatusOf(row({ proofs: [{ status: 'REJECTED' }, { status: 'PENDING' }] }), now),
    ).toBe('PAYMENT_SUBMITTED')
    expect(displayStatusOf(row({ status: 'PAID' }), now)).toBe('PAID')
    expect(displayStatusOf(row({ status: 'VOID' }), now)).toBe('VOID')
  })
})

describe('invoice document', () => {
  it('escapes every interpolated value and carries no script', () => {
    const html = invoiceDocument(
      {
        id: '00000000-0000-7000-8000-000000000001',
        number: 'FW-INV-000001',
        kind: 'WALLET_TOPUP',
        status: 'OPEN',
        displayStatus: 'DUE',
        currency: 'INR',
        subtotalMinor: 100,
        taxMinor: 0,
        totalMinor: 100,
        taxLines: [],
        description: '<img src=x onerror=alert(1)>',
        plan: null,
        dueAt: '2026-11-01T00:00:00.000Z',
        issuedAt: '2026-10-23T00:00:00.000Z',
        paidAt: null,
        voidReason: null,
        payee: { vpa: 'a@b', name: '"Payee"' },
        gstin: null,
        receiptNumber: null,
        proofs: [],
        upi: { deepLink: 'upi://pay?pa=a%40b', qrDataUrl: 'data:image/png;base64,AAAA' },
      },
      { name: '</title><script>alert(1)</script>' },
      'request',
    )
    expect(html).not.toMatch(/<script|<img src=x/)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('not a tax invoice')
  })
})
