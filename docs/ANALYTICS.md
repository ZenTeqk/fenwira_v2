# Analytics

Phase 11 Step 2. Operational analytics for a workspace: messaging, campaigns, inbox, automations and usage. This document is the contract for how the figures are produced and what each metric means.

## Principles

1. **Operational tables stay authoritative.** Messages, campaign recipients, conversations, automation executions, consent and subscription state live in their own tables. Money lives in `usage_events` and the wallet ledger (`BILLING.md`). Analytics tables are **derived projections**. Nothing reads analytics to make an operational or financial decision, and wallet balances are never computed from analytics.
2. **Rebuildable.** Every rollup is recomputed from the source tables. The one exception is customer-opened conversation episodes, which come from the analytics event log (see Inbox).
3. **PostgreSQL only.** Daily rollups in Postgres; no warehouse, ClickHouse or search engine. Finer granularity (hourly) can be added as another rollup table if a product need appears.
4. **Analytics never blocks messaging.** Projection runs on its own queues. A failure is recorded and retried, and it never affects ingestion, sending or billing.

## Architecture

```text
domain tables ──(same transaction)──► outbox_events ──relay──► analytics.events queue
                                                                  │  AnalyticsEventsProcessor
                                                                  ▼
                                    analytics_events (append-only, unique per source event)
                                    analytics_dirty  (day or campaign to recompute)
                                                                  │  analytics.rollup queue
                                                                  ▼  AnalyticsRollupProcessor (every minute)
source tables ──(recompute, bounded by day)──► analytics_daily_rollups, analytics_conversation_episodes
                                                                  │
                                                                  ▼
                                                 GET /analytics/* (read-only, RLS)
```

| Table | Kind | Purpose |
| --- | --- | --- |
| `analytics_events` | tenant, append-only | Every consumed domain event, once (`unique (tenant_id, source_event_id)`) |
| `analytics_dirty` | tenant | Durable work queue: a day (`scope='day'`, key `YYYY-MM-DD`) or a campaign (`scope='campaign'`, key id) to recompute |
| `analytics_daily_rollups` | tenant | `(tenant_id, day, metric, dims_key) → value`. `dims_key` is `""` for the total or `dimension:value` |
| `analytics_conversation_episodes` | tenant | One per customer-opened conversation, with the first human reply and the resolution |
| `analytics_tenant_state` | tenant | Freshness and health: last event, last rollup, last error, timezone and retention the rollups were built with |

All five have row-level security with the standard tenant policy, and tenant-matrix tests prove isolation.

## Event pipeline

`analytics.events` subscribes to existing domain events. No competing event was created.

| Event | Marks for recompute |
| --- | --- |
| `message.outbound.requested`, `message.inbound.received`, `message.status.changed` | The message's own day (its `created_at` in the workspace timezone) and, for campaign messages, the campaign |
| `conversation.opened` (now carries `messageId`) | The day of the customer's message. The event is also the start of an inbox episode. |
| `conversation.assigned` | The day it happened |
| `campaign.launched`, `campaign.resumed`, `campaign.completed` | The campaign |
| `automation.execution.finished` (new, emitted by `finishExecution` in the terminal-state transaction) | The execution's start day |

The processor appends the event to `analytics_events` (`ON CONFLICT (tenant_id, source_event_id) DO NOTHING`). It adds its marks only if the row was new, in the same transaction. It never increments anything.

## Deduplication and correctness under failures

Projection state is durable in Postgres; Redis is only the delivery mechanism.

| Situation | Why it can't double count |
| --- | --- |
| Duplicate delivery or worker retry | The second insert of the same source event id is a no-op (`duplicate`, counted in `analytics_events_total{result="duplicate"}`) |
| Worker crash after processing, before the job is acknowledged | Redelivery hits the unique key: `duplicate` |
| Multiple workers | The unique key decides for events. Rollups take a per-workspace advisory lock and **replace** rows. |
| Rollup crash mid-way | Each day or campaign is its own transaction. A mark is deleted only in the transaction that recomputed it, and only if it wasn't re-marked since (`marked_at <= snapshot`). |
| Late or out-of-order status events | Message metrics are cohorted by the message's day and computed from the message's current status. A late `read` re-marks that day and the recompute moves the message from delivered to read. |
| Other consumers of the same event not finished yet (campaign recipient status, billing settlement) | Marks wait `ANALYTICS_SETTLE_SECONDS` (default 20) before processing. Today and yesterday are also recomputed on every pass while the workspace is active (events in the last 15 minutes). The nightly heal catches the rest. |
| Silent drift | The nightly heal (02:30 UTC) recomputes the last three completed days and recent campaigns from source data. Rows it changes that nothing had marked count as `analytics_reconciliation_corrections_total`. |

## Rollups

