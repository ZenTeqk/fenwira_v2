# ADR-0007: BullMQ for background jobs

**Status:** Accepted

## Context

We need durable async processing with retries, backoff, delays (automation Delay nodes, scheduled sends), rate limiting per phone number, priorities (inbox over campaigns) and dedup by job ID.

## Decision

BullMQ on Redis, with `@nestjs/bullmq` processors in `apps/worker`. Queue names, payload types and defaults live in `packages/queue` (catalog in `ARCHITECTURE.md`). Jobs always carry `tenantId` and `correlationId`, and use deterministic `jobId`s.

## Consequences

- Retries, delays, priorities and limiters come built in.
- Jobs are at-least-once, so every processor must be idempotent (ADR-0014).
- Queue names can't contain `:`, so we use dot notation.

## Alternatives rejected

- **RabbitMQ or Kafka:** more infrastructure without a need we can't meet with BullMQ at this scale.
- **Cron plus DB polling for everything:** poor latency and throughput control.
