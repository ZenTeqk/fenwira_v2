# ADR-0012: Domain events for cross-module async work

**Status:** Accepted

## Context

Many reactions cross module boundaries. For example, an inbound message triggers consent keyword handling, automations, analytics and auto-assignment. Direct calls would couple every module to messaging.

## Decision

Modules emit **domain events** (catalog in `ARCHITECTURE.md`), written to the outbox in the emitting transaction (ADR-0013). The relay fans each event out to the subscriber queues declared in `packages/queue` (`EVENT_SUBSCRIPTIONS`), one job per subscriber with `jobId = {eventId}:{subscriber}`. Payloads carry IDs, and handlers re-read current state inside `withTenant`.

## Consequences

- Emitters don't know their subscribers. Adding analytics or billing reactions touches no emitting code.
- Processing is eventually consistent (typically sub-second), and the UI is designed for it (optimistic updates, WS patches).
- Event payload schemas are versioned in `packages/contracts/src/events`. Breaking changes need a new event type.

## Alternatives rejected

- **In-process event emitter:** events are lost on crash, and there's no retry.
- **Direct service calls for async reactions:** coupling and cascading failures.
