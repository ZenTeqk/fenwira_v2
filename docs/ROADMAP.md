# Fenwira v2 — Roadmap

Fenwira v2 is a new application built from scratch. Each phase leaves the system usable and testable. Phase prompts are in [prompts/](prompts/).

**First milestone: Fenwira Core = Phases 0–7.** That covers Docker Compose, the design system, auth, multi-tenancy with RLS, the Meta connection, reliable inbound and outbound messaging, contacts, and the shared inbox. Templates, campaigns, automation and billing build on this foundation and never implement their own messaging logic.

## Status

Spec index: every doc in `docs/` plus `docs/adr/`. Open questions are in `PRODUCT.md` → Open questions register.

Legend: ⬜ not started · 🟡 spec partially defined · 🔵 in progress · ✅ done (all acceptance criteria pass)

| Phase | Scope | Status | Prompt |
| --- | --- | --- | --- |
| 0 | Product + architecture specification | 🔵 all 18 docs and 17 ADRs drafted; waiting for owner review of the open questions in `PRODUCT.md` | [PHASE_00](prompts/PHASE_00_SPECIFICATION.md) |
| 1 | Monorepo + Docker Compose + engineering foundation | 🔵 every local acceptance criterion passes (see below). Only remaining item: CI green on a PR, which needs a GitHub remote. | [PHASE_01](prompts/PHASE_01_FOUNDATION.md) |
| 2 | Design system + application shell | ✅ all acceptance criteria pass locally (see below). The CI workflow includes every check but hasn't run on GitHub yet (no remote). | [PHASE_02](prompts/PHASE_02_DESIGN_SYSTEM.md) |
| 3 | Authentication + tenant + RBAC + RLS | ✅ all acceptance criteria pass locally (see below). CI hasn't run on GitHub yet (no remote). | [PHASE_03](prompts/PHASE_03_AUTH_TENANCY.md) |
| 4 | Meta onboarding + WhatsApp account management | 🔵 every criterion passes against the simulated Graph API (see below). Real Embedded Signup needs Meta Tech Provider approval (MI1). |  [PHASE_04](prompts/PHASE_04_META_ONBOARDING.md) |
| 5 | Webhook + messaging engine | 🔵 every criterion passes against the simulated Graph API (see below). The real-test-number run needs Meta credentials (MI1). | [PHASE_05](prompts/PHASE_05_MESSAGING_ENGINE.md) |
| 6 | Contacts + consent + CRM foundation | ⬜ | [PHASE_06](prompts/PHASE_06_CONTACTS_CONSENT.md) |
| 7 | Multi-agent shared inbox | ⬜ | [PHASE_07](prompts/PHASE_07_INBOX.md) |
| 8 | Template management / builder | ⬜ | [PHASE_08](prompts/PHASE_08_TEMPLATES.md) |
| 9 | Campaign / broadcast engine | ⬜ | [PHASE_09](prompts/PHASE_09_CAMPAIGNS.md) |
| 10 | Automation / visual flow builder | ⬜ | [PHASE_10](prompts/PHASE_10_AUTOMATION.md) |
| 11 | Billing + analytics + administration | ⬜ | [PHASE_11](prompts/PHASE_11_BILLING_ANALYTICS.md) |
| 12 | Hardening + testing + production readiness | ⬜ | [PHASE_12](prompts/PHASE_12_HARDENING.md) |

## Dependency order

```text
0 Spec → 1 Docker foundation → 2 Design system → 3 Auth + Tenant + RLS
  → 4 Meta onboarding → 5 Messaging infrastructure
      → 6 Contacts/Consent ─┐
      → 7 Inbox ────────────┴→ 8 Templates → 9 Campaigns → 10 Automation
                                → 11 Billing + Analytics → 12 Hardening
```

Phases 6 and 7 can run in parallel once Phase 5 is done. Nothing else may start before its predecessor is ✅.

## Frozen navigation

```text
Dashboard
Inbox
Contacts      All Contacts · Segments · Tags · Imports
Campaigns     Campaigns · Create Campaign · Analytics
Templates     Templates · Create Template
Automations   Flows · Flow Builder
Analytics
Integrations  WhatsApp · Webhooks · API
Billing       Subscription · Wallet · Usage
Settings      Workspace · Team · Roles · WhatsApp · Security · Audit Logs
```

