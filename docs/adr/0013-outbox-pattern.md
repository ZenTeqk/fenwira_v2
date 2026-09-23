# ADR-0013: Transactional outbox

**Status:** Accepted

## Context

Enqueuing a job directly after a DB write has two failure modes. The DB commits but the enqueue fails, and the job is lost. Or the enqueue happens but the DB rolls back, and a phantom job runs. For message sends, both are unacceptable.

## Decision

State changes that need async work insert an `outbox_events` row **in the same transaction**. A relay loop in the worker claims pending rows with `system.claim_outbox_events` (`FOR UPDATE SKIP LOCKED`), enqueues them with deterministic job IDs, and marks them DISPATCHED. It is triggered by `LISTEN outbox_new` and also polls every 250 ms. Failures back off using `available_at`. DISPATCHED rows are purged after 7 days.

The only direct enqueues allowed are the webhook ingest (persist `webhook_events`, then enqueue, with a 500-and-Meta-retries fallback) and scheduler-driven scans. Both are idempotent by ID.

## Consequences

- No lost or phantom jobs. Redis loss is recoverable.
- The relay adds a small latency (tens of ms).
- The relay is a single logical consumer. Several relay instances are safe thanks to `SKIP LOCKED`.

## Alternatives rejected

- **Enqueue after commit:** a crash window loses jobs.
- **Change data capture (Debezium):** heavy infrastructure for our needs.
