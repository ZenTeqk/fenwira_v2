# Architecture

## Scope

The system shape of Fenwira v2: runtime processes, module boundaries, how modules communicate, the request, job and event lifecycles, and the rules that keep the monolith modular. Entity details are in `DATABASE.md`. Tenancy mechanics are in `MULTI_TENANCY.md`.

## Decisions

### Runtime processes

```text
                 Browser (Next.js client)
                    │  HTTPS (REST /api/v1, cookies)      │ WebSocket (Socket.IO)
                    ▼                                      ▼
 ┌────────────────────────────────────────────────────────────────────┐
 │ apps/api  (NestJS)                                                 │
 │  HTTP controllers · WS gateway · guards · MessagingService         │
 │  Writes state + outbox_events in ONE transaction                   │
 └───────┬──────────────────────────────┬─────────────────────────────┘
         │ Prisma (fenwira_app, RLS)    │ BullMQ producer (webhook ingest only)
         ▼                              ▼
   PostgreSQL 16  ◄───────────────►  Redis 7
         ▲  outbox relay (poll)         │ BullMQ consumers
         │                              ▼
 ┌────────────────────────────────────────────────────────────────────┐
 │ apps/worker (NestJS standalone)                                    │
 │  Outbox relay · queue processors · repeatable jobs                 │
 │  The ONLY process that calls Meta send APIs                        │
 └───────┬───────────────────────────────┬────────────────────────────┘
         ▼                               ▼
   Meta Cloud API                   MinIO (S3 API) · Mailpit (SMTP)

 apps/web (Next.js): UI only, holds no secrets, and never talks to Postgres, Redis or Meta.
```

| Process | Owns | Must never |
| --- | --- | --- |
| `apps/web` | Rendering, client state, forms, calling the API | Hold secrets, call Meta, access DB/Redis |
| `apps/api` | HTTP/WS, authn/authz, validation, synchronous domain writes, webhook ingest | Call Meta **send** endpoints; do long-running work in-request |
| `apps/worker` | Async processing, outbox relay, schedules, all Meta send/sync calls | Serve HTTP (except health on an internal port) |

Both api and worker use the same domain modules from `apps/api/src/modules/*`. The worker is a second Nest entry point (`apps/worker/src/main.ts`) that imports them through `@fenwira/api`'s package exports (`./core`, `./modules/*`, `./bootstrap`; ADR-0018) and loads the modules' processors. Business logic is written once.

### Frontend architecture

- Next.js App Router. Routes under `app/(auth)` (public) and `app/(app)` (authenticated shell).
- App pages are **client components**. Data comes from the API through TanStack Query. Server components are used only for static shells and metadata.
- The auth gate runs on the client: `GET /api/v1/auth/me` on shell mount, and a redirect to `/login` on 401.
- Libraries: TanStack Query for server state, Zustand only for ephemeral UI state (for example the inbox composer draft and the selected conversation), React Hook Form + Zod (schemas from `@fenwira/contracts`) for forms, and the Socket.IO client for realtime, which invalidates or patches Query caches.
- The API base URL is `NEXT_PUBLIC_API_URL`. Requests use `credentials: 'include'`.

### Backend module map (NestJS modules in `apps/api/src/modules`)

| Module | Owns tables | Phase |
| --- | --- | --- |
| `platform` | `outbox_events`, `idempotency_keys`, `files`, `notifications` | 1, 3 |
| `identity` | `users`, `sessions`, `email_verification_tokens`, `password_reset_tokens`, `two_factor_credentials` | 3 |
| `tenancy` | `tenants`, `memberships`, `roles`, `permissions`, `role_permissions`, `invitations` | 3 |
| `audit` | `audit_logs` | 3 |
| `whatsapp-accounts` | `meta_business_accounts`, `whatsapp_business_accounts`, `whatsapp_phone_numbers`, `meta_credentials`, `webhook_subscriptions` | 4 |
| `messaging` | `webhook_events`, `messages`, `conversations`, `conversation_read_states` | 5, 7 |
| `contacts` | `contacts`, `contact_property_definitions`, `contact_property_values`, `tags`, `contact_tags`, `contact_notes`, `consents`, `contact_activities`, `segments`, `import_jobs`, `import_job_errors`, `export_jobs` | 5 (core), 6 |
| `inbox` | `conversation_notes`, `conversation_tags` (plus inbox behavior on `conversations`) | 7 |
| `templates` | `templates`, `template_versions` | 8 |
| `campaigns` | `campaigns`, `campaign_recipients` | 9 |
| `automation` | `flows`, `flow_versions`, `automation_executions`, `automation_execution_steps` | 10 |
| `billing` | `plans`, `plan_entitlements`, `subscriptions`, `tenant_entitlement_overrides`, `wallets`, `wallet_transactions`, `usage_events`, `price_book_entries` | 11 |
| `analytics` | `analytics_events`, `analytics_daily_rollups` | 11 |
| `developer` | `api_keys`, `webhook_endpoints`, `webhook_deliveries` | 11 |

