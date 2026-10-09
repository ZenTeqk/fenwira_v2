import { Injectable } from '@nestjs/common'
import { type Job } from 'bullmq'
import { type EventJob, QUEUES } from '@fenwira/queue'
import { type QueueProcessor } from '../../core/queue/queue-processor'
import { NativeService } from './native.service'
@Injectable()
export class NativeProcessor implements QueueProcessor<EventJob> {
  readonly queue = QUEUES.nativeTransfer
  readonly concurrency = 2
  constructor(private readonly service: NativeService) {}
  process(job: Job<EventJob>): Promise<string> {
    if (job.data.eventType !== 'native.transfer_requested') return Promise.resolve('ignored')
    const id = (job.data.payload as { transferId: string }).transferId
    if (!job.data.tenantId || typeof id !== 'string') return Promise.resolve('ignored')
    return this.service.process(job.data.tenantId, id)
  }
}