- **Daily, workspace-local.** A day is the calendar date in the workspace's IANA timezone (`tenants.timezone`). Postgres computes the bounds as `day::timestamp AT TIME ZONE tz`, so DST days are 23 or 25 hours and still correct. Timestamps are stored in UTC.
- **The browser's timezone never changes figures.** Presets send `days=N`, which the server resolves in the workspace timezone. Custom ranges are workspace-local dates. Every response states `meta.timezone`.
- **Timezone change:** the next pass deletes the workspace's rollups, re-days its episodes and rebuilds every retained day from source data.
- **Cohorts:** messages count on the day they were accepted or received, executions on the day they started, usage on the day it was priced, campaigns on the day they started. A late status updates its cohort day, not today.
- **Bounded work:** a pass handles at most 120 days or campaigns per workspace (the rest next minute). Each day's recompute is a handful of `GROUP BY` queries over one day of rows, served by `(tenant_id, created_at)`-style indexes.
- **First build (backfill):** the first pass for a workspace marks every day from its earliest activity (within retention, at most 400 days) and every launched campaign.

## Retention (P11-D15)

- Retention is the `analytics_retention` entitlement, in days, resolved through `EntitlementsService`. No plan names appear anywhere. The launch values (30, 90 and 365 days) are configured plan data seeded by Step 4. With subscription enforcement OFF the source remains unlimited; isolated enforcement-ON tests exercise the configured windows and downgrade grace.
- The nightly job (03:45 UTC) deletes, per workspace, analytics rows older than the retained window: rollups, episodes, stale marks, and `analytics_events`. The events go through `system.purge_analytics_events`, because the log is append-only for the runtime role.
- It never touches messages, conversations, campaigns, executions, `usage_events`, the ledger or audit logs. Those have their own retention (`DATA_RETENTION.md`).
- **Retention lowered:** older history disappears at the next nightly run, and the API clamps ranges to the retained window at once (`meta.retention.clamped`).
- **Retention raised:** the newly covered days are rebuilt from source data. Customer-opened episodes older than the event log can't be restored.

## Metric definitions

Denominators are part of the definition. A rate with a zero denominator is `null` and shown as "—" with an explanation, never 0 %.

### Messaging (`msg.*`)

Outbound messages are counted on the day they were accepted, by their current status. The status classes are nested, so each count is a subset of the one above.

| Metric | Definition |
| --- | --- |
| Sent | Outbound messages whose status is SENT, DELIVERED or READ (accepted by Meta) |
| Delivered | DELIVERED or READ |
| Read | READ |
| Failed | FAILED (with the error code as a breakdown) |
| Pending | CREATED, QUEUED or SENDING (not yet final; excluded from rates) |
| Received | Inbound messages from customers |
| **Delivery rate** | Delivered ÷ Sent |
| **Read rate** | Read ÷ Delivered |
| **Failure rate** | Failed ÷ (Sent + Failed) |

Breakdowns: template category (MARKETING, UTILITY, AUTHENTICATION; free-form messages are SERVICE), source (INBOX, CAMPAIGN, AUTOMATION, API), phone number, and failure error code. Meta's pricing category can differ from the template category; Usage uses the priced category.

### Campaigns (`cmp.*`)

Computed from `campaign_recipients`, the authoritative recipient state. A campaign counts in the period it started (`started_at`, else `launched_at`). Drafts and deleted campaigns are excluded.

| Metric | Definition |
| --- | --- |
| Recipients | Every recipient row (the audience snapshot) |
| Excluded | SKIPPED recipients (with the skip reason as a breakdown) |
| Sent, delivered, read, failed | Recipient status classes as for messages |
| In progress | PENDING, QUEUED or SENDING |
| Rates | As for messaging, over the campaign's recipients |

### Inbox (`conv.*` and episodes)

Only what the recorded events and the message history can support.

| Metric | Definition |
| --- | --- |
| Conversations opened | `conversation.opened` events: a customer message on a new conversation or on a RESOLVED one. Counted on the day of the customer's message. |
| New conversations | Conversation rows created that day (any direction, including business-initiated) |
| Resolved | Agent resolutions: `status_changed → RESOLVED` system events that day, attributed to the acting teammate. Auto-resolution of blocked contacts is excluded. |
| Assigned | `assigned` system events, attributed to the assignee |
| **First reply time** (per episode) | **Start:** the customer message that opened the episode. **End:** the first outbound message with source INBOX (a teammate reply) in that conversation at or after the start and before the next episode. Automation, campaign and API messages don't count. Calendar time, with no business hours. Each reopen is a new episode with its own measurement. An episode with no teammate reply yet is "awaiting a first reply" and is excluded from the median. |
| **Resolution time** (per episode) | From the same start to the first agent resolution before the next episode |
| Median first reply, median resolution | The median over episodes opened in the range (`percentile_cont(0.5)`) |
| Open now, unassigned now | Live counts of OPEN conversations (all, and with no assignee) |

