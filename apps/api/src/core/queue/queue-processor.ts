import { type QueueName } from '@fenwira/queue'
import { type Job } from 'bullmq'

/**
 * A BullMQ consumer. Implementations must be idempotent (ADR-0014): jobs are delivered
 * at least once. Register with WorkerRuntimeModule.forRoot({ processors: [...] }).
 */
export interface QueueProcessor<Data = unknown, Result = unknown> {
  readonly queue: QueueName
  readonly concurrency?: number
  process(job: Job<Data>): Promise<Result>
}

export const QUEUE_PROCESSORS = Symbol('QUEUE_PROCESSORS')
