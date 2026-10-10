# ADR-0020: In-house worker runtime instead of @nestjs/bullmq

**Status:** Accepted (Phase 1). Supersedes the "@nestjs/bullmq processors" detail of ADR-0007. BullMQ itself remains the queue.

## Context

Every job must run inside the async request context, so that logs carry `correlationId`, `tenantId`, `jobId` and `queue` (OBSERVABILITY.md). The worker health check must also report whether each processor is running. And the outbox relay enqueues into arbitrary subscriber queues by name. `@nestjs/bullmq`'s decorator model makes the context wrapping and the health introspection awkward.

## Decision

- Processors implement `QueueProcessor` (`queue`, `concurrency`, `process(job)`) as ordinary Nest providers.
- `WorkerRuntimeModule.forRoot({ imports, processors })` (in `apps/api/src/core/queue`) creates one BullMQ `Worker` per processor on a shared blocking connection. It wraps each job in `requestContext.run(...)`, logs failures, and exposes `notRunning()` for health.
- Producers come from `QueueRegistry`: lazily-created `Queue`s on one fail-fast connection (`enableOfflineQueue: false`), so HTTP requests never hang when Redis is down.
- Job IDs come from `jobId()` / `eventJobId()` in `@fenwira/queue`. Parts are joined with `__`, because BullMQ rejects `:` in custom IDs.

## Consequences

- About 100 lines of owned code in place of a dependency, with full control over context, retries and shutdown.
- New processors are registered by listing them in the worker's `WorkerRuntimeModule.forRoot`.
