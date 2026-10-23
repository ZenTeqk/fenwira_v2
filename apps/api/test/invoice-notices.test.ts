import { describe, expect, it } from 'vitest'
import { invoiceNoticeKey } from '../src/modules/billing'
import { invoiceNoticeCopy } from '../src/modules/notifications/invoice-notices'
import { invoiceNoticeEmail } from '../src/modules/platform'

const facts = { number: 'FW-INV-000042', amount: '₹1,299.00', dueDate: '26 Oct 2026' }

describe('invoice notices', () => {
  it('has plain copy for every notice, with the number and amount', () => {
    for (const n of ['ISSUED', 'DUE_SOON', 'OVERDUE', 'PAID', 'REJECTED'] as const) {
      const c = invoiceNoticeCopy(n, {
        ...facts,
        receiptNumber: 'FW-RCT-000007',
        reason: 'No match',
      })
      expect(c.subject).toContain('FW-INV-000042')
      expect(c.lines.join(' ').length).toBeGreaterThan(20)
    }
    expect(invoiceNoticeCopy('ISSUED', facts).lines[0]).toContain('₹1,299.00')
    expect(invoiceNoticeCopy('OVERDUE', facts).severity).toBe('WARNING')
    expect(
      invoiceNoticeCopy('PAID', { ...facts, receiptNumber: 'FW-RCT-000007' }).lines[0],
    ).toContain('FW-RCT-000007')
    expect(invoiceNoticeCopy('REJECTED', { ...facts, reason: 'No match' }).lines[0]).toContain(
      'No match',
    )
  })

  it('dedupe keys match the in-app notification keys', () => {
    expect(invoiceNoticeKey('i1', 'ISSUED')).toBe('invoice:i1:issued')
    expect(invoiceNoticeKey('i1', 'DUE_SOON')).toBe('invoice:i1:due-soon')
    expect(invoiceNoticeKey('i1', 'OVERDUE')).toBe('invoice:i1:overdue')
    expect(invoiceNoticeKey('i1', 'PAID')).toBe('invoice:i1:paid')
    expect(invoiceNoticeKey('i1', 'REJECTED', 'p1')).toBe('proof:p1:rejected')
  })

  it('renders an escaped email with the billing link', () => {
    const e = invoiceNoticeEmail(
      'Asha <b>',
      'Rao Retail',
      invoiceNoticeCopy('ISSUED', facts),
      'https://app.fenwira.com/billing/invoices?invoice=i1',
    )
    expect(e.subject).toBe('Payment request FW-INV-000042: ₹1,299.00')
    expect(e.html).not.toContain('<b>')
    expect(e.text).toContain('https://app.fenwira.com/billing/invoices?invoice=i1')
  })
})
