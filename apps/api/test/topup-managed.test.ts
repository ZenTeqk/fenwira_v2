import { describe, expect, it, vi } from 'vitest'
import { CommercialOperationService } from '../src/modules/platform-operations/commercial-operation.service'

const service = (enabled: boolean) => {
  const svc = Object.create(CommercialOperationService.prototype) as CommercialOperationService
  const run = vi.fn(async () => ({ result: { invoiceId: 'i1' } }))
  Object.assign(svc, { billing: { manual: { enabled, graceDays: 7, leadDays: 3 } }, run })
  return { svc, run }
}
const body = (kind: 'PLAN_RENEWAL' | 'WALLET_TOPUP') => ({
  kind,
  amountMinor: 50_000,
  planKey: kind === 'PLAN_RENEWAL' ? 'GROWTH' : undefined,
  dueAt: '2026-11-01T00:00:00.000Z',
  idempotencyKey: '0192a8f0-0000-7000-8000-000000000001',
})

describe('wallet top-up invoices in Managed Launch', () => {
  it('are refused with WALLET_TOPUP_DISABLED', async () => {
    const { svc, run } = service(true)
    await expect(svc.issueInvoice('t1', body('WALLET_TOPUP') as never)).rejects.toMatchObject({
      status: 422,
      code: 'WALLET_TOPUP_DISABLED',
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('still allow plan invoices, and top-ups outside Managed Launch', async () => {
    const managed = service(true)
    await managed.svc.issueInvoice('t1', body('PLAN_RENEWAL') as never)
    expect(managed.run).toHaveBeenCalledTimes(1)
    const classic = service(false)
    await classic.svc.issueInvoice('t1', body('WALLET_TOPUP') as never)
    expect(classic.run).toHaveBeenCalledTimes(1)
  })
})
