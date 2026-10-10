import { type QueueName } from '@fenwira/queue'
import { type Job } from 'bullmq'

/**
 * A BullMQ consumer. Implementations must be idempotent (ADR-0014): jobs are delivered
 * at least once. Register with WorkerRuntimeModule.forRoot({ processors: [...] }).
 */
export interface QueueProcessor<Data = unknown, Result = unknown> {
  readonly queue: QueueName
  readonly concurrency?: number
  /** Custom delay for jobs added with `backoff: { type: 'custom' }` (ms before the next try). */
  backoffStrategy?(attemptsMade: number, err: Error | undefined, job: Job<Data> | undefined): number
  /** `token` is the lock token BullMQ needs for job.moveToDelayed(). */
  process(job: Job<Data>, token?: string): Promise<Result>
}

export const QUEUE_PROCESSORS = Symbol('QUEUE_PROCESSORS')