Episodes are recorded from the day analytics started for a workspace, not before (`episodesSince`). Episodes still waiting for a reply or resolution are re-evaluated for 30 days.

### Automations (`auto.*`)

Counted on the execution's start day, from `automation_executions` (execution history is never modified).

| Metric | Definition |
| --- | --- |
| Runs | Executions started |
| Completed, failed, cancelled, stopped by takeover | Terminal status |
| Running or waiting | RUNNING or WAITING (not finished) |
| **Success rate** | Completed ÷ finished (all terminal statuses) |
| **Failure rate** | Failed ÷ finished |
| Average duration | Mean of `finished_at − started_at` over finished runs |
| Step failures | FAILED steps started that day, by node type |

### Usage (`usage.*`)

| Metric | Definition |
| --- | --- |
| Billable messages | Σ `usage_events.quantity` (messages Meta priced as billable), by priced category |
| Message charges | Σ `usage_events.amount_minor` in the wallet currency. It equals the usage DEBITs in the ledger; the reconciliation tests assert this. |
| Promotional credits added | Σ positive PROMOTIONAL ledger rows (P11-D7) |
| Provider cost | Kept in the rollups for operator reporting. **Never returned to tenant-facing APIs** — this is now a standing rule (P11-D23), not an interim placeholder: it is internal Fenwira commercial information, visible only through explicitly authorized Platform Operations financial reads. |

The Usage view and the Overview's charge need `billing.read`.

## API

`GET /analytics/{overview|messaging|campaigns|inbox|automations|usage}`. The first five need `analytics.read`; `usage` needs `billing.read`.

| Parameter | Meaning |
| --- | --- |
| `from`, `to` | Workspace-local days (`YYYY-MM-DD`), inclusive. `to` defaults to today and is clamped to today. |
| `days` | Instead of `from`: the last N days ending `to` (1–366). Default 30. |
| `compare` | `false` disables the previous-period comparison (default on) |

Every response has `meta`:

| Field | Meaning |
| --- | --- |
| `range` | `{from, to, days}` |
| `previous` | The previous equivalent period, or null (not requested, or outside retained history) |
| `timezone`, `today` | The workspace timezone and today in it |
| `partial` | The range includes today, which is still in progress |
| `retention` | `{days, earliestDay, clamped}` |
| `freshness.status` | `NOT_STARTED`: no analytics processed yet for this workspace. `PROCESSING`: recent activity or a rebuild is pending. `DEGRADED`: the last rollup failed; figures may be stale. `READY` otherwise. |
| `freshness.lastProcessedAt`, `freshness.pending` | When the last rollup ran, and how many days or campaigns wait for it |

The UI never presents "not processed" as zero: `NOT_STARTED` shows "Analytics are being prepared", and `PROCESSING` and `DEGRADED` show notices above the figures.

`GET /contacts/:id/campaigns` (`campaigns.read`): the contact's `campaign_recipients` rows with campaign name and status, recipient status, skip reason, error code and timestamps. Cursor-paged, newest first. It keeps no copy of the relation.

## Observability

| Metric | Meaning |
| --- | --- |
| `analytics_events_total{type,result}` | Consumed events: `recorded`, `duplicate`, `ignored` |
| `analytics_projection_failures_total` | Event projections that threw (retried by BullMQ) |
| `analytics_rollup_failures_total{job}` | Failed workspace runs of `rollup`, `heal` or `retention`. Also recorded per workspace in `analytics_tenant_state`. |
| `analytics_rollup_duration_seconds` | Time to bring one workspace up to date |
| `analytics_projection_lag_seconds` | Age of the oldest pending mark seen by the last pass |
| `analytics_reconciliation_corrections_total` | Drift the nightly heal found and corrected |
| `queue_depth{queue="analytics.events"}` | Backlog of the event queue (existing gauge) |

## Performance (local, Docker Desktop)

`PERF=1 test/analytics-perf.int.test.ts` seeds 300,000 messages over 90 days for one workspace.

| Step | Time |
| --- | --- |
| Backfill of 90 days | 13.4 s (149 ms per day) |
| One pass recomputing a busy day (~3,300 messages) | 165 ms |
| `GET /analytics/*` for 30, 90 and 365 days | 67–107 ms |

The day scan is an index-only scan on `messages (tenant_id, created_at)`.

## Known limitations

- Customer-opened episodes (first reply and resolution times) exist only from the day analytics started for a workspace, and can't be rebuilt once their events pass retention.
- Figures lag activity by up to about two minutes (settle delay plus the per-minute pass). Views show `PROCESSING` meanwhile.
- A campaign's figures belong to its start day; a campaign that runs across midnight isn't split by day.
- Subscription enforcement remains rollout-controlled and OFF by default; configured retention applies when it is enabled.