Nav items for modules from later phases are hidden until their phase ships. Don't show disabled "coming soon" items.

## Terminology

- **Tenant** is the code and DB term (`tenant_id`). **Workspace** is the UI term. They mean the same thing.
- Roles: `OWNER`, `ADMIN`, `MANAGER`, `AGENT`, `VIEWER`.
- Message states: `CREATED → QUEUED → SENDING → SENT → DELIVERED → READ`, or `FAILED`.

## Phase 1 verification (2026-09-23)

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Fresh clone → `cp .env.example .env && docker compose up -d` → 7 services healthy within 3 min | ✅ | Clean clone, empty volumes: healthy in 24 s with cached images. First-ever build ≈ 5 min, then about 20 s to healthy. |
| `/health/ready` 200 with postgres, redis and queue up. Stopping Redis gives 503. | ✅ | 503 with `redis: down` and `queue: down`, `/health/live` stays 200, recovers after restart |
| Postgres not reachable from the host | ✅ | Containers have no host port bindings. (This Mac also runs a separate native Postgres/Redis on 5432/6379, unrelated to Fenwira v2.) |
| api connects as `fenwira_app`, `rolbypassrls = false` | ✅ | `pg_stat_activity`: `fenwira_app, super=f, bypassrls=f`, plus an integration test |
| `system.ping` via outbox → relay → worker, with the correlation ID in both logs | ✅ | `pnpm smoke`. The same `correlationId` appears in api and worker log lines. Events emitted while the worker was stopped were processed after restart (5/5). |
| CI green on a PR; lint, type or test failures fail the build | ⏳ | `.github/workflows/ci.yml` written, and every step passes locally. It has not run on GitHub yet (no remote configured). |
| `docs/DEPLOYMENT.md` documents every env var and port | ✅ | Updated, including the phase each variable is introduced in |

Test counts: 46 unit tests (9 packages) and 29 integration tests (16 RLS/outbox, 10 API HTTP, 3 worker round trip).

## Phase 2 verification (2026-09-24)

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| `/dev/ui` shows every component and variant with no axe violations at AA | ✅ | `e2e/a11y.spec.ts` runs axe (WCAG 2.1 A/AA) on the gallery, the dashboard, the open modal, menu, confirm dialog and command palette, and the mobile drawer, against the composed stack. Fixes it forced: the `-strong` shades (product-owner decision) and `slate-800` table headers. |
| Shell renders at 1440, 1024 and 375 px without horizontal scroll | ✅ | `e2e/responsive.spec.ts`: dashboard and gallery at all three widths, a persistent sidebar at 1024 px, the drawer at 375 px, collapse to a 64 px rail that persists across reload |
| The CI check finds zero raw colors in `apps/web`, and introducing one fails | ✅ | `pnpm lint:design` passes. Throwaway commit `e2607ce` (a `#ff0000` style plus `text-[#00A884]`) made it exit 1 with 3 findings; the branch was then deleted. |
| Command palette opens with ⌘K/Ctrl+K and navigates to every visible nav item | ✅ | `e2e/keyboard.spec.ts`: passes with the shipped navigation (Dashboard) and in preview mode (all 26 items) |
| Every StatusBadge renders a text label, never color alone | ✅ | A unit test renders all 27 `STATUS_PRESETS` and asserts each label |

Test counts: 87 unit tests (32 in `@fenwira/ui`), 29 integration tests and 19 Playwright e2e tests. 29 components, plus `Field`/`Label`.

