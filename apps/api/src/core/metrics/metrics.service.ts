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

  // Automation (Phase 10). No tenant, flow or execution labels.
  readonly automationTriggerRuns = new Counter({
    name: 'automation_trigger_runs_total',
    help: 'Triggering events evaluated by the automation engine, by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  })
  readonly automationExecutions = new Counter({
    name: 'automation_executions_total',
    help: 'Automation executions reaching a terminal state (or started), by status',
    labelNames: ['status'] as const,
    registers: [this.registry],
  })
  readonly automationSteps = new Counter({
    name: 'automation_steps_total',
    help: 'Automation steps executed, by node type and status',
    labelNames: ['node_type', 'status'] as const,
    registers: [this.registry],
  })
  readonly automationStepDuration = new Histogram({
    name: 'automation_step_duration_seconds',
    help: 'Time to execute one automation step, by node type',
    labelNames: ['node_type'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  })
  readonly automationRetries = new Counter({
    name: 'automation_job_retries_total',
    help: 'Automation jobs run again after a failure',
    registers: [this.registry],
  })

  // Billing (Phase 11) and operational alerts (decision O1). No tenant or wallet labels.
  readonly opsAlerts = new Counter({
    name: 'ops_alerts_total',
    help: 'Operational alerts raised, by kind',
    labelNames: ['kind'] as const,
    registers: [this.registry],
  })
  readonly walletStateTransitions = new Counter({
    name: 'wallet_state_transitions_total',
    help: 'Wallet funds-state crossings notified, by new state',
    labelNames: ['to'] as const,
    registers: [this.registry],
  })
  readonly reservationRecoveries = new Counter({
    name: 'billing_reservation_recoveries_total',
    help: 'Stale reservations recovered by the maintenance pass, by outcome',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  })
  readonly ledgerDrift = new Gauge({
    name: 'billing_ledger_drift_wallets',
    help: 'Wallets whose cached balance or holds differ from the ledger at the last daily check',
    registers: [this.registry],
  })

  // Analytics (Phase 11 Step 2, docs/ANALYTICS.md). No tenant labels.
  readonly analyticsEvents = new Counter({
    name: 'analytics_events_total',
    help: 'Domain events consumed by analytics, by type and result (recorded | duplicate | ignored)',
    labelNames: ['type', 'result'] as const,
    registers: [this.registry],
  })
  readonly analyticsProjectionFailures = new Counter({
    name: 'analytics_projection_failures_total',
    help: 'Analytics event projections that threw (the job is retried)',
    registers: [this.registry],
  })
  readonly analyticsRollupFailures = new Counter({
    name: 'analytics_rollup_failures_total',
    help: 'Workspace rollup runs that failed, by job (rollup | heal | retention)',
    labelNames: ['job'] as const,
    registers: [this.registry],
  })
  readonly analyticsRollupDuration = new Histogram({
    name: 'analytics_rollup_duration_seconds',
    help: 'Time to bring one workspace up to date',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 15, 60],
    registers: [this.registry],
  })
  readonly analyticsLag = new Gauge({
    name: 'analytics_projection_lag_seconds',
    help: 'Age of the oldest pending recompute mark seen by the last rollup pass',
    registers: [this.registry],
  })
  readonly analyticsCorrections = new Counter({
    name: 'analytics_reconciliation_corrections_total',
    help: 'Rollup rows the nightly heal found different from source data and corrected',
    registers: [this.registry],
  })

  // Outbound webhooks (Phase 11 Step 3, docs/WEBHOOKS.md). No tenant or endpoint labels.
  readonly webhookDeliveries = new Counter({
    name: 'webhook_deliveries_total',
    help: 'Outbound webhook delivery attempts, by outcome',
    labelNames: ['result'] as const,
    registers: [this.registry],
  })
  readonly apiKeyRequests = new Counter({
    name: 'api_key_requests_total',
    help: 'Requests authenticated by an API key, by outcome',
    labelNames: ['result'] as const,
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
