import { Injectable } from '@nestjs/common'
import { type HealthIndicator } from '../../../core/health/health-indicator'
import { OutboxRelayService } from './outbox-relay.service'

const MAX_HEARTBEAT_AGE_MS = 10_000

@Injectable()
export class OutboxRelayHealthIndicator implements HealthIndicator {
  readonly name = 'outbox-relay'
  constructor(private readonly relay: OutboxRelayService) {}

  async check(): Promise<void> {
    const age = Date.now() - this.relay.lastHeartbeatAt
    if (this.relay.lastHeartbeatAt === 0 || age > MAX_HEARTBEAT_AGE_MS) {
      throw new Error(
        this.relay.lastHeartbeatAt === 0
          ? 'relay has not completed a drain yet'
          : `last drain ${age}ms ago`,
      )
    }
  }
}
