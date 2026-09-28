# Fenwira v2 — Roadmap

Fenwira v2 is a new application built from scratch. Each phase leaves the system usable and testable. Phase prompts are in [prompts/](prompts/).

**First milestone: Fenwira Core = Phases 0–7.** That covers Docker Compose, the design system, auth, multi-tenancy with RLS, the Meta connection, reliable inbound and outbound messaging, contacts, and the shared inbox. Templates, campaigns, automation and billing build on this foundation and never implement their own messaging logic.

## Status

Spec index: every doc in `docs/` plus `docs/adr/`. Frozen decisions are in `PRODUCT.md` → Decision register, and the remaining open questions are in `PRODUCT.md` → Open questions register.

Legend: ⬜ not started · 🟡 spec partially defined · 🔵 in progress · ✅ done (all acceptance criteria pass)

| Phase | Scope | Status | Prompt |
| --- | --- | --- | --- |
| 0 | Product + architecture specification | ✅ frozen 2026-09-26: every open question is decided (`PRODUCT.md` → Decision register, ADR-0022 and ADR-0023). | [PHASE_00](prompts/PHASE_00_SPECIFICATION.md) |
| 1 | Monorepo + Docker Compose + engineering foundation | 🔵 every local acceptance criterion passes (see below). Only remaining item: CI green on a PR, which needs a GitHub remote. | [PHASE_01](prompts/PHASE_01_FOUNDATION.md) |
| 2 | Design system + application shell | ✅ all acceptance criteria pass locally (see below). The CI workflow includes every check but hasn't run on GitHub yet (no remote). | [PHASE_02](prompts/PHASE_02_DESIGN_SYSTEM.md) |
| 3 | Authentication + tenant + RBAC + RLS | ✅ all acceptance criteria pass locally (see below). CI hasn't run on GitHub yet (no remote). | [PHASE_03](prompts/PHASE_03_AUTH_TENANCY.md) |
| 4 | Meta onboarding + WhatsApp account management | 🔵 every criterion passes against the simulated Graph API (see below). Real Embedded Signup needs Meta Tech Provider approval (MI1). |  [PHASE_04](prompts/PHASE_04_META_ONBOARDING.md) |
| 5 | Webhook + messaging engine | 🔵 every criterion passes against the simulated Graph API (see below). The real-test-number run needs Meta credentials (MI1). | [PHASE_05](prompts/PHASE_05_MESSAGING_ENGINE.md) |
| 6 | Contacts + consent + CRM foundation | ✅ all acceptance criteria pass locally (see below). CI hasn't run on GitHub yet (no remote). | [PHASE_06](prompts/PHASE_06_CONTACTS_CONSENT.md) |
| 7 | Multi-agent shared inbox | ✅ all acceptance criteria pass locally, including canned replies (decisions I2 and I3; see below). CI hasn't run on GitHub yet (no remote). | [PHASE_07](prompts/PHASE_07_INBOX.md) |
| 8 | Template management / builder | 🔵 every criterion passes against the simulated Graph API (see below). The real-WABA round trip needs Meta production onboarding (MI1). | [PHASE_08](prompts/PHASE_08_TEMPLATES.md) |
| 9 | Campaign / broadcast engine | ✅ complete (closed 2026-09-26 with decisions P9-D1–D3; see below). Real sends need MI1. | [PHASE_09](prompts/PHASE_09_CAMPAIGNS.md) |
| 10 | Automation / visual flow builder | ✅ implemented with decisions P10-D1–D4 (ADR-0025); every criterion passes locally (see below). Real sends need MI1. | [PHASE_10](prompts/PHASE_10_AUTOMATION.md) |
| 11 | Billing + analytics + administration | 🟡 implementation plan for review, with decision register P11-Q1–Q19: [plans/PHASE_11_PLAN.md](plans/PHASE_11_PLAN.md) | [PHASE_11](prompts/PHASE_11_BILLING_ANALYTICS.md) |
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
Automations   Flows · New automation (the builder opens per flow)
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

