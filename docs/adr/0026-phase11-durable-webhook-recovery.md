# ADR-0026: Recover webhook execution from durable delivery rows

Status: accepted for Phase 11 remediation, 2026-10-20. No new queue, dependency or production infrastructure.

## Decision

Webhook PENDING rows and their next_attempt_at are durable execution intent. Existing webhooks.maintenance scans due identifiers every 30 seconds and recreates missing webhooks.deliver jobs. Job identity is delivery + persisted attempt + due timestamp, so concurrent recovery runs deduplicate. Send acquires a transaction-scoped PostgreSQL advisory lock before reading state and respects due time. A worker crash rolls back and releases that lock; the row remains recoverable. A bounded HTTP call has a larger bounded database transaction timeout. Retry jobs and operational alerts are emitted only after commit. HTTP transport remains at-least-once with stable delivery/event IDs; a crash after receiver acceptance can resend.

## Tenant/security review (X19 extension)

`system.webhook_deliveries_due(now, limit, after)` returns only tenant_id and delivery_id, with fixed search_path, clamped batch, keyset cursor, explicit fenwira_system ownership and no PUBLIC execution. The function has column-only SELECT on id/tenant/status/next_attempt_at, exposes no payload or secret and performs no mutation. Reads, signing, endpoint/entitlement checks and updates re-enter withTenant. Existing runtime role cannot bypass forced RLS. No new tenant table or RLS exception. Pending-due partial index is additive. Test foreign IDs, disabled endpoints, future retries and existing signature/SSRF coverage before acceptance.

## Recovery and tradeoffs

The maintenance producer re-registers recurring schedulers after Redis state loss; initial delivery enqueue gaps and failed Redis enqueue after committed retry are repaired by the next scan. Disabled endpoints retain pending data until enabled; lost entitlement closes a claimed pending attempt with SUSPENDED_BY_PLAN. Retry deadline/auto-disable policy is unchanged. Completed/failed Redis execution jobs are removed because Postgres owns history and recovery. Advisory locks prevent concurrent HTTP calls for one delivery; they do not promise exactly-once remote side effects. No real external receivers are used for regression tests.
