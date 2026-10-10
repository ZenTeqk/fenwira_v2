import { Database } from '@fenwira/database'
import { QUEUES } from '@fenwira/queue'
import { Inject, Injectable } from '@nestjs/common'
import type IORedis from 'ioredis'
import { QueueRegistry } from '../queue/queue-registry'
import { REDIS } from '../redis/redis.provider'
import { type HealthIndicator, withTimeout } from './health-indicator'

const CHECK_TIMEOUT_MS = 1000

@Injectable()
export class PostgresHealthIndicator implements HealthIndicator {
  readonly name = 'postgres'
  constructor(@Inject(Database) private readonly db: Database) {}
  check(): Promise<void> {
    return this.db.ping(CHECK_TIMEOUT_MS)
  }
}

@Injectable()
export class RedisHealthIndicator implements HealthIndicator {
  readonly name = 'redis'
  constructor(@Inject(REDIS) private readonly redis: IORedis) {}
  async check(): Promise<void> {
    const reply = await withTimeout(this.redis.ping(), CHECK_TIMEOUT_MS, 'redis ping')
    if (reply !== 'PONG') throw new Error(`unexpected PING reply: ${reply}`)
  }
}

/** BullMQ producer connection is up and can reach its queue keys. */
@Injectable()
export class QueueHealthIndicator implements HealthIndicator {
  readonly name = 'queue'
  constructor(private readonly queues: QueueRegistry) {}
  async check(): Promise<void> {
    const queue = this.queues.get(QUEUES.systemPing)
    const client = await withTimeout(queue.client, CHECK_TIMEOUT_MS, 'queue client')
    if (client.status !== 'ready') throw new Error(`queue connection is ${client.status}`)
    await withTimeout(queue.getJobCounts('waiting'), CHECK_TIMEOUT_MS, 'queue job counts')
  }
}
