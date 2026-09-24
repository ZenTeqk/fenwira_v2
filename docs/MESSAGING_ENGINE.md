# Messaging Engine

## Scope

The single path for sending and receiving WhatsApp messages: `MessagingService`, the message state machine, the webhook ingest pipeline, queues, retries, idempotency and status ordering. Every other module (inbox, campaigns, automation, system) sends **only** through this.

## Decisions

### MessagingService API (`apps/api/src/modules/messaging`)

```ts
send(input: {
  tenantId: string                 // from TenantContext
  target: { conversationId: string } | { contactId: string; phoneNumberId?: string }
  content: MessageContent          // TEXT | IMAGE | DOCUMENT | AUDIO | VIDEO | TEMPLATE | INTERACTIVE | REACTION
  source: 'INBOX' | 'CAMPAIGN' | 'AUTOMATION' | 'SYSTEM' | 'API'
  idempotencyKey: string           // required
  actor?: { userId?: string; apiKeyId?: string }
  links?: { campaignId?: string; automationExecutionId?: string; replyToMessageId?: string }
  purpose?: 'MARKETING' | 'UTILITY' | 'SERVICE'   // default derived: template category, else SERVICE
}): Promise<Message>   // status QUEUED-pending (CREATED), returned immediately
```

**Validation order.** The first failure throws a typed error, and nothing is written.

1. **Idempotency.** An existing message with `(tenant_id, idempotency_key)` is returned as-is.
2. **Phone number.** Resolve the conversation's number, or the tenant default. It must be `CONNECTED` → `NO_CONNECTED_NUMBER`.
3. **Contact.** Must be `ACTIVE` and not deleted → `CONTACT_BLOCKED`.
4. **Consent** (Phase 6 hook). For `purpose = MARKETING` there must be a current GRANTED marketing consent → `CONSENT_REQUIRED`.
5. **Service window.** Any non-template content requires `now < conversation.service_window_expires_at` → `CONVERSATION_WINDOW_CLOSED`.
6. **Template** (Phase 8). The version must be APPROVED, and the variables must match → `TEMPLATE_NOT_APPROVED`, `TEMPLATE_VARIABLES_INVALID`.
7. **Takeover** (Phase 7). If `source = AUTOMATION` and the conversation's `automation_state ≠ AUTOMATION_ACTIVE` → `AUTOMATION_BLOCKED_BY_TAKEOVER`.
8. **Compose lock** (Phase 7). If `source = INBOX`, the actor must hold the lock or be the assignee → `COMPOSE_LOCKED`.
9. **Entitlement/balance** (Phase 11). If `source = CAMPAIGN` and the wallet is below the minimum → `INSUFFICIENT_BALANCE`.

**Write, in one `withTenant` transaction:**

- Upsert the conversation if the target is a contact.
- Insert the `messages` row: direction OUTBOUND, status CREATED, source, content, idempotency key and links.
- Insert `outbox_events('message.outbound.requested', {messageId})`.
- If source = INBOX: set `first_response_at` if null, and move `automation_state` to AGENT_TAKEOVER (see `INBOX.md`).
- Update the conversation preview and `last_message_at`.

After commit: emit WS `message.created`. The relay then enqueues `whatsapp.outbound` with `jobId = message.id`, and the relay's `onDispatched` hook updates the status to QUEUED.

### Outbound message state machine

```text
CREATED ──relay enqueued──► QUEUED ──worker picked──► SENDING ──Meta 200──► SENT ──webhook──► DELIVERED ──webhook──► READ
   │                          │                          │                   │                    │
   └──────────────────────────┴──────────────────────────┴──► FAILED ◄───────┴────────────────────┘
                                                     (permanent error, retries exhausted,
                                                      or Meta 'failed' status webhook)
```

