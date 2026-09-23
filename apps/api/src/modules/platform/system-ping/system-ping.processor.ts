import { EVENT_PAYLOAD_SCHEMAS } from '@fenwira/contracts'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import type IORedis from 'ioredis'
import { PinoLogger } from 'nestjs-pino'
import { type QueueProcessor } from '../../../core/queue/queue-processor'
import { REDIS } from '../../../core/redis/redis.provider'
import { SYSTEM_PING_TTL_SECONDS, systemPingKey } from './system-ping.keys'

@Injectable()
export class SystemPingProcessor implements QueueProcessor<EventJob<'system.ping.requested'>> {
  readonly queue = QUEUES.systemPing
  readonly concurrency = 1

  constructor(
    @Inject(REDIS) private readonly redis: IORedis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('SystemPingProcessor')
  }

  /** Idempotent: re-processing overwrites the same key with a fresh timestamp. */
  async process(job: Job<EventJob<'system.ping.requested'>>): Promise<{ processedAt: string }> {
    const payload = EVENT_PAYLOAD_SCHEMAS['system.ping.requested'].parse(job.data.payload)
    const processedAt = new Date().toISOString()
    await this.redis.set(
      systemPingKey(job.data.eventId),
      JSON.stringify({
        processedAt,
        correlationId: job.data.correlationId,
        requestedAt: payload.requestedAt,
      }),
      'EX',
      SYSTEM_PING_TTL_SECONDS,
    )
    this.logger.info({ eventId: job.data.eventId }, 'system.ping processed')
    return { processedAt }
  }
}
