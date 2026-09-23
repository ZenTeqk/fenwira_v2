# ADR-0006: Redis for queues, locks, presence and rate limits

**Status:** Accepted

## Context

We need a fast shared store for job queues, short-lived locks (compose), presence, rate limiting, the Socket.IO adapter, and the session deny-set.

## Decision

A single Redis 7 instance with AOF persistence and `maxmemory-policy noeviction` (required by BullMQ). Redis holds **no business truth**. Everything in it is either rebuildable from Postgres (queues, via the outbox and campaign recovery) or ephemeral (locks, presence, rate-limit windows).

## Consequences

- Losing Redis degrades realtime and delays processing, but loses no data (verified in Phase 12).
- `noeviction` means memory must be monitored (alert at 80%).

## Alternatives rejected

- **Postgres-only queues (for example pg-boss):** viable, but BullMQ's rate limiting, delayed jobs and ecosystem fit our messaging throughput needs better. We already need Redis for WebSockets and locks.
