import { describe, expect, it } from 'vitest'
import { noticeCopy, noticeLink } from '../src/modules/billing/subscriptions.core'
import { subscriptionNoticeEmail } from '../src/modules/platform'

const end = new Date('2026-11-05T00:00:00Z')
const trial = ['T-3', 'T-1', 'EXPIRED'] as const

describe('trial and lifecycle notice copy', () => {
  it('never says anything is paused when subscriptions are not enforced', () => {
    for (const n of [...trial, 'SUSPENDED', 'CANCELLED', 'PAST_DUE'] as const) {
      const c = noticeCopy(n, end, { graceDays: 7, enforced: false, managed: true })
      expect(`${c.title} ${c.body}`, n).not.toMatch(/paused|pause|suspended/i)
    }
  })

  it('in Managed Launch asks to pay the invoice by UPI or reply, never to request a plan', () => {
    for (const n of trial) {
      const c = noticeCopy(n, end, { graceDays: 7, enforced: false, managed: true })
      expect(c.body, n).toContain('Pay your invoice by UPI')
      expect(c.body, n).toContain('reply to this email')
      expect(c.body, n).not.toContain('Request a plan')
    }
    expect(noticeLink(true)).toBe('/billing/invoices')
  })

  it('states the pause only when enforced, and the real grace days', () => {
    expect(
      noticeCopy('EXPIRED', end, { graceDays: 7, enforced: true, managed: true }).body,
    ).toContain('are paused')
    expect(
      noticeCopy('PAST_DUE', end, { graceDays: 5, enforced: true, managed: true }).body,
    ).toContain('5 more days')
  })

  it('outside Managed Launch keeps the plan request wording', () => {
    expect(noticeCopy('T-3', end).body).toContain('Request a plan')
    expect(noticeLink(false)).toBe('/billing/subscription')
  })

  it('the email drops the plan-request line and links to billing in Managed Launch', () => {
    const copy = noticeCopy('T-1', end, { graceDays: 7, enforced: false, managed: true })
    const e = subscriptionNoticeEmail(
      'Asha',
      'Rao Retail',
      copy,
      'https://app.fenwira.com/billing/invoices',
      true,
    )
    expect(e.text).not.toContain('Plans are activated')
    expect(e.text).toContain('Reply to this email')
    expect(e.text).toContain('Open billing')
  })
})