| From → To | Trigger | Set |
| --- | --- | --- |
| CREATED → QUEUED | Outbox relay enqueued the job | `queued_at` |
| QUEUED → SENDING | Outbound processor starts an attempt | `sending_at` |
| SENDING → SENT | Meta returns `messages[0].id` | `provider_message_id`, `sent_at` |
| SENDING → QUEUED | Retryable error, attempts remain | `error_code` (last), attempts++ |
| any non-terminal → FAILED | Permanent error, retries exhausted, or a `failed` status webhook | `failed_at`, `error_code`, `error_detail` |
| SENT → DELIVERED → READ | Status webhooks | `delivered_at`, `read_at` |

**Status ordering rule.** Rank the states `CREATED 0 < QUEUED 1 < SENDING 2 < SENT 3 < DELIVERED 4 < READ 5`. A status update applies only if its rank is higher than the current one:

```sql
UPDATE messages SET status = $new, … WHERE id = $id AND status_rank(status) < status_rank($new) AND status <> 'FAILED'
```

- A `failed` webhook applies to any state below DELIVERED. After DELIVERED, a `failed` is recorded in `error_*` but the status stays.
- A READ arriving without a prior DELIVERED also sets `delivered_at` (backfilled to `read_at`).
- A status for an unknown `provider_message_id` means the webhook beat our SENT write. The processor throws `MessageNotYetKnown` and is retried with backoff (1 s, 2 s, 4 s … up to 5 attempts). After that, the event is stored as IGNORED with a reason.

Inbound messages are `RECEIVED`. `SYSTEM` rows (conversation events) are `RECEIVED` and never go to Meta.

### Inbound pipeline

```text
POST /webhooks/whatsapp  (api, raw body captured by a route-specific body parser)
 1. verify X-Hub-Signature-256 = HMAC_SHA256(META_APP_SECRET, rawBody)   → 401 on mismatch (no body logged)
 2. parse → normalize to WebhookEvent[] (packages/whatsapp/normalize)      → 200 + IGNORED log on unknown shape
 3. for each event: tenantId = system.resolve_tenant_by_phone_number_id(metadata.phone_number_id)
                    unknown → log warn {phoneNumberId}, skip
 4. withTenant: INSERT webhook_events … ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING id
                    conflict → duplicate, skip enqueue
 5. enqueue whatsapp.inbound | whatsapp.status with jobId = webhook_event.id
 6. return 200 (target p95 < 100 ms; never await processing)
```

**Dedupe keys**

| Event | `dedupe_key` |
| --- | --- |
| Message | `msg:{wamid}` |
| Status | `st:{wamid}:{status}` (plus `:{errors[0].code}` for failed) |
| Template status | `tpl:{template_id}:{event}:{timestamp}` |
| Quality/account | `{field}:{entity_id}:{timestamp}` |

If step 4 or 5 fails, respond 500 so Meta retries (Meta retries with backoff for up to 7 days). The persisted `webhook_events` row plus `jobId` make those retries safe.

**`whatsapp.inbound` processor**, in one `withTenant` transaction:

1. Upsert the contact by `phone_e164` (source INBOUND). Set `wa_profile_name` and `last_inbound_at`.
2. Upsert the conversation `(contact, phone_number)`. If it was RESOLVED, reopen it (status OPEN) and emit `conversation.opened`.
3. Insert the message (`INBOUND`, `RECEIVED`, `provider_message_id = wamid`, `provider_timestamp`). A unique-constraint conflict means it was already processed; exit successfully.
4. Set `last_customer_message_at = provider_timestamp` and `service_window_expires_at = provider_timestamp + 24h`. Increment unread for every read-state row, and update the preview.
5. For media types, enqueue `whatsapp.media` (downloads using the media ID → MinIO → `files`, then sets `messages.file_id`).
6. Write outbox `message.inbound.received`.
7. Mark the `webhook_events` row PROCESSED.

After commit: emit WS `message.created` and `conversation.updated`.

