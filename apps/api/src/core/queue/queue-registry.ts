import { createQueue, createRedisConnection, type QueueName } from '@fenwira/queue'
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common'
import { type Queue } from 'bullmq'
import type IORedis from 'ioredis'
import { CORE_CONFIG, type CoreConfig } from '../config/core-config'

/** Lazily-created BullMQ producers sharing one fail-fast connection. */
@Injectable()
export class QueueRegistry implements OnApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue>()
  private readonly connection: IORedis

  constructor(@Inject(CORE_CONFIG) config: CoreConfig) {
    this.connection = createRedisConnection(config.redisUrl, 'producer')
  }

  get(name: QueueName): Queue {
    let queue = this.queues.get(name)
    if (!queue) {
      queue = createQueue(name, this.connection)
      this.queues.set(name, queue)
    }
    return queue
  }

  get connectionStatus(): string {
    return this.connection.status
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()))
    await this.connection.quit().catch(() => this.connection.disconnect())
  }
}
