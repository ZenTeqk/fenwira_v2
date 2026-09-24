import { type DefaultJobOptions, Queue, type QueueOptions } from 'bullmq'
import IORedis, { type RedisOptions } from 'ioredis'
import { type QueueName } from './names'

/**
 * Redis connections by role:
 * - `worker`: BullMQ blocking consumers (BullMQ requires maxRetriesPerRequest=null).
 * - `producer`: BullMQ producers; fail fast (no offline queue) so enqueues never hang.
 * - `command`: application commands (rate limits, session deny-set, locks). Commands issued while
 *   (re)connecting are queued briefly instead of failing — otherwise every request right after
 *   boot or during a reconnect would error — and time out after 2 s during a real outage.
 */
export function createRedisConnection(
  url: string,
  role: 'worker' | 'producer' | 'command',
  overrides: RedisOptions = {},
): IORedis {
  const base: RedisOptions =
    role === 'worker'
      ? { maxRetriesPerRequest: null, enableReadyCheck: true }
      : role === 'producer'
        ? { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000 }
        : {
            maxRetriesPerRequest: 1,
            enableOfflineQueue: true,
            commandTimeout: 2000,
            connectTimeout: 2000,
          }
  const connection = new IORedis(url, {
    ...base,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    lazyConnect: false,
    ...overrides,
  })
  // An 'error' event without a listener crashes the process; callers observe status instead.
  connection.on('error', () => undefined)
  return connection
}

export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
}

export function createQueue<N extends QueueName>(
  name: N,
  connection: IORedis,
  options: Omit<QueueOptions, 'connection'> = {},
): Queue {
  const queue = new Queue(name, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    ...options,
  })
  queue.on('error', () => undefined)
  return queue
}