**`whatsapp.status` processor.** Applies message status (ordering rule), template status (to the templates module service), phone quality/tier/status (to the whatsapp-accounts service), and account updates. Emits `message.status.changed` with the Meta `pricing` object when present (used by billing).

### `whatsapp.outbound` processor

1. Load the message inside `withTenant`. If its status is not CREATED or QUEUED, exit (idempotent re-run).
2. **Re-check the send-time guards**: phone still CONNECTED, service window (for non-template content), takeover (for AUTOMATION), consent (for MARKETING). A guard that now fails means FAILED with the guard's error code, and no Meta call.
3. Acquire a rate-limit token for the phone number (Redis token bucket `rl:wa:{phoneNumberId}`, capacity and refill = `throughput_mps`). If none is available, `moveToDelayed(+ms)` and exit.
4. Set SENDING. Call `packages/whatsapp.sendMessage(credential, phoneNumberId, payload)` with a 15 s timeout.
5. Success means SENT, with the wamid, plus WS `message.status`.
6. Error: classify it with `META_INTEGRATION.md` → error mapping.
   - **Retryable**: status back to QUEUED, then throw so BullMQ retries.
   - **Permanent**: FAILED, no throw.
   - **Credential invalid (190)**: FAILED, mark the credential INVALID, and emit `whatsapp.connection.changed`.

**Retry policy (outbound):** 5 attempts, exponential backoff `2^attempt × 2 s` with ±20% jitter (2 s, 4 s, 8 s, 16 s, 32 s). Rate-limit codes (130429, 80007, 131056) use `Retry-After`-style longer delays (60 s base). When attempts are exhausted, the message is marked FAILED (`RETRIES_EXHAUSTED`) and a copy of the job is added to `whatsapp.outbound.dlq`.

**DLQ replay:** an admin-only endpoint (Phase 12 tooling; Phase 5 exposes a CLI script) requeues a DLQ job, which resets the message to QUEUED under a new attempt budget with the same wamid-less idempotency.

**Retries for other queues:** inbound and status get 8 attempts with exponential backoff from 1 s. After that, the `webhook_events` row is marked FAILED with the error, and a metric and alert fire.

### Idempotency summary

| Layer | Key |
| --- | --- |
| HTTP send | `Idempotency-Key` header → `idempotency_keys` + `messages.idempotency_key` |
| Service callers | Campaign `campaign:{cid}:contact:{contactId}`. Automation `auto:{executionId}:{seq}`. System `sys:{purpose}:{id}`. |
| Outbox → queue | `jobId = message.id` |
| Webhook | `webhook_events (tenant_id, dedupe_key)` + `messages (tenant_id, provider_message_id)` |
| Meta | No Meta-side idempotency exists. We never re-send a message whose status ≥ SENT. |

**Known limitation:** if Meta accepts a send but our process dies before writing SENT, the retry sends a duplicate. We reduce the window by writing SENT immediately after the response, and document the at-most-one-duplicate-per-crash risk. (Meta offers no client-supplied idempotency key.)

### Correlation and logging

`correlationId` is taken from the HTTP request, or `whk:{webhook_event.id}` for webhooks, and carried in `outbox_events.correlation_id`, job data, and every log line. A Meta call logs `{tenantId, messageId, phoneNumberId, attempt, durationMs, metaErrorCode?}` and never the payload.

### Realtime events emitted

`message.created`, `message.status` (`{messageId, conversationId, status, errorCode?}`), `conversation.updated`.

## Implementation notes (Phase 5)

