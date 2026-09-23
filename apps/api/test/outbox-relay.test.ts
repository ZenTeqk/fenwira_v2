import { type ClaimedOutboxEvent, type Database } from '@fenwira/database'
import { type PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type QueueRegistry } from '../src/core/queue/queue-registry'
import { OutboxRelayService } from '../src/modules/platform/outbox/outbox-relay.service'

const logger = { setContext: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }

function event(id: string, eventType = 'system.ping.requested'): ClaimedOutboxEvent {
  return {
    id,
    tenantId: null,
    eventType,
    payload: { requestedAt: '2026-09-23T00:00:00.000Z' },
    correlationId: `corr-${id}`,
    attempts: 1,
    createdAt: new Date('2026-09-23T00:00:00Z'),
  }
}

function setup(
  batches: ClaimedOutboxEvent[][],
  addImpl?: (name: string, data: unknown, opts: unknown) => Promise<unknown>,
) {
  const system = {
    claimOutboxEvents: vi.fn(async () => batches.shift() ?? []),
    markOutboxDispatched: vi.fn(async (ids: string[]) => ids.length),
    markOutboxRetry: vi.fn(async () => undefined),
  }
  const add = vi.fn(addImpl ?? (async () => ({})))
  const queues = { get: vi.fn(() => ({ add })) }
  const relay = new OutboxRelayService(
    { system } as unknown as Database,
    queues as unknown as QueueRegistry,
    {
      databaseUrl: 'postgres://x',
      pollIntervalMs: 1000,
      batchSize: 2,
      leaseSeconds: 30,
      maxAttempts: 20,
    },
    logger as unknown as PinoLogger,
  )
  return { relay, system, add, queues }
}

beforeEach(() => vi.clearAllMocks())

describe('OutboxRelayService.drain', () => {
  it('fans events out with deterministic job ids and marks them dispatched', async () => {
    const { relay, system, add, queues } = setup([[event('e1')]])
    await relay.drain()
    expect(queues.get).toHaveBeenCalledWith('system.ping')
    expect(add).toHaveBeenCalledWith(
      'system.ping.requested',
      expect.objectContaining({ eventId: 'e1', correlationId: 'corr-e1', tenantId: null }),
      { jobId: 'e1__system.ping' },
    )
    expect(system.markOutboxDispatched).toHaveBeenCalledWith(['e1'])
    expect(relay.lastHeartbeatAt).toBeGreaterThan(0)
  })

  it('keeps claiming while full batches come back', async () => {
    const { relay, system } = setup([[event('a'), event('b')], [event('c')]])
    await relay.drain()
    expect(system.claimOutboxEvents).toHaveBeenCalledTimes(2)
    expect(system.markOutboxDispatched).toHaveBeenNthCalledWith(1, ['a', 'b'])
    expect(system.markOutboxDispatched).toHaveBeenNthCalledWith(2, ['c'])
  })

  it('marks events without subscribers as dispatched without enqueueing', async () => {
    const { relay, system, add } = setup([[event('x', 'nobody.listens')]])
    await relay.drain()
    expect(add).not.toHaveBeenCalled()
    expect(system.markOutboxDispatched).toHaveBeenCalledWith(['x'])
  })

  it('schedules a retry when enqueueing fails and still dispatches the rest', async () => {
    const { relay, system } = setup([[event('bad'), event('good')]], async (_n, data) => {
      if ((data as { eventId: string }).eventId === 'bad') throw new Error('Connection is closed.')
      return {}
    })
    await relay.drain()
    expect(system.markOutboxRetry).toHaveBeenCalledWith('bad', 'Connection is closed.', 20)
    expect(system.markOutboxDispatched).toHaveBeenCalledWith(['good'])
  })

  it('coalesces concurrent drains into one extra pass', async () => {
    const { relay, system } = setup([[event('1')], [], []])
    await Promise.all([relay.drain(), relay.drain(), relay.drain()])
    // First pass claims [1] then [] (short batch ends inner loop); the coalesced re-run claims once more.
    expect(system.claimOutboxEvents).toHaveBeenCalledTimes(2)
  })

  it('survives a database outage without throwing and without a heartbeat', async () => {
    const { relay, system } = setup([])
    system.claimOutboxEvents.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(relay.drain()).resolves.toBeUndefined()
    expect(relay.lastHeartbeatAt).toBe(0)
  })
})
