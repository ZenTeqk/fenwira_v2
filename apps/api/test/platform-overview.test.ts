import { platformOverviewSchema } from '@fenwira/contracts'
import { describe, expect, it, vi } from 'vitest'
import { requestContext } from '../src/core/context/request-context'
import { PlatformOverviewService } from '../src/modules/platform-operations/platform-overview.service'

const raw = {
  statusCounts: { TRIALING: 3, ACTIVE: 2, PAST_DUE: 1 },
  newWorkspaces: [{ month: '2026-10', count: 6 }],
  mrr: [{ currency: 'INR', amountMinor: 259800, workspaces: 2 }],
  trialsEnding: [],
  connections: [
    {
      workspaceId: '0192a8f0-0000-7000-8000-000000000001',
      name: 'Rao Retail',
      number: '+91 90000 00001',
      status: 'CONNECTED',
      quality: 'GREEN',
      messagingLimit: 'TIER_1K',
      webhook: 'ACTIVE',
      lastWebhookAt: null,
      verifyOk: true,
      verifyErrorCode: null,
    },
    {
      workspaceId: '0192a8f0-0000-7000-8000-000000000002',
      name: 'Asha Foods',
      number: '+91 90000 00002',
      status: 'FLAGGED',
      quality: 'RED',
      messagingLimit: null,
      webhook: 'ACTIVE',
      lastWebhookAt: null,
      verifyOk: false,
      verifyErrorCode: '190',
    },
  ],
  messagesByDay: [{ day: '2026-10-22', inbound: 5, outbound: 9 }],
  failedSends7d: 1,
  emailFailures7d: 2,
  accessRequests: { new7d: 4, unsent: 1 },
}

function service() {
  const system = {
    platformOverview: vi.fn(async () => raw),
    platformRevenueByMonth: vi.fn(async () => [
      {
        month: new Date('2026-10-01T00:00:00Z'),
        currency: 'INR',
        total_minor: 129900n,
        payments: 1,
      },
    ]),
    platformPendingProofs: vi.fn(async () => [{ proof_id: 'p1' }]),
    platformOverdueWorkspaces: vi.fn(async () => [{ tenant_id: 't1' }, { tenant_id: 't2' }]),
  }
  const queue = { getJobCounts: vi.fn(async () => ({ waiting: 1, delayed: 2, failed: 0 })) }
  const svc = new PlatformOverviewService({ system } as never, { get: () => queue } as never)
  return { svc, system }
}
const asOperator = <T>(fn: () => Promise<T>) =>
  requestContext.run({ correlationId: 'c', platform: { operatorId: 'op-1' } } as never, fn)

describe('platform overview', () => {
  it('requires an operator session', async () => {
    await expect(service().svc.overview()).rejects.toMatchObject({ status: 403 })
  })

  it('combines aggregates and lists what needs attention', async () => {
    const { svc, system } = service()
    const o = await asOperator(() => svc.overview())
    expect(platformOverviewSchema.parse(o)).toBeTruthy()
    expect(system.platformOverview).toHaveBeenCalledWith('op-1', expect.any(Date))
    expect(o.pendingPayments).toBe(1)
    expect(o.overdueWorkspaces).toBe(2)
    expect(o.revenueByMonth).toEqual([
      { month: '2026-10', currency: 'INR', totalMinor: 129900, payments: 1 },
    ])
    expect(o.queueBacklog.waiting).toBeGreaterThan(0)
    expect(o.attention.map((a) => a.kind)).toEqual([
      'PENDING_UTR',
      'OVERDUE',
      'UNHEALTHY_CONNECTION',
      'EMAIL_FAILURES',
      'NEW_ACCESS_REQUESTS',
      'UNSENT_LEADS',
    ])
    expect(o.attention.find((a) => a.kind === 'NEW_ACCESS_REQUESTS')!.title).toBe(
      '4 new access requests in the last 7 days',
    )
    const unhealthy = o.attention.find((a) => a.kind === 'UNHEALTHY_CONNECTION')!
    expect(unhealthy.title).toContain('Asha Foods')
    expect(unhealthy.title).toContain('quality red')
    expect(unhealthy.href).toBe('/platform/workspaces/0192a8f0-0000-7000-8000-000000000002')
  })

  it('carries no secrets or message content', async () => {
    const o = JSON.stringify(await asOperator(() => service().svc.overview()))
    for (const banned of [
      'token',
      'secret',
      'Ciphertext',
      'password',
      '"body":',
      '"text":',
      '"email":',
      '"phone":',
    ])
      expect(o).not.toContain(banned)
  })
})
