# AGENTS.md — Fenwira v2

Rules for every coding agent (human or AI) working in this repository. Read this file fully before writing code. If a rule here conflicts with a task prompt, this file wins. Ask before breaking it.

## What Fenwira is

Fenwira is a multi-tenant WhatsApp Business platform. It covers a shared inbox, contacts and consent, templates, campaigns, automation, billing and analytics, and connects to each customer's own Meta WhatsApp Business account.

Fenwira v2 is a **new application built from scratch**. No code, schema, docs or design is imported from any earlier Fenwira project. Everything is defined by this file and `docs/`.

- Roadmap and phase status: [docs/ROADMAP.md](docs/ROADMAP.md)
- Per-phase task prompts: [docs/prompts/](docs/prompts/)

## Stack (frozen, do not substitute)

| Area | Technology |
| --- | --- |
| Frontend | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui, wrapped in `packages/ui` |
| Flow builder | React Flow (`@xyflow/react`) |
| Backend | NestJS + TypeScript, modular monolith |
| API | REST under `/api/v1` |
| Realtime | WebSockets (NestJS gateway) |
| Database | PostgreSQL 16 + Prisma |
| Tenant isolation | PostgreSQL Row Level Security |
| Cache / queue | Redis + BullMQ |
| Workers | `apps/worker` (NestJS standalone app) |
| Storage | MinIO locally, S3 later (S3 API only) |
| WhatsApp | Meta Cloud API via `packages/whatsapp` |
| Email | Mailpit locally, SES later (SMTP only) |
| Runtime | Docker Compose |
| CI | GitHub Actions |
| Telemetry | OpenTelemetry-compatible structured logs and metrics |

Do not add AWS, Terraform or Kubernetes code. Keep everything portable: S3-compatible storage, SMTP mail, and config taken only from env vars.

## Repository layout

```text
apps/web          Next.js app
apps/api          NestJS HTTP + WebSocket
apps/worker       NestJS BullMQ consumers
packages/database Prisma schema, migrations, RLS SQL, tenant-scoped client
packages/ui       Design tokens + shared components (the only place UI primitives live)
packages/contracts Zod schemas + TS types shared by web/api/worker
packages/whatsapp Meta Cloud API client, webhook parser, signature verification
packages/queue    Queue names, job payload types, BullMQ factories
packages/config   Shared tsconfig/eslint/prettier + typed env loader
infrastructure/docker  server.Dockerfile (api|worker|migrate|dev), web.Dockerfile, postgres/init
docs/             Specs, ADRs, prompts
```

## Non-negotiable engineering rules

1. **Tenant isolation.** Every tenant-owned table has `tenant_id UUID NOT NULL`, RLS is enabled *and* forced, and the policy uses `nullif(current_setting('app.current_tenant_id', true), '')::uuid`. The app connects as a non-superuser role with `NOBYPASSRLS`. Every tenant-owned query goes through the tenant-scoped Prisma client, which runs `SET LOCAL` inside a transaction. The only exceptions are code paths documented in `docs/MULTI_TENANCY.md`.
2. **Every new tenant table ships with an RLS test** proving Tenant A cannot read, update or delete Tenant B's rows.
3. **One path to Meta.** Only `MessagingService` in `apps/api` enqueues outbound WhatsApp messages, and only the `whatsapp.outbound` worker calls the Meta API. The inbox, campaigns and automations never import `packages/whatsapp` send functions directly.
4. **Postgres is truth, Redis is execution.** Job state that matters (message status, campaign recipient status, automation step) is persisted in Postgres. Losing Redis must not lose business state.
5. **Idempotency.** Webhooks dedupe on Meta's IDs. Outbound jobs carry an idempotency key. Worker handlers must be safe to run twice.
6. **Outbox.** Domain events that trigger queue work are written to `outbox_events` in the same transaction as the state change, then relayed. Do not enqueue from inside a transaction that might roll back.
7. **Secrets.** Meta tokens and app secrets are encrypted at rest (AES-256-GCM with a key from env). They are never returned to the browser, never logged, and appear masked in the UI.
8. **Logging.** Use structured JSON logs with `correlationId` and `tenantId`. Never log message bodies, phone numbers, tokens or email addresses at info level or above.
9. **Contracts first.** Request and response shapes live in `packages/contracts` as Zod schemas and are used by both web and api.
10. **Server enforces.** RBAC, the 24h service window, human takeover and consent checks are enforced in the API or worker. UI checks are only for convenience.
11. **No scope creep.** Build only the current phase and only modules in the frozen navigation (`docs/ROADMAP.md`). Anything else needs a spec change first.

