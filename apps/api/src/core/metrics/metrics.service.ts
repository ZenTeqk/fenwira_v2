import { ALL_QUEUE_NAMES, QUEUES } from '@fenwira/queue'
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'
import { createServer, type Server } from 'node:http'
import { Counter, Gauge, Histogram, Registry } from 'prom-client'
import { CORE_CONFIG, type CoreConfig } from '../config/core-config'
import { QueueRegistry } from '../queue/queue-registry'

/**
 * Prometheus metrics (docs/OBSERVABILITY.md → Metrics). Labels never carry tenant, user or
 * message ids. The worker serves /metrics on its internal health port; the API serves it on
 * METRICS_PORT, which compose never publishes.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  readonly registry = new Registry()
  private server?: Server

  readonly webhookReceived = new Counter({
    name: 'webhook_received_total',
    help: 'WhatsApp webhook events by kind and result',
    labelNames: ['kind', 'result'] as const,
    registers: [this.registry],
  })
  readonly webhookIngestDuration = new Histogram({
    name: 'webhook_ingest_duration_ms',
    help: 'Time to verify, persist and enqueue a webhook request',
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
    registers: [this.registry],
  })
  readonly metaRequests = new Counter({
    name: 'meta_api_requests_total',
    help: 'Graph API calls from the messaging engine',
    labelNames: ['endpoint', 'result', 'error_code'] as const,
    registers: [this.registry],
  })
  readonly metaDuration = new Histogram({
    name: 'meta_api_duration_ms',
    help: 'Graph API call duration',
    labelNames: ['endpoint'] as const,
    buckets: [50, 100, 250, 500, 1000, 2500, 5000, 15000],
    registers: [this.registry],
  })
  // Campaigns (Phase 9): throughput, outcomes, retries and duration. No tenant or campaign labels.
  readonly campaignRecipients = new Counter({
    name: 'campaign_recipients_total',
    help: 'Campaign recipients processed by the dispatcher, by outcome',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  })
  readonly campaignBatches = new Counter({
    name: 'campaign_dispatch_batches_total',
    help: 'Campaign dispatch batches run, by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  })
  readonly campaignRetries = new Counter({
    name: 'campaign_job_retries_total',
    help: 'Campaign jobs run again after a failure',
    registers: [this.registry],
  })
  readonly campaignDuration = new Histogram({
    name: 'campaign_duration_seconds',
    help: 'From the first send to completion',
    buckets: [10, 60, 300, 900, 3600, 4 * 3600, 24 * 3600],
    registers: [this.registry],
  })

  readonly messageStatus = new Counter({
    name: 'messages_status_total',
    help: 'Message status transitions',
    labelNames: ['direction', 'status'] as const,
    registers: [this.registry],
  })

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    queueRegistry: QueueRegistry,
  ) {
    this.registry.setDefaultLabels({ service: config.service })
    const queues = queueRegistry
    new Gauge({
      name: 'queue_depth',
      help: 'Jobs per queue and state',
      labelNames: ['queue', 'state'] as const,
      registers: [this.registry],
      async collect() {
        this.reset()
        for (const name of ALL_QUEUE_NAMES) {
          const counts = await queues
            .get(name)
            .getJobCounts('waiting', 'delayed', 'active', 'failed')
            .catch(() => null)
          if (!counts) continue
          for (const [state, n] of Object.entries(counts)) this.set({ queue: name, state }, n)
        }
      },
    })
    new Gauge({
      name: 'dlq_size',
      help: 'Jobs parked in dead-letter queues',
      labelNames: ['queue'] as const,
      registers: [this.registry],
      async collect() {
        const counts = await queues
          .get(QUEUES.whatsappOutboundDlq)
          .getJobCounts('waiting', 'delayed', 'paused')
          .catch(() => null)
        if (counts)
          this.set(
            { queue: QUEUES.whatsappOutboundDlq },
            Object.values(counts).reduce((a, b) => a + b, 0),
          )
      },
    })
  }

  metrics(): Promise<string> {
    return this.registry.metrics()
  }

  get contentType(): string {
    return this.registry.contentType
  }

  /** API only: a separate listener on an internal port (the worker uses its health server). */
  onApplicationBootstrap(): void {
    if (!this.config.metricsPort) return
    this.server = createServer((req, res) => {
      if (req.url !== '/metrics') {
        res.writeHead(404).end()
        return
      }
      this.metrics()
        .then((body) => res.writeHead(200, { 'Content-Type': this.contentType }).end(body))
        .catch(() => res.writeHead(500).end())
    })
    this.server.listen(this.config.metricsPort, '0.0.0.0')
  }

  onApplicationShutdown(): void {
    this.server?.close()
  }
}