## Phase 6 verification (2026-09-25)

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Importing a 50k-row CSV with 5% invalid rows and 10% duplicates completes, the counts match, and the error CSV is correct | ✅ | `apps/worker/test/contacts.int.test.ts`: preview `total 50,000 / valid 47,500 / invalid 2,500 / new 42,500 / existing 5,000`, and the import creates 42,500 and skips 5,000. The error CSV has exactly the 2,500 invalid rows (row numbers match), with the original columns and `INVALID_PHONE`. It takes about 60 s including a 5k-row seed import. The column mapping was auto-suggested from the headers. |
| An inbound "STOP" revokes marketing consent within seconds, and the Consent tab shows the evidence message | ✅ | Revoked in under 10 s (the test asserts it); the history row has `source INBOUND_KEYWORD` and `evidence {messageId, keyword}`, and the grant it ends gets `revoke_source`. The confirmation reply goes out through `MessagingService`. A repeated STOP adds no row, and START opts back in. The Consent tab renders the evidence (e2e for manual changes). |
| A marketing send to a contact without consent is rejected by `MessagingService` (test) | ✅ | `CONSENT_REQUIRED`. The outbound worker re-checks at send time. Meta 131050 on a send revokes consent with `META_OPT_OUT` evidence. UTILITY sends are blocked only after an explicit revocation. |
| A segment count equals the filtered list count for the same DSL (property-based test on generated filters) | ✅ | fast-check, 40 generated filters up to depth 3: search IDs, `/contacts/count` and `/segments/:id/count` all equal an independent reference evaluator. It found and fixed a real bug (Prisma drops `{}` inside `OR`). |
| The cross-tenant matrix covers contacts, search, segments, imports and exports | ✅ | Tenant matrix fixtures for all 11 new tables (contact activities are append-only). The security matrix covers every new route. Another workspace's segment inside a filter is a 400. |
| Deleting contacts is a soft delete, and it is audit-logged | ✅ | `DELETE /contacts/:id` → 404 afterwards, a `contact.deleted` audit entry, and the phone can be reused. A bulk delete writes `contacts.bulk_deleted` with the count. |

UI: Contacts (list with search, filter builder, bulk tag, untag and delete, save as segment, export), Contact 360 (Overview, Conversations, Campaigns placeholder, Activities, Consent, Notes), Segments (builder with a live count), Tags, Imports (upload → map → preview → progress → error report), and Settings → Workspace → Contact fields and Opt-out keywords. e2e covers create → consent → notes, filter → segment, and the import wizard. axe runs on the four contacts pages.

Test counts: 219 integration (132 database, 10 API, 77 system), 36 Playwright e2e and 134 unit tests.

## Phase 7 verification (2026-09-24)

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Two agents in two browsers on the same conversation: only the lock holder or assignee can send, and the other sees the typing indicator and a disabled composer | ✅ | `apps/worker/test/inbox.int.test.ts`: while one agent holds the lock, the other's send is 409 `COMPOSE_LOCKED` naming the holder, and a non-assignee can't force it; sending releases the lock; the assignee can force the lock, after which the previous holder's send is refused. e2e `inbox.spec.ts` with two browser contexts: agent B sees "… is replying…" and a disabled composer, and replies arrive live in the other browser. |
| 100 inbound messages burst into 20 conversations: every message appears in order, unread counts are correct, and nothing is duplicated | ✅ | 100 signed webhooks (5 per conversation, delivered shuffled and concurrently): exactly 100 messages, each thread in provider-timestamp order, unread 5 per conversation for a user who never opened them, and 0 after mark-read. |
| Outside the service window, a freeform reply is blocked by the server even if the UI check is bypassed (API test) | ✅ | Direct API call → 422 `CONVERSATION_WINDOW_CLOSED`; a template is accepted. |
| During AGENT_TAKEOVER, an automation-sourced send is rejected (test) | ✅ | The first agent reply sets `AGENT_TAKEOVER` and writes a `takeover` system event; `MessagingService` with `source AUTOMATION` → 422 `AUTOMATION_BLOCKED_BY_TAKEOVER`. "Return to automation" allows it again. The outbound worker re-checks the same guard at send time. |
| An agent in Tenant A never receives WebSocket events from Tenant B (test with two sockets) | ✅ | Two sockets in two tenants: none of A's `message.*`, `conversation.updated`, `compose.lock` or `presence.updated` events reach B. B can't join A's conversation room, and B's `compose.heartbeat` for it is refused. |
| Search returns only the current tenant's conversations | ✅ | The same word in both tenants: each tenant's `?q=` returns only its own conversations, with the message snippet. Name and phone matches work too. |
| Lighthouse accessibility score of at least 90 on the inbox page | ✅ | **100**, with 0 failing audits (lighthouse 12.8.2, signed-in admin, headless Chromium). axe (WCAG 2.1 AA) on `/inbox` in `a11y.spec.ts` and `inbox.spec.ts`. |

