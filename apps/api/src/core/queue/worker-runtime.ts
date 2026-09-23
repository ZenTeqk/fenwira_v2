import { createRedisConnection } from '@fenwira/queue'
import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type ModuleMetadata,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Type,
} from '@nestjs/common'
import { type Job, Worker } from 'bullmq'
import type IORedis from 'ioredis'
import { PinoLogger } from 'nestjs-pino'
import { CORE_CONFIG, type CoreConfig } from '../config/core-config'
import { requestContext } from '../context/request-context'
import { QUEUE_PROCESSORS, type QueueProcessor } from './queue-processor'

type JobData = { correlationId?: string | null; tenantId?: string | null }

/** Starts one BullMQ Worker per registered processor, each job inside its own log context. */
@Injectable()
export class QueueWorkersService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly workers: Worker[] = []
  private connection?: IORedis

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    @Inject(QUEUE_PROCESSORS) private readonly processors: QueueProcessor[],
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('QueueWorkers')
  }

  onApplicationBootstrap(): void {
    this.connection = createRedisConnection(this.config.redisUrl, 'worker')
    for (const processor of this.processors) {
      const worker = new Worker(processor.queue, (job: Job) => this.run(processor, job), {
        connection: this.connection,
        concurrency: processor.concurrency ?? 1,
        autorun: true,
      })
      worker.on('failed', (job, err) =>
        this.logger.warn(
          { queue: processor.queue, jobId: job?.id, attempt: job?.attemptsMade, err },
          'job failed',
        ),
      )
      worker.on('error', (err) =>
        this.logger.error({ queue: processor.queue, err }, 'worker error'),
      )
      this.workers.push(worker)
      this.logger.info(
        { queue: processor.queue, concurrency: processor.concurrency ?? 1 },
        'processor registered',
      )
    }
  }

  private run(processor: QueueProcessor, job: Job): Promise<unknown> {
    const data = (job.data ?? {}) as JobData
    return requestContext.run(
      {
        correlationId: data.correlationId ?? `job-${job.id}`,
        tenantId: data.tenantId ?? null,
        jobId: job.id,
        queue: processor.queue,
      },
      () => processor.process(job),
    )
  }

  /** Names of queues whose worker is not currently running. */
  notRunning(): string[] {
    return this.workers.filter((w) => !w.isRunning()).map((w) => w.name)
  }

  get registeredQueues(): string[] {
    return this.workers.map((w) => w.name)
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()))
    await this.connection?.quit().catch(() => this.connection?.disconnect())
  }
}

@Module({})
export class WorkerRuntimeModule {
  /** `imports` must provide (and export) every processor class listed in `processors`. */
  static forRoot(options: {
    imports: ModuleMetadata['imports']
    processors: Type<QueueProcessor>[]
  }): DynamicModule {
    return {
      module: WorkerRuntimeModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: QUEUE_PROCESSORS,
          useFactory: (...processors: QueueProcessor[]) => processors,
          inject: options.processors,
        },
        QueueWorkersService,
      ],
      exports: [QueueWorkersService],
    }
  }
}