## Phase 3 verification (2026-09-24)

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Every section-4 flow works end to end in the browser, with emails in Mailpit | ✅ | `apps/web/e2e/auth.spec.ts` and `tenancy.spec.ts` drive the real UI against the composed stack. Covered: register → verify link → create workspace → dashboard; sign out/in; redirect back after sign-in; forgot → reset link; 2FA enrolment (QR code, secret, backup codes) and sign-in with a code; session list and "sign out other sessions"; invite from Team → accept as a new account. Emails are read from Mailpit. |
| Generated cross-tenant matrix passes; CI fails when a tenant table has no RLS policy | ✅ | `packages/database/test/tenant-matrix.int.test.ts` (per tenant table, from `pg_catalog`; fails when a table has no fixture). `apps/worker/test/security-matrix.int.test.ts` covers every tenant route (from route metadata): 404 cross-tenant, 403 for every role × missing permission, list isolation, WebSocket rooms. The migrate step fails on any RLS gap. |
| Switching tenant changes all data on screen, with no stale cache | ✅ | e2e `switching workspace changes all data on screen`. Query keys are tenant-prefixed, and switching clears the cache and remounts the page. The same user in two workspaces sees each workspace's own data in the API test. |
| Auth endpoints are rate limited (a test proves it) | ✅ | Login: 5 → 429 with `Retry-After`. Forgot password: 3 → 429. |
| `API_SPEC.md` and `DATABASE.md` updated | ✅ | Both describe the implemented endpoints and schema. SECURITY, MULTI_TENANCY, ARCHITECTURE and DEPLOYMENT are updated too. |

Test counts: 90 integration (38 database, 10 API, 42 system) and 32 Playwright e2e (auth, tenancy, axe WCAG 2.1 AA on the sign-in and settings pages, responsive, keyboard), plus unit tests in every package.

Bugs found and fixed during the phase:

- The fail-fast Redis connection made rate-limited endpoints return 500 right after boot or during reconnects.
- `trust proxy` was hard-coded, which would allow IP spoofing past per-IP limits.
- The in-memory CSRF token was empty after a full page load, so the first mutation (for example, clicking the email verification link while signed in) failed.
- A stale "signed out" cache entry bounced users back to sign-in after a redirect login.

## Phase 4 verification (2026-09-25)

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| With real Meta sandbox credentials, a new tenant completes Embedded Signup and sees **Connected** with no manual DB edits | ⏳ | Blocked on MI1 (Meta Tech Provider onboarding). The full server-side sequence (exchange → debug_token → WABA/number → uniqueness → store → subscribe → register → validate) passes against `fenwira-meta-mock` in `apps/worker/test/whatsapp.int.test.ts`. The browser side (`lib/facebook-sdk.ts`: FB.login plus the `WA_EMBEDDED_SIGNUP` message) needs real credentials to verify. |
| Dev connect works with the Meta test number and is absent when the flag is off | ✅ | Integration tests: connected with a pasted token and registration skipped; with the flag off, 404 and `devConnect: false`. e2e `whatsapp.spec.ts`: Developer connect → Connected → Test connection → Disconnect in the browser. The env schema refuses `WHATSAPP_DEV_CONNECT=true` in production. |
| The raw token never appears in any API response, log line, audit entry or browser storage | ✅ | The `token hygiene` test searches every captured response (including `/audit-logs`) and every debug-level log line for the issued tokens. e2e checks localStorage, sessionStorage and cookies. The DB holds only `v1.k1.…` ciphertext. |
| Connecting a `phone_number_id` already owned by another tenant is rejected without revealing that tenant | ✅ | 409 `PHONE_NUMBER_ALREADY_CONNECTED`; the body contains neither the other workspace's name, its ID nor the connection ID. Guaranteed by X11 plus the partial unique index (DB test). The number can be connected elsewhere after it is disconnected. |
| Disconnecting unsubscribes the webhooks and wipes the credential | ✅ | The mock receives `DELETE /{waba}/subscribed_apps`; every credential is `REVOKED` with `token_ciphertext = NULL`; the webhook subscription is `REMOVED`. |
| Cross-tenant tests extended to all new tables | ✅ | The tenant matrix has fixtures for all 5 tables (the coverage test fails without them). The security matrix picks up the 10 new routes automatically. |

