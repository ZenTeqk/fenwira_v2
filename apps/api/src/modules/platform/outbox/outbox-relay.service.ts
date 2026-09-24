import { type ClaimedOutboxEvent, Database } from '@fenwira/database'
import { type EventJob, outboxJobId, QUEUE_JOB_OPTIONS, subscribersFor } from '@fenwira/queue'
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Client } from 'pg'
import { requestContext } from '../../../core/context/request-context'
import { QueueRegistry } from '../../../core/queue/queue-registry'

export type OutboxRelayOptions = {
  databaseUrl: string
  pollIntervalMs: number
  batchSize: number
  leaseSeconds: number
  maxAttempts: number
}

export const OUTBOX_RELAY_OPTIONS = Symbol('OUTBOX_RELAY_OPTIONS')

/** Runs after an event was enqueued to all its subscribers (e.g. message CREATED → QUEUED). */
export type OutboxDispatchHook = (event: ClaimedOutboxEvent) => Promise<void>

/**
 * Transactional outbox relay (ADR-0013). Woken by LISTEN outbox_new and by a poll timer;
 * claims leased batches through system.claim_outbox_events, fans each event out to its
 * subscriber queues with deterministic job ids, then marks it dispatched or schedules a retry.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout
  private listener?: Client
  private reconnectTimer?: NodeJS.Timeout
  private draining = false
  private drainAgain = false
  private stopped = false
  /** Epoch ms of the last completed drain; the worker health check reads it. */
  lastHeartbeatAt = 0
  private readonly hooks = new Map<string, OutboxDispatchHook[]>()

  constructor(
    @Inject(Database) private readonly db: Database,
    private readonly queues: QueueRegistry,
    @Inject(OUTBOX_RELAY_OPTIONS) private readonly options: OutboxRelayOptions,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('OutboxRelay')
  }

  /** Modules register hooks at init; a failing hook is logged and never un-dispatches. */
  onDispatched(eventType: string, hook: OutboxDispatchHook): void {
    this.hooks.set(eventType, [...(this.hooks.get(eventType) ?? []), hook])
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.drain(), this.options.pollIntervalMs)
    void this.listen()
    void this.drain()
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true
    clearInterval(this.timer)
    clearTimeout(this.reconnectTimer)
    await this.listener?.end().catch(() => undefined)
  }

  /** Drains until a claim returns fewer rows than the batch size. Re-entrant calls coalesce. */
  async drain(): Promise<void> {
    if (this.stopped) return
    if (this.draining) {
      this.drainAgain = true
      return
    }
    this.draining = true
    try {
      do {
        this.drainAgain = false
        let claimed: ClaimedOutboxEvent[]
        do {
          claimed = await this.db.system.claimOutboxEvents(
            this.options.batchSize,
            this.options.leaseSeconds,
          )
          if (claimed.length > 0) await this.dispatchBatch(claimed)
        } while (claimed.length === this.options.batchSize && !this.stopped)
      } while (this.drainAgain && !this.stopped)
      this.lastHeartbeatAt = Date.now()
    } catch (err) {
      this.logger.error({ err }, 'outbox drain failed')
    } finally {
      this.draining = false
    }
  }

  private async dispatchBatch(events: ClaimedOutboxEvent[]): Promise<void> {
    const dispatched: string[] = []
    for (const event of events) {
      const correlationId = event.correlationId ?? `outbox-${event.id}`
      await requestContext.run({ correlationId, tenantId: event.tenantId }, async () => {
        try {
          await this.fanOut(event, correlationId)
          dispatched.push(event.id)
          for (const hook of this.hooks.get(event.eventType) ?? [])
            await hook(event).catch((err: unknown) =>
              this.logger.warn({ eventId: event.id, err }, 'outbox dispatch hook failed'),
            )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          this.logger.warn(
            { eventId: event.id, eventType: event.eventType, attempt: event.attempts, err },
            'outbox dispatch failed',
          )
          await this.db.system.markOutboxRetry(event.id, message, this.options.maxAttempts)
        }
      })
    }
    await this.db.system.markOutboxDispatched(dispatched)
  }

  private async fanOut(event: ClaimedOutboxEvent, correlationId: string): Promise<void> {
    const subscribers = subscribersFor(event.eventType)
    if (subscribers.length === 0) {
      this.logger.debug(
        { eventId: event.id, eventType: event.eventType },
        'outbox event has no subscribers',
      )
      return
    }
    const data = {
      eventId: event.id,
      eventType: event.eventType,
      tenantId: event.tenantId,
      correlationId,
      occurredAt: event.createdAt.toISOString(),
      payload: event.payload,
    } as EventJob
    for (const queueName of subscribers) {
      await this.queues.get(queueName).add(event.eventType, data, {
        ...QUEUE_JOB_OPTIONS[queueName],
        jobId: outboxJobId(event, queueName),
      })
    }
    this.logger.debug(
      { eventId: event.id, eventType: event.eventType, subscribers },
      'outbox event dispatched',
    )
  }

  private async listen(): Promise<void> {
    if (this.stopped) return
    const client = new Client({ connectionString: this.options.databaseUrl })
    client.on('notification', () => void this.drain())
    client.on('error', (err) => {
      this.logger.warn({ err }, 'outbox listener connection lost; reconnecting')
      this.scheduleReconnect(client)
    })
    try {
      await client.connect()
      await client.query('LISTEN outbox_new')
      this.listener = client
      this.logger.info('outbox relay listening')
    } catch (err) {
      this.logger.warn({ err }, 'outbox listener failed to connect; polling continues')
      this.scheduleReconnect(client)
    }
  }

  private scheduleReconnect(client: Client): void {
    void client.end().catch(() => undefined)
    if (this.listener === client) this.listener = undefined
    if (this.stopped || this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      void this.listen()
    }, 2000)
  }
}