Also verified: assignment permissions (an agent can't assign others: 403) and the assignee's notification; round-robin auto-assign to the ONLINE agent; a snooze expiring through the maintenance job (X13); `ASSIGNED_ONLY` visibility hides other agents' conversations from the AGENT role (404); the tenant matrix has fixtures for the 4 new tables; and the security matrix covers every new route (PUT added to the harness).

UI: the three-pane inbox (Conversations | Chat | Contact) with views, search and unread filter; a virtualized thread with system-event pills and internal notes; a composer with the compose lock, template-only mode when the window is closed, attachments and optimistic send; assignment, status, snooze, takeover and tags in the header; a compact Contact 360 pane (a drawer below 1280 px, a single pane with back navigation below 768 px); a notifications bell; and an unread badge on the Inbox nav item.

Test counts: 244 integration (148 database, 10 API, 86 system), 38 Playwright e2e and 134 unit tests.

Bugs found and fixed during the phase:

- axe flagged the view switcher (tabs without tab panels) and muted text on `primary-soft` and `neutral-soft`. The switcher became a toggle-button group, and the selected row, outbound bubbles and empty state use AA-passing text.
- Lighthouse flagged the account menu button (visible initials not in its `aria-label`). The initials are now hidden from assistive tech and the name comes from screen-reader text.
- Inbound bursts could arrive out of order, so a message's `created_at` is now Meta's timestamp, and the conversation's last-message fields only move forward.

Not covered by a test yet: idle-takeover auto-release (same X13 job as the snooze path) and the lock's 30 s expiry (the Redis TTL).

Fenwira Core (Phases 0–7) was complete locally, except for CI on a GitHub remote and real Meta runs (MI1). The specification freeze then added canned replies to Phase 7 (see below).

## Specification freeze follow-ups (2026-09-26)

The decisions in `PRODUCT.md` → Decision register need this work in already-built or upcoming phases. Nothing else changes scope. Phase 8 doesn't start until the first four rows pass.

| Decision | Work | Where |
| --- | --- | --- |
| I2, I3 | ✅ Workspace-shared canned replies with RBAC, RLS and tests | Phase 7 (done 2026-09-26) |
| C1, C3 | ✅ The Phase 6 consent checks now go through `MessageEligibilityService`, with the temporary rules marked and tested | Phase 6 code (done 2026-09-26) |
| API1 | ✅ `docs/openapi.json` is generated and verified from the Zod contracts | Cross-cutting (done 2026-09-26) |
| — | ✅ Phase 0–7 acceptance and regression suite | Done 2026-09-26 (below) |
| AE2, AE3 | `flows.priority`, sequential trigger runs and `automation_trigger_runs` | Phase 10 |
| B3, B4 | Wallet reservations, available-funds enforcement for every billable source, and `PAUSED_INSUFFICIENT_FUNDS` | Phase 9 (enum), Phase 11 |
| T2, T3 | OWNER restore, the per-tenant purge job and a retention-category CI check | Not yet scheduled in a phase |

### Spec-freeze verification (2026-09-26)

| Item | Result | Evidence |
| --- | --- | --- |
| Canned replies (Phase 7 criterion) | ✅ | `inbox.int.test.ts`: MANAGER creates `/Hello` (stored `/hello`); a duplicate in any case is 409, and a bad shortcut 400. AGENT lists and searches but gets 403 on create, edit and delete; VIEWER gets 403 on list. Another workspace sees none, gets 404 on edit and delete, and can reuse the shortcut. Create, update and delete are audited. The tenant matrix has a `canned_replies` fixture, and the security matrix covers the 4 routes. e2e: added in Settings → Workspace, `/tha` in the reply box shows the picker, Enter inserts (never sends), edit, send; axe passes with the picker open. |
| `MessageEligibilityService` (C1/C3) | ✅ | Unit tests: MARKETING needs GRANTED; category beats purpose; suppression; the service window; fixed rule order; `TEMPORARY_RULES` pinned to exactly `TEMP_UTILITY_BLOCK_ON_REVOKED` and `TEMP_AUTHENTICATION_BLOCK_ON_REVOKED`; and a source scan finding no consent comparison outside `eligibility.ts`. MessagingService (accept) and the outbound worker (send) both call it, and the existing consent integration tests still pass. |
| OpenAPI (API1) | ✅ | `docs/openapi.json`: 121 operations over 93 paths, valid OpenAPI 3.1 (`@seriousme/openapi-schema-validator`), unique operation IDs, typed request bodies and parameters, and `x-permission` per route. The unit test and CI step `openapi.mjs --check` fail when it's stale. |
| Regression | ✅ | Static: lint, typecheck, 148 unit tests, format, design tokens, dependency rules. Integration: **249** (152 database, 10 API, 87 system). e2e: **39** Playwright. Lighthouse accessibility on `/inbox`: **100**. `pnpm smoke` passes. |

Known issue (not introduced here): Lighthouse's best-practice `heading-order` audit flagged Settings → Workspace (98), because card titles were `h3` directly under the page `h1`. Fixed in Phase 8 (`CardTitle as="h2"`); the page now scores 100.

**Fenwira Core (Phases 0–7) is complete locally.** What's still open: CI on a GitHub remote, and real Meta runs (production onboarding is a separate business milestone, MI1). Phase 8 can start.

## Phase 8 verification (2026-09-26)

| Acceptance criterion | Result | Evidence |
| --- | --- | --- |
| A template round-trips on a real WABA: submit → approval webhook → APPROVED → sent from the inbox template picker | ✅ / ⏳ | Against the meta-mock (`apps/worker/test/templates.int.test.ts`): create → submit (Meta receives components with `example` blocks built from the samples) → signed `message_template_status_update` APPROVED webhook → APPROVED, `approved_version_id` set, owners notified → listed by `/templates/approved` → sent with variables (a missing variable is 422 `TEMPLATE_VARIABLES_INVALID`), reaching Meta with header, body and URL-button parameters. e2e `templates.spec.ts` does the same in the browser, from the builder to the inbox picker. A real WABA needs Meta production onboarding (MI1). |
| A rejected template shows Meta's reason. Editing it creates version 2 while version 1 stays unchanged | ✅ | REJECTED with `rejectionReason: INVALID_FORMAT`. PATCH on a rejected version is 409; `POST /versions` makes v2 as a DRAFT; v1 keeps its content and reason. Resubmitting v2 edits the same Meta template, and approval advances `approved_version_id`. While v2 is under review, the approved v1 stays in the picker. |
| Invalid templates (variable gap, missing sample, too many buttons) are blocked identically by UI and API (shared schema test) | ✅ | For each case, the shared `validateTemplate` (which the builder runs), `POST /templates/validate` and a submit (422 `TEMPLATE_INVALID`) return the same codes. 12 unit tests cover every rule. |
| A network failure on submit leaves the version DRAFT and retryable, never REJECTED | ✅ | An injected 503 and a revoked-token 401 each give 503 `UPSTREAM_UNAVAILABLE`, with the version still DRAFT (`lastError` set, no Meta id); the retry succeeds and is approved. Only Meta's own 4xx validation produces REJECTED (with Meta's message). A lost submit response is adopted on retry (Meta's "already exists") instead of being duplicated. |

Also verified: sync imports templates created in WhatsApp Manager (and `hello_world` on connect), records content edited there as a Meta-originated version (the old approved version is archived, and a repeat sync changes nothing), and applies quality, pause/reinstate and category webhooks (a paused template leaves the picker and is refused at send); media headers go through Meta's resumable upload (`OAuth` header) and the sent file replaces the placeholder at send time; AGENT can read and send but not write or submit; another tenant gets 404 and can't send with a foreign version id; delete removes the name at Meta in every language; X14 lists only WABAs not synced within 6 hours. Lighthouse accessibility: `/templates` 100, `/templates/new` 100.

Test counts: 269 integration (161 database, 10 API, 98 system), 40 Playwright e2e and 165 unit tests.

Bugs found and fixed during the phase:

- The e2e label "Message text" also matched the Authentication option's hint; the test targets the textbox role.
- The X14 test compared totals capped at 500 in a long-lived test database; it now checks the workspace's own WABA.
- A test for WhatsApp Manager edits changed a copy of the mock data, so it passed without testing anything; it now edits the mock and asserts the archive and idempotent re-sync.
- Card titles are now `h2` on template and workspace settings pages (Lighthouse heading order).

## Phase 9 verification (2026-09-26)

| # | Acceptance criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Create a campaign with an approved Phase 8 template | ✅ | `campaigns.int.test.ts` (templates imported through sync); e2e wizard. Launch is refused (422 `CAMPAIGN_NOT_READY`) for paused, disabled or unknown templates. |
| 2 | Audience snapshotted deterministically | ✅ | Cut-off plus keyset pages by contact id; a contact tagged after launch is not added (test). |
| 3 | Every recipient passes MessageEligibilityService | ✅ | Snapshot classification uses `evaluateEligibility`, and every send goes through MessagingService, which asserts it again. Reasons: MISSING_VARIABLE, OPTED_OUT, BLOCKED and NO_MARKETING_CONSENT (tests); consent revoked after the snapshot → SKIPPED OPTED_OUT at send time. The C1 source scan still passes (no consent logic in campaigns). |
| 4 | Variables validated and rendered | ✅ | Mapping gaps block launch; missing values skip the recipient; the Meta payload carries `Asha`/`#A1` (test); samples render in Review (e2e). |
| 5 | Immediate campaigns | ✅ | Estimate → launch → COMPLETED with stats and rates (test and e2e). |
| 6 | Scheduled campaigns survive restarts | ✅ | SCHEDULED survives a worker restart; two concurrent schedulers → one `campaign.launched` event and 2 sends (test). Stored in UTC, shown in the workspace timezone. |
| 7 | MessagingService only | ✅ | Messages have `source CAMPAIGN` and `campaign_id`; the dispatcher imports no Meta client (dependency rules pass). |
| 8 | No duplicate sends | ✅ | Concurrent dispatch of the same campaign, the recovery pass and a worker crash → exactly 12 sends for 12 recipients; Meta 5xx retries → 1 send each; 2,000 recipients → 2,000 unique sends. |
| 9 | Webhook status in campaign results | ✅ | SENT → DELIVERED → READ per recipient; delivered webhook ×3 plus a late `sent` → counted once, never regressing (test). |
| 10 | Pause and resume safely | ✅ | Nothing new dispatched while paused; resume completes with 15/15 sends; cancel skips the rest (CANCELLED); template paused or disabled by Meta → PAUSED_TEMPLATE_UNAVAILABLE with the remainder preserved and unsent (P9-D3, Phase 9 closure). |
| 11 | Insufficient funds pause, not corrupt | ✅ | `campaigns-billing.int.test.ts` (enforced): 50 paise → 3 sent, PAUSED_INSUFFICIENT_FUNDS, 5 PENDING kept; resume refused (422) until topped up, then 8/8. 30 concurrent sends against funds for 10 → exactly 10. Failed send → reservation released; duplicate pricing → one debit; balance = Σ ledger and reserved = Σ active holds in every test. Inbound and free-form replies keep working at zero balance. |
| 12 | Tenant isolation | ✅ | B gets 404 on A's get, launch, pause, resume, cancel, estimate, stats, recipients and export; A's tag matches nothing for B; tenant matrix fixtures for all 6 new tenant tables; the security matrix covers the 14 new routes. |
| 13 | Phase 0–8 regression | ✅ | 311 integration (185 database, 10 API, 116 system), 41 e2e, 170 unit; lint, typecheck, format, design tokens, dependency rules and the OpenAPI check (151 operations) all pass. |
| 14 | Browser e2e create → review → launch → reporting | ✅ | `e2e/campaigns.spec.ts`, through Completed and Read = 2 in the results. |
| 15 | Accessibility | ✅ | axe on `/campaigns`, `/campaigns/new`, `/campaigns/analytics`, each wizard step, the review and the detail page; Lighthouse 100 on the list, new and analytics pages. |

Also found and fixed:

- A Phase 8 race: a connect-triggered template sync and a manual "Sync from Meta" could import the same template twice (500 error). Syncs of one WABA are now serialized by a row lock (test with 4 overlapping syncs).
- Outbound send-time guard failures and exhausted retries didn't emit `message.status.changed`, so reservations and campaign recipients wouldn't have learned of the failure. Every failure path now emits it (once).
- The campaign page stopped refreshing at COMPLETED while read receipts were still arriving; it now refreshes for an hour after completion.
- Two long-lived-test-database fragilities (fan-outs capped at 500 per run) in the X14 and whatsapp.sync tests.

Known limitations moved to the product backlog (`PRODUCT.md`) at closure: send windows, retrying failed recipients, individual-contact selection, inbox priority, low-balance notifications, throughput optimization (about 17 recipients/s locally) and template replacement.

### Phase 9 closure (2026-09-26)

| Decision | Change | Evidence |
| --- | --- | --- |
| P9-D1 | Tenant billing modes FREE, TRIAL (default) and PREPAID; enforcement = platform switch AND not FREE; TRIAL credit granted once (`TRIAL_CREDIT_MINOR`); `billing:mode` CLI; `GET /billing/wallet` reports mode and enforcement | `campaigns-billing.int.test.ts`: FREE sends with an empty wallet and the platform switch on; PREPAID with an empty wallet is refused; TRIAL gets exactly one 500-paise credit across three wallet opens, then sends; ledger invariants hold |
| P9-D2 | Price book: `customer_price_minor` (renamed, values kept), `provider_cost_minor`, `markup_bps`, `tax_code`/`tax_bps`, `is_placeholder` + `note`; usage events record provider cost | The seeded rows are flagged as development placeholders (test) |
| P9-D3 | `PAUSED_TEMPLATE_UNAVAILABLE` replaces FAILED and TEMPLATE_PAUSED; remaining recipients preserved and unsent; resume only with the same version; no template switching; audit via `template_snapshot` and `messages.template_version_id` | `campaigns.int.test.ts`: paused and disabled templates both pause the campaign, pending counts don't move, nothing is skipped, resume is refused while unavailable, cancel works, and every message used the frozen version |

Regression at closure: 313 integration (185 database, 10 API, 118 system), 41 e2e, 170 unit; lint, typecheck, format, design tokens, dependency rules and the OpenAPI check pass. ADR-0024 records the decisions.

## Phase 10 verification (2026-09-26)

Plan: [plans/PHASE_10_PLAN.md](plans/PHASE_10_PLAN.md). Decisions P10-D1–D4 (ADR-0025). Tests: `automation.int.test.ts` (19), `automation-billing.int.test.ts`, `safe-fetch.test.ts`, `automation.test.ts` (contracts, api, web), `e2e/automation.spec.ts`.

| # | Requirement | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Immutable, pinned versions | ✅ | Publishing v2 while a v1 execution waits in a delay: it finishes on v1 (`v1 after`), new triggers use v2; versions list shows v2 PUBLISHED, v1 ARCHIVED. |
| 2 | Deterministic ordering (AE2/AE3) | ✅ | Flows created at priorities 30, 10, 20 run 10 → 20 → 30, each starting after the previous finished; plan stored on the trigger run; unit test of the priority/created_at/id order. Two identical triggers produce identical step sequences. |
| 3 | Idempotency: messages, mutations, tags, assignments, webhooks | ✅ | Sends keyed `auto:{executionId}:{seq}`; duplicate event delivery (sequential and concurrent) → one run, one execution, one message; two recovery passes plus two workers racing one execution → unique step seqs, one send. Tags and contact updates commit with their step row; webhook calls carry `Idempotency-Key` (at-least-once, documented). |
| 4 | Durable delays, recovery across workers | ✅ | WAITING + `wait_until` in Postgres; the delayed job removed from Redis → X16 recovery re-enqueues → completes once. Paused flow: waiting executions re-delay and finish after resume. |
| 5 | 500-step limit | ✅ | FAILED `FLOW_STEP_LIMIT` with a readable detail. |
| 6 | P10-D1 insufficient funds | ✅ | Billing enforced, empty wallet: with an error branch → step FAILED `INSUFFICIENT_FUNDS`, branch sends free text, execution COMPLETED; without → execution FAILED `INSUFFICIENT_FUNDS`; one attempt, no reservation left. |
| 7 | P10-D2 takeover | ✅ | An agent reply (now emitting `conversation.automation_state.changed`) stops a waiting execution: STOPPED_TAKEOVER with a SKIPPED step, the next flow SKIPPED_TAKEOVER, run STOPPED `AGENT_TAKEOVER`; no resume; new messages during takeover start nothing. State changed without an event is caught before the next step (`AUTOMATION_PAUSED`). |
| 8 | P10-D3 entitlements | ✅ | One boundary (`EntitlementsService`, allow-all source); a zero execution limit → SKIPPED_ENTITLEMENT; automation disabled → publish 403 `ENTITLEMENT_REQUIRED`. No plan names in code. |
| 9 | P10-D4 webhook security | ✅ | 46 unit tests (address ranges incl. IPv4-mapped/NAT64/6to4, internal names, rebinding answers, pinned connection, redirect re-validation and limit, size cap, timeout, redaction). Integration: metadata IP and `localhost` blocked, `http:` refused, 500 → error branch; dev receiver call carries `Idempotency-Key`, secret header and query token redacted in history; env refuses the dev-host list in production. |
| 10 | Webhook trigger | ✅ | Token + HMAC → 202 with the execution; bad or missing signature 401; unknown or rotated token 404; same `Idempotency-Key` → same execution; contact created from the body; service-window rule still enforced by MessagingService. |
| 11 | Builder/runtime separation | ✅ | Runtime reads only nodes and edges of the pinned version; `layout` is editor-only; drafts may be incomplete, the strict schema applies at publish and run time. |
| 12 | Builder, Outline, history | ✅ | e2e: canvas build with live validation, expression insert, publish, customer keyword → reply in the inbox, history timeline and "show on canvas"; Outline built and re-wired with the keyboard only. |
| 13 | Validation and concurrency | ✅ | Publish 422 `FLOW_INVALID` pinpointing node ids; reference checks (deleted tag); stale `If-Match` → 409 `VERSION_CONFLICT`, missing → 400. |
| 14 | Tenant isolation | ✅ | Another workspace gets 404 on get, draft, executions, execution, cancel, publish, pause and token rotation; its customers can't trigger A's flows; tenant-matrix fixtures for the 5 new tables (steps append-only); security matrix covers the new routes. |
| 15 | Accessibility | ✅ | axe (WCAG 2.1 AA) on the list, new, builder canvas, Outline, history detail and replay canvas. |
| 16 | Phase 0–10 regression | ✅ | 352 integration (205 database, 10 API, 137 worker; the opt-in perf probe skipped), 43 e2e, 244 unit; lint, typecheck, format, design tokens, dependency rules and the OpenAPI check pass. |

Also found and fixed:

- An agent's first reply set AGENT_TAKEOVER without emitting `conversation.automation_state.changed`; it now does, so running automation stops immediately.
- The API's CORS allow-list didn't include `If-Match`, so browser draft saves failed (caught by e2e); `ETag` is now exposed too.
- A first message from a new number didn't emit `contact.created`; it now does (source INBOUND).

Performance (local Docker, one worker, meta-mock): 200 keyword events × 3 flows = 600 executions and 1,800 steps in 25.1 s (≈ 24 executions/s, 72 steps/s; 8 events/s because each event's flows run one after another by design). Probe: `PERF=1 … test/automation-perf.int.test.ts`.

## Design System v1 (2026-09-28)

UI/UX normalization before Phase 11, on branch `ui-design-system-v1`. **Accepted 2026-09-28** (decision DS-v1); remaining UI debt moved to the product backlog. Docs: [design/FENWIRA_DESIGN_SYSTEM.md](design/FENWIRA_DESIGN_SYSTEM.md), [design/UX_PATTERNS.md](design/UX_PATTERNS.md), [design/UI_AUDIT.md](design/UI_AUDIT.md). No backend domain behavior changed; one read-only endpoint was added (`GET /contacts/:id/eligibility`, delegating to MessageEligibilityService).

| Check | Result |
| --- | --- |
| Tokens and contrast | v1 palette (danger `#DC2626`, info `#2563EB`, secondary, strong border, WhatsApp token, `-strong` text shades); every text pairing ≥ 4.5:1, pinned by `tokens.test.ts` |
| Shell | Modules-only sidebar with workspace status (WhatsApp, wallet), top bar (workspace, breadcrumb on section pages, search, help, notifications, account), module tabs |
| Shared components and patterns | SearchInput, FilterBar, MetricCard, PermissionState, ConnectionState, SectionHeader, Timeline, ModuleTabs, DetailDrawer, RowActions, DataTable toolbar/bulk/columns, ConfirmDialog impact; ListPage, DetailPage, BuilderPage, SettingsPage, DashboardLayout |
| Responsive | No horizontal page scroll at 1440 / 1024 / 768 / 375 (asserted by `e2e/visual.spec.ts`); phones open the flow builder in the Outline |
| Accessibility | axe WCAG 2.2 A/AA on every major page, drawer, palette and dialogs: 0 violations; Lighthouse accessibility 100 on dashboard, contacts, campaigns, templates, automations (list, new, builder), workspace settings and inbox |
| Regression | 353 integration (205 database, 10 API, 138 worker; perf probe skipped), 48 e2e (visual capture skipped), 258 unit; lint, typecheck, format, design tokens, dependency rules and the OpenAPI check pass |

Also found and fixed: `@socket.io/redis-emitter` left publish promises unhandled, so a publish timing out under load became an unhandled rejection (seen once in the full suite); the emitter now drops failed publishes (unit test reproduces it). The browser CORS rule for `If-Match` (Phase 10) is covered by e2e.

## Production-readiness backlog

| Priority | Item | Why |
| --- | --- | --- |
| **High** | Stale wallet-reservation recovery | Reservations whose message crashed or was abandoned must be found and safely released or settled from the message's final state, without double charging (keyed by message id, the same idempotent settle/release paths). |
| High | Real Meta round trips (MI1) | Business milestone; doesn't block development. |
| — | CI on a GitHub remote | No remote yet. |