### Module rules

1. **A module writes only its own tables.** Another module's data is read through that module's exported service, and changed only by calling it or through domain events.
2. **Synchronous calls go through exported services.** Each module exposes a single `index.ts` public surface, and dependency-cruiser enforces that no module imports another module's internals.
3. **Async reactions go through domain events** (outbox → relay → subscriber queue). A module never enqueues directly into another module's queue.
4. **Only `messaging` talks to Meta send endpoints**, and only from the `whatsapp.outbound` processor. `whatsapp-accounts` owns the account-management Graph calls (signup, sync). `templates` owns template-management Graph calls. All of them go through `packages/whatsapp`.
5. **Circular module dependencies are forbidden** (enforced in CI).

### Request lifecycle (HTTP)

```text
request
 → correlation-id middleware (accept X-Correlation-Id or generate UUIDv7; set on AsyncLocalStorage + response header)
 → auth guard (access JWT cookie or API key) → sets actor
 → tenant guard (X-Tenant-Id or API key's tenant; verify membership; load permissions) → sets tenant
 → permission guard (@RequirePermission) → entitlement guard (@RequireEntitlement, Phase 11)
 → Zod validation pipe (schemas from @fenwira/contracts)
 → controller → service → withTenant(tenantId, tx => { domain writes; outbox insert; audit insert })
 → response serializer (contract schema .parse on output in dev/test)
 → exception filter → error envelope
```

### Event lifecycle (outbox)

```text
Service (inside withTenant tx)
  ├─ writes domain rows
  └─ INSERT outbox_events(event_type, aggregate, payload, tenant_id, status=PENDING)
COMMIT
        │
Outbox relay (worker, every 250 ms, and on NOTIFY outbox_new)
  └─ system.claim_outbox_events(batch=200) — FOR UPDATE SKIP LOCKED across tenants
       for each event → for each subscriber queue in EVENT_SUBSCRIPTIONS[event_type]:
           queue.add(event_type, payload, { jobId: eventJobId(event.id, subscriber) })   // `${id}__${queue}`
       mark DISPATCHED (or bump attempts + available_at with backoff on failure)
        │
Subscriber processor (worker)
  └─ withTenant(job.data.tenantId, tx => handle idempotently)
```

The relay provides at-least-once delivery. `jobId` dedupes inside BullMQ, and every handler is idempotent (see ADR-0014).

### Domain event catalog

| Event type | Emitted by | Payload (besides `tenantId`, `occurredAt`, `correlationId`) | Subscribers (queue) |
| --- | --- | --- | --- |
| `message.outbound.requested` | messaging (`MessagingService.send`) | `messageId` | `whatsapp.outbound` |
| `message.inbound.received` | messaging (inbound processor) | `messageId, conversationId, contactId, text?` | `contacts.events` (opt-in/out keywords), `automation.trigger`, `analytics.events` |
| `message.status.changed` | messaging (status processor) | `messageId, from, to, errorCode?, pricing?` | `campaign.events`, `analytics.events`, `billing.usage`, `contacts.events` (on 131050) |
| `conversation.opened` | messaging | `conversationId, contactId` | `analytics.events`, `inbox.events` (auto-assign) |
| `conversation.assigned` | inbox | `conversationId, assigneeId, previousAssigneeId?` | `notifications.dispatch` |
| `conversation.automation_state.changed` | inbox | `conversationId, from, to, actorId?` | `automation.trigger` |
| `contact.created` | contacts | `contactId, source` | `automation.trigger`, `analytics.events` |
| `contact.updated` | contacts | `contactId, changedFields[]` | `automation.trigger` |
| `consent.changed` | contacts | `contactId, purpose, status, source` | `analytics.events` |
| `template.status.changed` | templates | `templateVersionId, from, to, reason?` | `notifications.dispatch` |
| `campaign.launched` | campaigns | `campaignId` | `campaign.dispatch`, `analytics.events` |
| `campaign.completed` | campaigns | `campaignId, counts` | `notifications.dispatch`, `analytics.events` |
| `automation.execution.finished` | automation | `executionId, flowId, status` | `analytics.events` |
| `wallet.low_balance` | billing | `walletId, balanceMinor` | `notifications.dispatch` |
| `whatsapp.connection.changed` | whatsapp-accounts | `phoneNumberId, status` | `notifications.dispatch` |

