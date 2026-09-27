import { afterAll, describe, expect, it } from 'vitest'
import { RealtimeEmitter } from '../src/core/realtime/realtime-emitter'

describe('RealtimeEmitter', () => {
  // Nothing listens on port 1: every publish waits in the offline queue and hits the 2 s timeout.
  const emitter = new RealtimeEmitter({ redisUrl: 'redis://127.0.0.1:1' } as never)
  afterAll(() => emitter.onApplicationShutdown())

  it('drops a publish that times out instead of leaving an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      emitter.toTenant('00000000-0000-4000-8000-000000000001', 'ping', { ok: true })
      await new Promise((r) => setTimeout(r, 2600))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  }, 10_000)
})
