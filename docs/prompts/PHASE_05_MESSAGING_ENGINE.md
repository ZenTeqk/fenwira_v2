# Phase 5 — Webhook & Messaging Engine

**Goal:** send and receive WhatsApp messages reliably, with duplicate-webhook protection and full status tracking. This is the only path to Meta for the rest of the product.

**Read:** `AGENTS.md`, `docs/MESSAGING_ENGINE.md`, `docs/META_INTEGRATION.md`, `docs/MULTI_TENANCY.md` (webhook tenant resolution), ADRs for outbox and idempotency.

## Build

### Inbound

`GET /webhooks/whatsapp` handles verification: it echoes `hub.challenge` if the verify token matches.

`POST /webhooks/whatsapp` has no auth and no tenant header. It runs these steps in order:

1. Capture the raw body and verify `X-Hub-Signature-256` (HMAC-SHA256 with the platform app secret, constant-time compare) **on raw bytes**. Return 401 on mismatch.
2. Normalize the payload into typed events (message, status, template status, quality update, account update).
3. Resolve the tenant by `phone_number_id` through a narrow `SECURITY DEFINER` function that returns only `tenant_id`. An unknown number is logged and ignored.
4. Persist a `WebhookEvent` with a unique dedupe key (Meta message ID + event type, or a status ID + status). A duplicate is a no-op.
5. Enqueue to `whatsapp.inbound` or `whatsapp.status`.
6. Return 200 quickly (p95 under 100ms). There is no business logic in the request.

### Workers

- **`whatsapp.inbound`:** upsert the Contact by E.164, then upsert the open Conversation, insert the `Message` (unique `(tenant_id, provider_message_id)`), update `last_customer_message_at` and `service_window_expires_at`, download media to MinIO in a child job, and emit domain events through the outbox.
- **`whatsapp.status`:** apply status transitions under the ordering guard (`SENT < DELIVERED < READ`, never regress, and FAILED is terminal with an error code). A status that arrives before its send is recorded is retried with backoff.
- **`whatsapp.outbound`:** load the message, check it is still sendable, set it to SENDING, call Meta, and set it to SENT with the provider ID. Retryable errors back off exponentially (5 attempts with jitter). Permanent errors mark it FAILED with the code. Jobs that exhaust their retries go to `whatsapp.outbound.dlq`, and an admin can replay them.

### MessagingService (apps/api)

- `send({tenantId, conversationId | contactId, content, source: 'inbox' | 'campaign' | 'automation' | 'system', idempotencyKey, actorId})` validates the connected number, the service window (freeform needs an open window, otherwise a template is required), and a placeholder consent hook (implemented in Phase 6). It inserts `Message` (CREATED) plus an `OutboxEvent` in one transaction and returns the message.
- **Outbox relay:** a worker polls `outbox_event` with `FOR UPDATE SKIP LOCKED`, enqueues the job with `jobId = idempotency key`, and marks the row dispatched. The message moves to QUEUED.
- The same idempotency key returns the same message and never sends twice.
- Delete the temporary direct-send path from Phase 4 **Test Connection**. Test sends go through `MessagingService`.

### Content types (v1)

Text, image, document, audio, video (from MinIO via a presigned URL or a Meta media upload), template (full template management comes in Phase 8), and mark-as-read.

### Realtime

A WebSocket gateway with a Redis adapter. Events are `message.created`, `message.status` and `conversation.updated`, emitted to `tenant:{id}` and `conversation:{id}` rooms.

### Observability

A correlation ID flows from the webhook or HTTP request through the outbox, the job and the Meta call. Metrics: webhook count/latency, queue depth per queue, send success/failure by error code, and DLQ size.

## Acceptance criteria

- [ ] Replaying the same webhook payload 10 times creates exactly one message.
- [ ] A bad signature returns 401 and persists nothing.
- [ ] An outbound message goes CREATED → QUEUED → SENDING → SENT → DELIVERED → READ on a real test number, and the UI updates live.
- [ ] Out-of-order statuses (READ before DELIVERED) end in READ.
- [ ] Killing the worker mid-send and restarting it gives no duplicate send and no lost message.
- [ ] Killing Redis, sending, then restoring Redis: the outbox delivers once Redis is back.
- [ ] A simulated Meta 5xx is retried with backoff. A simulated permanent error goes FAILED with no retries. Exhausted retries land in the DLQ.
- [ ] A freeform send outside the 24h window is rejected server-side with a typed error.
- [ ] A static check (lint rule or dependency-cruiser) proves only the outbound worker imports the Meta send functions.