Payloads carry IDs, not full records. Processors re-read current state inside `withTenant`. Payload schemas live in `packages/contracts/src/events`.

### Queue catalog (`packages/queue`)

| Queue | Producer | Purpose | Concurrency (default) |
| --- | --- | --- | --- |
| `whatsapp.inbound` | api webhook controller | Process inbound message events | 20 |
| `whatsapp.status` | api webhook controller | Apply status/template/quality/account events | 20 |
| `whatsapp.outbound` | outbox relay | Send one message to Meta | 20, plus a per-number limiter |
| `whatsapp.outbound.dlq` | outbound processor (exhausted) | Parked for inspection and replay | 0 (manual) |
| `whatsapp.media` | inbound processor | Download inbound media → MinIO | 5 |
| `whatsapp.sync` | repeatable scheduler | Phone quality/tier/status, template reconciliation, credential expiry | 2 |
| `contacts.events` | outbox relay | Opt-in/out keyword and 131050 consent handling | 10 |
| `contacts.import` / `contacts.export` | contacts API | CSV import/export | 2 |
| `inbox.events` | outbox relay | Auto-assignment | 10 |
| `campaign.dispatch` | outbox relay / scheduler | Snapshot and batch-dispatch recipients | 4 |
| `campaign.events` | outbox relay | Recipient status sync, completion detection | 10 |
| `automation.trigger` | outbox relay | Match events to active flows, start executions | 10 |
| `automation.execute` | automation (self), delayed jobs | Run execution steps | 20 |
| `analytics.events` | outbox relay | Append analytics events | 10 |
| `billing.usage` | outbox relay | Price billable messages, debit the wallet | 5 |
| `notifications.dispatch` | outbox relay | In-app notification + email | 5 |
| `webhooks.deliver` | outbox relay (Phase 11) | Tenant outbound webhooks | 10 |
| `system.maintenance` | repeatable scheduler | Retention cleanup, idempotency key expiry, rollups | 1 |
| `system.ping` | health/test | End-to-end queue check | 1 |

Every job payload includes `tenantId` (except `system.*`) and `correlationId`. Custom job IDs are always built with `jobId(...parts)` from `@fenwira/queue`, which joins parts with `__`, because BullMQ rejects `:` in job IDs. Processors implement `QueueProcessor` and are registered through `WorkerRuntimeModule` (ADR-0020), which runs every job inside its log context.

### Realtime

A Socket.IO gateway on the api with `@socket.io/redis-adapter`, so any api replica can emit.

| Room | Joined when |
| --- | --- |
| `tenant:{tenantId}` | On connect, after the membership check |
| `user:{userId}` | On connect |
| `conversation:{conversationId}` | When the client opens a conversation (inbox permission and tenant re-checked) |

Server → client events: `message.created`, `message.status`, `conversation.updated`, `conversation.assigned`, `compose.lock` (a lock was taken or released), `presence.updated`, `import.progress`, `campaign.progress`, `notification.created`. Workers emit through the Redis adapter emitter (`@socket.io/redis-emitter`). Client → server events: `conversation.join`, `conversation.leave`, `compose.heartbeat`, `presence.heartbeat`, `tenant.switch`.

### Storage

S3 API only (`@aws-sdk/client-s3`), pointed at MinIO locally. There is one bucket per purpose: `fenwira-media` (message media), `fenwira-imports` and `fenwira-exports` (7-day lifecycle), and `fenwira-uploads` (avatars, template samples). Object keys always begin `{tenantId}/…`. Browsers upload and download through presigned URLs (5-minute TTL), and every object is recorded in `files`.

### Email

SMTP via Nodemailer (`SMTP_URL`), pointed at Mailpit locally. Templates are React Email components in `apps/api/src/modules/platform/email`.

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| A1 | Do we need a separate read replica before Phase 12? (Assumed no.) | Eng |
