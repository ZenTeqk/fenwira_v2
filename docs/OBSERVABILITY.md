# Observability

## Scope

Logging, correlation, metrics, tracing, health checks and alerting. Phases 1–11 build the logging, correlation, health and metrics endpoints. Phase 12 adds the collector, dashboards and alert routing.

## Decisions

### Logs

- **pino** JSON to stdout in every Node process. No log files; Docker collects stdout.
- Logs are structured, and retention is configurable (decision O2). Production log storage and its retention period are decided during production infrastructure design.
- Levels: `fatal`, `error`, `warn`, `info` (default in production), `debug` (default in dev) and `trace`.
- Base fields on every line:

| Field | Source |
| --- | --- |
| `time`, `level`, `msg` | pino |
| `service` | `web` \| `api` \| `worker` |
| `env`, `version` (git SHA) | env |
| `correlationId` | AsyncLocalStorage (HTTP), job data (worker) |
| `tenantId`, `userId` | TenantContext when bound |
| `module` | Nest logger context |
| `jobId`, `queue`, `attempt` | Worker only |
| `err` | pino error serializer (message, stack, code) |

- HTTP access log: one line per request with `method`, `route` (the template, not the raw path), `status`, `durationMs`, `contentLength`. Query strings are never logged.
- **Redaction** (central pino config): `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `*.password`, `*.token`, `*.accessToken`, `*.secret`, `*.code` (OAuth), `*.pin`, `*.phone*`, `*.email`, `*.text`, `*.body`, `*.content`, `*.variables`. See the PII rules in `SECURITY.md`. This covers the `Authorization: Bearer fw_...` header on every API-key request and `*.secret` on webhook-endpoint create/rotate responses — an API key's secret and a webhook's signing secret are never written to a log line, by the same redaction rule, not a special case for Phase 11 Step 3.

### Correlation IDs

- HTTP: accept `X-Correlation-Id` (if it is a valid UUID or a ≤ 64-character token), else generate a UUIDv7. Echoed on the response.
- Webhooks: `whk:{webhookEventId}`.
- Propagation: `outbox_events.correlation_id` → job data `correlationId` → all logs, and to Meta calls as a log field. Scheduled jobs use `sched:{queue}:{timestamp}`.
- The web app displays the correlation ID in `ErrorState` ("Reference: 0192…") so support can find the logs.

### Metrics (OpenTelemetry SDK, exported in Prometheus format at `/metrics` on an internal port)

| Metric | Type | Labels |
| --- | --- | --- |
| `http_server_duration_ms` | histogram | route, method, status_class |
| `webhook_received_total` | counter | kind, result (`accepted` \| `duplicate` \| `bad_signature` \| `unknown_number`) |
| `webhook_ingest_duration_ms` | histogram | |
| `queue_depth` | gauge | queue, state (`waiting` \| `delayed` \| `active` \| `failed`) |
| `queue_job_duration_ms` | histogram | queue, result |
| `queue_job_failures_total` | counter | queue, error_class |
| `outbox_pending` | gauge | |
| `outbox_lag_seconds` | gauge | Age of the oldest PENDING row |
| `meta_api_requests_total` | counter | endpoint, result, error_code |
| `meta_api_duration_ms` | histogram | endpoint |
| `messages_status_total` | counter | direction, status, source |
| `dlq_size` | gauge | queue |
| `automation_trigger_runs_total` | counter | result (`planned` \| `no-match` \| `no-flows` \| `duplicate` \| `stopped` \| `webhook` …) |
| `automation_executions_total` | counter | status (`STARTED`, then the terminal status) |
| `automation_steps_total` | counter | node_type, status |
| `automation_step_duration_seconds` | histogram | node_type |
| `automation_job_retries_total` | counter | |
| `ops_alerts_total` | counter | kind (`billing.stale_reservations` \| `billing.ledger_drift` \| `billing.campaign_paused_insufficient_funds`) |
| `wallet_state_transitions_total` | counter | to (`NORMAL` \| `LOW_BALANCE` \| `INSUFFICIENT_FUNDS`), counted when notified |
| `subscription_transitions_total` | counter | to (`T-3` \| `T-1` \| `EXPIRED` \| `CANCELLED`): trial notices and lifecycle transitions that notified, Phase 11 Step 4 |
| `entitlement_denials_total` | counter | key (the entitlement that refused: `max_contacts`, `api_enabled`, `subscription_active` …) |
| `billing_reservation_recoveries_total` | counter | outcome (`settled` \| `released`) |
| `billing_ledger_drift_wallets` | gauge | Wallets with drift at the last daily check |
| `analytics_events_total` | counter | type, result (`recorded` \| `duplicate` \| `ignored`) |
| `analytics_projection_failures_total` | counter | |
| `analytics_rollup_failures_total` | counter | job (`rollup` \| `heal` \| `retention`) |
| `analytics_rollup_duration_seconds` | histogram | |
| `analytics_projection_lag_seconds` | gauge | Age of the oldest pending recompute mark |
| `analytics_reconciliation_corrections_total` | counter | Drift corrected by the nightly heal |
| `ws_connections` | gauge | |
| `db_pool_in_use` / `db_pool_waiting` | gauge | service |
| `redis_memory_used_bytes` | gauge | (from INFO, polled) |
| `api_key_requests_total` | counter | result (`ok` \| `unauthenticated` \| `not_found` \| `entitlement_required` \| `rate_limited` \| `error`) — every `ApiKeyGuard` outcome, including authentication failures and rate-limit events (Phase 11 Step 3, `docs/API_KEYS.md`) |
| `webhook_deliveries_total` | counter | result (`succeeded` \| `retrying` \| `failed`) — each `WebhookEventsProcessor.send` outcome; sustained `retrying` growth without matching `succeeded` is the signal to check a specific endpoint's Deliveries tab (Phase 11 Step 3, `docs/WEBHOOKS.md`) |

Queue backlog and failure signals for `webhooks.deliver` and `webhooks.maintenance` come from the generic `queue_depth`, `queue_job_duration_ms` and `queue_job_failures_total` rows above (labeled by `queue`) — no separate metric. Per-endpoint delivery success/failure/retry counts and disabled-endpoint state are not metrics (too high-cardinality); they're read from `webhook_endpoints.failure_count`/`status` and the `webhook_deliveries` rows themselves, surfaced in the endpoint detail page's Overview and Deliveries tabs, and in the OWNER/ADMIN notification sent on auto-disable.

Labels **never** include tenantId, userId or other high-cardinality IDs. Per-tenant views come from analytics, not metrics.

### Tracing (Phase 12)

OpenTelemetry auto-instrumentation for http, NestJS, Prisma (`@prisma/instrumentation`), ioredis and BullMQ. Trace context is propagated in job data (`traceparent`), so one trace spans HTTP → outbox → queue → worker → Meta. Export uses OTLP to the `fenwira-otel` collector (compose profile `observability`).

### Health checks

| Endpoint | Service | Checks | Used by |
| --- | --- | --- | --- |
| `/health/live` | api, worker | Event loop responsive | Docker `healthcheck`, restart policy |
| `/health/ready` | api | Postgres `SELECT 1` (1 s timeout), Redis `PING`, BullMQ client connected | Readiness, the `depends_on` of web |
| `/health/ready` | worker | Postgres, Redis, processors registered, outbox relay heartbeat < 10 s old | Docker `healthcheck` |
| `/health` | api, worker | Summary JSON `{status, version, checks:{…}}` | Humans |
| `/api/health` | web | Process up + API `/health/live` reachable | Docker `healthcheck` |

The worker serves health on an internal port (`WORKER_HEALTH_PORT`, default 4100), not published to the host.

### Alerts (Phase 12; Grafana alerting or Alertmanager)

Alerts initially go to the configured operations email address (decision O1). Routing is configuration, so Slack or paging destinations can be added without code changes.

Application alerts (Phase 11): jobs raise them through `OpsAlerts` (`apps/api/src/modules/platform/email/ops-alerts.ts`), which logs at warn, increments `ops_alerts_total{kind}` and emails `OPS_ALERT_EMAIL` (unset: log only). They carry IDs and counts, never customer content. Current kinds: `billing.stale_reservations` (the recovery pass changed something), `billing.ledger_drift` (the daily ledger check found drift) and `billing.campaign_paused_insufficient_funds` (top-ups are made by operators, P11-D13).

| Alert | Condition (5-minute window unless noted) | Severity |
| --- | --- | --- |
| Webhook failures | `bad_signature` + 5xx on the webhook route > 5% | critical |
| Webhook processing failures | `webhook_events` FAILED > 0 in 15 minutes | warning |
| Queue backlog | `queue_depth{state="waiting"}` for `whatsapp.outbound` > 5,000 for 10 minutes, or for inbound > 500 | critical |
| Outbox lag | `outbox_lag_seconds` > 30 | critical |
| High failed-message % | Outbound FAILED / (SENT + FAILED) > 10% over 15 minutes | warning |
| DLQ growth | `dlq_size` > 0 and increasing | warning |
| Worker crash | Worker not ready for 2 minutes, or restarts > 3 in 15 minutes | critical |
| DB connection exhaustion | `db_pool_waiting` > 0 for 5 minutes, or PG connections > 80% of max | critical |
| Redis memory | > 80% of `maxmemory` | warning |
| API 5xx | 5xx rate > 1% | critical |
| High p95 latency | API p95 > 800 ms for 10 minutes (excluding exports and uploads) | warning |
| Meta credential invalid | Any credential moves to INVALID | warning (tenant is also notified) |
| Wallet ledger drift | Daily reconciliation mismatch | critical |

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.

## Platform Operations (Phase 11 Step 5)

`platform_events_total{action,outcome}` records bounded authentication/access/validation and failed operation outcomes, including MFA/replay, rate limits, CSRF and override activity. `commercial_operations_total{operation,result}` counts committed operations and receipt replays only after commit; preview changes are rolled back and excluded. Metrics never label operator/workspace/key/reference IDs. Structured logs contain action/outcome, operator/workspace IDs and correlation only, never notes, request bodies, passwords, codes or provider/customer message content. Platform 5xx logs exclude raw exceptions to avoid financial payload leakage.

Existing wallet maintenance still raises ledger/hold drift through `OpsAlerts` and configured OPS_ALERT_EMAIL. Platform authentication/failure counters support the following alert rules (monitoring deployment remains Phase 12): >=10 failed logins/MFA in 5m warning; any commercial INTERNAL/FAILED in 5m critical; >=10 IDEMPOTENCY_KEY_REUSED in 5m warning; any failed activation in 5m warning; >20 override commits in 5m review. Replays are tracked separately from changed-payload rejection.

Access to >25 distinct workspace IDs per operator in 5m raises one structured warning, immutable FLAGGED event and existing `ops_alerts_total{kind="platform.unusual_workspace_access"}` per window. Redis counters have bounded TTL, no customer content; investigate authorization/audit before revoking using restricted tooling. Alert on this counter's increase. Authentication rate limiting remains independent.