- **Code map.** `apps/api/src/modules/messaging`: `MessagingService` (the only send path), `WebhookIngestService` + `WhatsAppWebhookController` (`/api/v1/webhooks/whatsapp`, raw body kept via Nest `rawBody`), and the processors `InboundProcessor`, `StatusProcessor`, `OutboundProcessor`, `MediaProcessor`. `@fenwira/whatsapp` provides `normalizeWebhook`, `verifyWebhookSignature` and, in the `@fenwira/whatsapp/send` subpath, `MessageSender` + `buildSendPayload`.
- **Static guarantee.** dependency-cruiser rule `meta-send-only-in-outbound` fails `pnpm lint:deps` if anything but `outbound.processor.ts` imports `@fenwira/whatsapp/send` (verified by planting a violation).
- **Outbox → queue.** The relay enqueues `message.outbound.requested` with `jobId = send__{messageId}` and the queue's retry policy (`QUEUE_JOB_OPTIONS` in `@fenwira/queue`), then runs the dispatch hook the outbound processor registers (CREATED → QUEUED).
- **Retries.** Outbound: 5 attempts, custom backoff `2^n × WHATSAPP_OUTBOUND_BACKOFF_MS` ±20 % (default 1 s → 2, 4, 8, 16 s); Meta rate limits (`RETRYABLE_RATE`) wait 60× longer. On the last attempt the message becomes FAILED `RETRIES_EXHAUSTED` and the job data is copied to `whatsapp.outbound.dlq`. Replay: `pnpm --filter @fenwira/worker dlq [--message <id> | --all]` (resets to QUEUED with a new attempt budget).
- **Per-number throughput.** A Redis fixed one-second window `rl:wa:{phoneId}:{second}` allows `throughput_mps` sends; over the limit the job is delayed 250–500 ms without using an attempt.
- **Interrupted sends (crash recovery).** Every send carries `biz_opaque_callback_data = message.id`, which Meta echoes in status webhooks. If the worker dies after Meta accepted a send but before SENT was written, the status processor attaches the wamid by that id. A re-run that finds the message still SENDING waits up to 60 s for that webhook before resending, so a crash no longer produces a duplicate as long as Meta's status arrives within the grace period (verified with `docker kill` mid-send).
- **Status before send.** A status for an unknown wamid (and no callback match) throws `MessageNotYetKnown`; after 5 attempts the event is stored as IGNORED.
- **WABA-level events.** `phone_number_quality_update` and `account_update` queue a `whatsapp.sync` refresh of that WABA's numbers; template events are stored and IGNORED until Phase 8.
- **Media.** Inbound media is copied from Meta to MinIO by `whatsapp.media` (a READY `files` row linked to the message). Outbound media is uploaded to Meta (`POST /{phone}/media`) at send time, so it works without Meta reaching MinIO.
- **Mark as read** is a `mark-read` job on `whatsapp.outbound`, so it stays inside the one module allowed to call Meta.
- **Realtime.** `RealtimeEmitter` (core) publishes through the Socket.IO Redis adapter from api and worker: `message.created`, `message.status` and `message.updated` go to `tenant:{id}` and `conversation:{id}`, and `conversation.updated` to both. Sockets join `conversation:{id}` with `conversation.join`, which checks the conversation belongs to the socket's tenant.
- **Metrics** (`prom-client`; OpenTelemetry comes in Phase 12): `webhook_received_total{kind,result}`, `webhook_ingest_duration_ms`, `meta_api_requests_total{endpoint,result,error_code}`, `meta_api_duration_ms`, `messages_status_total{direction,status}`, `queue_depth{queue,state}`, `dlq_size{queue}`. Served on the worker's internal health port (`/metrics`) and the api's internal `METRICS_PORT`.
- **Consent** (Phase 6): `purpose` is stored on the message and checked at accept and send time: MARKETING needs GRANTED, and UTILITY is blocked only by an explicit REVOKED. The error is 422 `CONSENT_REQUIRED` (at send time, the message fails with that code).
- **Not yet built:** compose lock and takeover guards (Phase 7), template validation (Phase 8), balance check (Phase 11), and `POST /messages/:id/retry` (Phase 7).

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| M1 | Should we support Meta "typing indicators" (mark as read + typing) in the inbox? Assumed yes in Phase 7, if the API is available. | Product |
| M2 | Do we need an interactive message builder (buttons/lists) for inbox freeform replies in v2? Assumed automation-only. | Product |
