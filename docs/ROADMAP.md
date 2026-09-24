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
| 4 | Meta onboarding + WhatsApp account management | ⬜ | [PHASE_04](prompts/PHASE_04_META_ONBOARDING.md) |
| 5 | Webhook + messaging engine | ⬜ | [PHASE_05](prompts/PHASE_05_MESSAGING_ENGINE.md) |
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
