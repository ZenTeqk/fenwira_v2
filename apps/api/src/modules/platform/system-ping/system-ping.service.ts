import { type SystemPingAccepted, type SystemPingStatus } from '@fenwira/contracts'
import { Database } from '@fenwira/database'
import { Inject, Injectable } from '@nestjs/common'
import type IORedis from 'ioredis'
import { requestContext } from '../../../core/context/request-context'
import { REDIS } from '../../../core/redis/redis.provider'
import { systemPingKey } from './system-ping.keys'

@Injectable()
export class SystemPingService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(REDIS) private readonly redis: IORedis,
  ) {}

  /** Writes a platform event to the outbox; the relay and worker take it from there. */
  async request(): Promise<SystemPingAccepted> {
    const correlationId = requestContext.correlationId() ?? 'unknown'
    const eventId = await this.db.system.emitPlatformEvent(
      'system.ping.requested',
      { requestedAt: new Date().toISOString() },
      correlationId,
    )
    return { eventId, correlationId }
  }

  async status(eventId: string): Promise<SystemPingStatus> {
    const raw = await this.redis.get(systemPingKey(eventId))
    if (!raw) return { eventId, status: 'PENDING' }
    const stored = JSON.parse(raw) as { processedAt: string; correlationId: string }
    return {
      eventId,
      status: 'PROCESSED',
      processedAt: stored.processedAt,
      correlationId: stored.correlationId,
    }
  }
}
