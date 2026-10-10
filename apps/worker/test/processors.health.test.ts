import { type QueueWorkersService } from '@fenwira/api/core'
import { describe, expect, it } from 'vitest'
import { ProcessorsHealthIndicator } from '../src/processors.health'

const indicator = (registered: string[], stopped: string[]) =>
  new ProcessorsHealthIndicator({
    registeredQueues: registered,
    notRunning: () => stopped,
  } as unknown as QueueWorkersService)

describe('ProcessorsHealthIndicator', () => {
  it('is healthy when every registered processor is running', async () => {
    await expect(indicator(['system.ping'], []).check()).resolves.toBeUndefined()
  })

  it('fails when nothing is registered', async () => {
    await expect(indicator([], []).check()).rejects.toThrow('no processors registered')
  })

  it('names stopped processors', async () => {
    await expect(indicator(['system.ping'], ['system.ping']).check()).rejects.toThrow(
      'not running: system.ping',
    )
  })
})
