import { type HealthIndicator, QueueWorkersService } from '@fenwira/api/core'
import { Injectable } from '@nestjs/common'

@Injectable()
export class ProcessorsHealthIndicator implements HealthIndicator {
  readonly name = 'processors'
  constructor(private readonly workers: QueueWorkersService) {}

  async check(): Promise<void> {
    if (this.workers.registeredQueues.length === 0) throw new Error('no processors registered')
    const stopped = this.workers.notRunning()
    if (stopped.length > 0) throw new Error(`not running: ${stopped.join(', ')}`)
  }
}
