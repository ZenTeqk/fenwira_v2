# Phase 0 — Product & Architecture Freeze

**Goal:** remove all ambiguity before code. When this phase is done, a coding agent can build any later phase without making architectural decisions.

**Read:** `AGENTS.md`, `docs/ROADMAP.md`, `docs/DESIGN_SYSTEM.md`.

**This phase writes documents only. Do not write application code.**

## Deliverables

Create each file in `docs/`. Every doc starts with a *Scope*, *Decisions* and *Open questions* section. Keep open questions visible; don't paper over them.

| Doc | Must define |
| --- | --- |
| `PRODUCT.md` | Personas (owner, admin, manager, agent, viewer), problem, positioning, the frozen nav with a one-paragraph purpose per module |
| `PRD.md` | User stories plus acceptance criteria per module, grouped by phase |
| `ARCHITECTURE.md` | Modular monolith boundaries (NestJS modules and what each owns), web/api/worker responsibilities, request lifecycle, the event flow diagram, the outbox relay, and how modules communicate (in-process service calls or domain events, with no cross-module DB writes) |
| `DATABASE.md` | Every entity for phases 3–11 with its columns, types, indexes, unique constraints and FKs; which tables are tenant-owned; naming conventions (snake_case tables, `id uuid v7`, `created_at`/`updated_at`, soft delete where needed) |
| `MULTI_TENANCY.md` | The RLS policy template, GUC names (`app.current_tenant_id`, `app.current_user_id`), DB roles (owner vs `fenwira_app` NOBYPASSRLS), how the Prisma client binds tenant context, the *complete* list of cross-tenant code paths (login tenant list, webhook tenant resolution, worker fan-out) and how each one is kept safe |
| `API_SPEC.md` | Conventions: `/api/v1`, error envelope, pagination (cursor), filtering, idempotency-key header, rate-limit headers, auth cookies, `X-Tenant-Id`. Per-phase endpoint tables are appended as phases ship. |
| `META_INTEGRATION.md` | Embedded Signup flow, token exchange, required Meta app permissions, webhook subscription, the error-code → retryable/permanent mapping, rate/tier limits, the 24h service window rules |
| `MESSAGING_ENGINE.md` | `MessagingService` API, the message state machine with allowed transitions, queue names and payloads, retry/backoff/DLQ policy, idempotency keys, status-ordering rules (never regress from READ to DELIVERED) |
| `CONTACTS_AND_CONSENT.md` | Contact model, E.164 normalization, dedupe rules, the segment filter DSL, the consent model and opt-out keyword handling |
| `INBOX.md` | Conversation states, assignment rules, service window, takeover states, concurrency/collision rules, realtime event names |
| `TEMPLATE_ENGINE.md` | Template components, validation rules, submission and approval lifecycle, versioning |
| `CAMPAIGN_ENGINE.md` | Audience snapshot, recipient states, batching, rate limiting, stop/resume/retry semantics |
| `AUTOMATION_ENGINE.md` | Node catalog with config schemas, the graph JSON format, versioning, execution semantics, determinism rules |
| `BILLING.md` | Plans, the entitlements catalog, the wallet ledger (double-entry or append-only), usage event pricing |
| `SECURITY.md` | Auth/session design, password and 2FA policy, secret encryption (AES-256-GCM, key rotation), the PII logging policy, the rate-limit policy, a threat model |
| `OBSERVABILITY.md` | Log schema, correlation IDs, the metrics list, health checks, the alert list (Phase 12) |
| `DESIGN_SYSTEM.md` | Already exists. Review it and add anything missing. |
| `DEPLOYMENT.md` | Docker Compose topology, env vars, volumes, ports, the backup/restore procedure, the later path to production (described only) |

### ADRs

Create `docs/adr/NNNN-title.md` (context → decision → consequences → alternatives rejected) for: modular monolith, Next.js, NestJS, PostgreSQL, RLS, Redis, BullMQ, Docker Compose, React Flow, WebSockets, tenant architecture, event architecture, outbox pattern, idempotency strategy, pnpm + Turborepo monorepo, Prisma (including how RLS and Prisma coexist), and UUIDv7 ids.

## Acceptance criteria

- [ ] All 18 docs and 17 ADRs exist and are internally consistent (entity names, state names and queue names match everywhere).
- [ ] `DATABASE.md` covers every entity named in the roadmap for phases 3–11.
- [ ] Every open question is listed in one table at the bottom of `PRODUCT.md`, with an owner.
- [ ] A reviewer can answer "where does X live, and who is allowed to write it?" for any entity from the docs alone.