Also verified: the resumable post-store failure → Retry path, test message plus revoked-token detection → Rotate token, the default number moving on PATCH or disconnect, RBAC (a MANAGER can read but not manage; an AGENT can't test), and the `whatsapp.sync` scheduler fan-out → per-number job → quality/tier update audited as SYSTEM. axe runs on `/settings/whatsapp` with no WCAG AA violations.

Test counts: 126 integration (62 database, 10 API, 54 system), 33 Playwright e2e and 122 unit tests.

Bugs found and fixed during the phase:

- The worker couldn't boot the sync processor because `AuditModule` was imported only by the API root module. Nest aborted the whole test process.

## Phase 5 verification (2026-09-25)

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Replaying the same webhook payload 10 times creates exactly one message | ✅ | `apps/worker/test/messaging.int.test.ts`: 10 concurrent signed deliveries → 1 message, 1 `webhook_events` row (PROCESSED), contact with profile name, and a service window of exactly 24 h from the customer's timestamp. |
| A bad signature returns 401 and persists nothing | ✅ | Wrong secret, missing header, and a valid signature over re-serialized JSON all return 401, with 0 `webhook_events` rows and no conversations. The handshake echoes `hub.challenge` only with the right verify token. |
| CREATED → QUEUED → SENDING → SENT → DELIVERED → READ on a real test number, and the UI updates live | ✅ / ⏳ | Against the mock: the integration test receives exactly `QUEUED, SENDING, SENT, DELIVERED, READ` over Socket.IO in the `conversation:{id}` room. e2e: the Test connection dialog's test message reaches Read, and the test asserts the `message.status` frames arrived over the WebSocket. A real test number needs Meta credentials (MI1). |
| Out-of-order statuses (READ before DELIVERED) end in READ | ✅ | READ → DELIVERED → SENT webhooks end READ with `delivered_at` backfilled; a later `failed` is recorded (`META_131026`) without regressing the status. |
| Killing the worker mid-send and restarting gives no duplicate and no lost message | ✅ | Integration: graceful stop mid-send (the in-flight send completes, one queued while down is sent after restart) and a simulated crash recovered through `biz_opaque_callback_data` with zero resends. Live stack: `docker kill fenwira-worker` while Meta was processing the send → final READ with exactly **1** Meta call. |
| Killing Redis, sending, then restoring Redis: the outbox delivers once Redis is back | ✅ | Live stack (`docker stop fenwira-redis` with the send pending): the message stayed CREATED and its outbox event PENDING while retrying; after `docker start fenwira-redis` it reached READ with exactly **1** Meta call. The worker now starts even while Redis is down, since the sync scheduler registers in the background. |
| A 5xx is retried with backoff; a permanent error fails with no retries; exhausted retries land in the DLQ | ✅ | 2 injected 500s → SENT on the 3rd call; 131026 → FAILED `META_UNDELIVERABLE` after exactly 1 call; 10 injected 503s → FAILED `RETRIES_EXHAUSTED` after 5 calls, with the job in `whatsapp.outbound.dlq`. `pnpm --filter @fenwira/worker dlq --message <id>` replays it to SENT. |
| A freeform send outside the 24h window is rejected server-side with a typed error | ✅ | 422 `CONVERSATION_WINDOW_CLOSED`; a template to the same number is accepted and sent. The worker re-checks the window at send time. |
| A static check proves only the outbound worker imports the Meta send functions | ✅ | dependency-cruiser rule `meta-send-only-in-outbound` over `@fenwira/whatsapp/send`. A planted import in another messaging file made `pnpm lint:deps` fail. The Phase 4 direct test send was removed; test messages go through `POST /conversations`. |

Also verified: the Idempotency-Key replay returns the same message with `Idempotent-Replayed: true` and sends once (a different body is 409, a missing key 400); inbound media lands in MinIO and downloads through a presigned URL; presigned upload → magic-byte check → image send; mark-as-read reaches Meta; the security matrix covers the 10 new routes; and metrics (`webhook_received_total`, `meta_api_requests_total`, `queue_depth`, `dlq_size` and others) carry no tenant labels.

Test counts: 168 integration (88 database, 10 API, 70 system), 33 Playwright e2e and 131 unit tests.

Bugs found and fixed during the phase:

- The generated RBAC check expected 200 from every allowed GET, but routes with an `:id` correctly answer 404 NOT_FOUND for a random id. The check now requires 200, or 404 NOT_FOUND for `:id` routes.
- A type-only import between `core-config` and `storage.service` formed a dependency cycle, which dependency-cruiser caught.
- Worker boot awaited the sync scheduler registration, so a Redis outage at startup would crash-loop the worker.