## Fenwira design system (mandatory)

```text
Primary                        #00A884   --color-primary
Primary Hover                  #008F70   --color-primary-hover
Success                        #25D366   --color-success
Structural Dark                #0F172A   --color-slate
Secondary Dark                 #1E293B   --color-slate-800
Muted                          #64748B   --color-muted
Slate 400 (idle edges, icons)  #94A3B8   --color-slate-400
Background                     #F8FAFC   --color-background
Surface                        #FFFFFF   --color-surface
Border                         #E2E8F0   --color-border
Soft Primary                   #E7FCE8   --color-primary-soft
Neutral Soft                   #F1F5F9   --color-neutral-soft
Success Soft                   #D1FAE5   --color-success-soft
Danger Soft                    #FEE2E2   --color-danger-soft
Warning                        #F59E0B   --color-warning
Danger                         #EF4444   --color-danger
Information / Human Takeover   #6366F1   --color-info
```

Rules:

1. `#00A884` is reserved for primary actions, active navigation, focus states and selected states.
2. `#25D366` represents operational success and live state.
3. `#F59E0B` represents warnings and pending state.
4. `#EF4444` represents errors, failures and destructive actions.
5. `#6366F1` represents system, information and manual takeover states.
6. The main application background is `#F8FAFC`.
7. Primary cards and surfaces are `#FFFFFF`.
8. Standard borders are `#E2E8F0`.
9. Main navigation is `#0F172A`.
10. Do not introduce colors without updating `docs/DESIGN_SYSTEM.md` and `packages/ui` tokens first.
11. Components use semantic tokens (`bg-primary`, `text-muted`, …). No hex values in `apps/web`. CI greps for them.
12. Do not use emerald as decoration.
13. Status is never shown by color alone. Pair it with a label or icon.

Feature code imports UI primitives from `@fenwira/ui` only. Do not create one-off buttons, badges, inputs or spacing values in feature folders. If a primitive is missing, add it to `packages/ui` first.

## Working a phase

1. Read the phase prompt in `docs/prompts/` and every doc it lists.
2. Do not look for, copy from or port any other Fenwira repository on this machine. If something is not specified in `docs/`, stop and ask. Don't guess.
3. Keep the system runnable at every commit: `docker compose up -d` works, and lint, typecheck and tests pass.
4. Update the docs the phase owns, and flip the phase's status in `docs/ROADMAP.md` only when every acceptance criterion passes.

## Commands

| Command | Does |
| --- | --- |
| `pnpm install` | Install (pnpm 10, Node 22 LTS; see `.nvmrc`) |
| `pnpm lint` | ESLint in every package, plus dependency-cruiser module boundaries |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | Via Turborepo (packages build first; ADR-0018) |
| `pnpm test:integration` | Real Postgres and Redis in the `fenwira-test` container, as `fenwira_app` |
| `docker compose up -d --wait` | The full platform (built images) |
| `pnpm dev` | Hot-reload variant (`docker-compose.dev.yml`) |
| `pnpm smoke` | Health checks plus the outbox round trip, against a running stack |

Dependency versions are pinned exactly. Upgrading a major needs its own PR (ADR-0019).

## Definition of done (every phase)

- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration` pass locally and in CI
- `docker compose up -d --wait` from a clean clone starts all services, they report healthy, and `pnpm smoke` passes
- New tenant tables have RLS plus cross-tenant tests
- New endpoints are in `docs/API_SPEC.md`, with Zod contracts and RBAC guards
- No hex colors outside `packages/ui`, and no secrets or PII in logs
