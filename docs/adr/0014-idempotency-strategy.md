# ADR-0014: Idempotency strategy

**Status:** Accepted

## Context

At-least-once delivery shows up everywhere: Meta webhooks retry, BullMQ retries, the outbox relay may re-enqueue, and clients retry HTTP requests. Duplicated WhatsApp messages or ledger entries are customer-visible failures.

## Decision

Idempotency is enforced **in Postgres with unique constraints**, never by "check then insert" alone:

| Layer | Mechanism |
| --- | --- |
| HTTP | The `Idempotency-Key` header on send/launch/publish/submit endpoints, stored in `idempotency_keys` with a request hash. Replays return the stored response. |
| Messages | `messages (tenant_id, idempotency_key)` unique. Callers derive keys deterministically (`campaign:{c}:contact:{k}`, `auto:{exec}:{seq}`). |
| Inbound | `webhook_events (tenant_id, dedupe_key)` and `messages (tenant_id, provider_message_id)` unique |
| Jobs | Deterministic BullMQ `jobId`s. Processors re-check state before acting (for example the outbound processor only acts on CREATED/QUEUED). |
| Ledger | `wallet_transactions (tenant_id, idempotency_key)` and `usage_events (tenant_id, type, message_id)` unique |
| Statuses | Monotonic rank ordering. Late or duplicate statuses can't regress state. |

## Consequences

- Processors can be retried blindly.
- **Residual risk:** Meta offers no idempotency key. A crash between Meta accepting a send and our SENT write can cause one duplicate on retry. We write SENT immediately after the response and document the risk.

## Alternatives rejected

- **Redis-only dedupe:** lost on Redis failure, and not transactional with the state change.
