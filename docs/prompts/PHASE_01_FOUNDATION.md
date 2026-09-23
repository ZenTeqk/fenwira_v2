# Phase 1 — Monorepo, Docker Compose & Engineering Foundation

**Goal:** from a fresh clone, `cp .env.example .env && docker compose up -d` starts the whole platform and every service reports healthy.

**Read:** `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/OBSERVABILITY.md`, ADRs.

## Build

1. **Monorepo:** pnpm workspaces + Turborepo, Node 22 LTS, TypeScript strict. Create the `AGENTS.md` layout: `apps/{web,api,worker}` and `packages/{database,ui,contracts,whatsapp,queue,config}`, each with a real, minimal entry point.
2. **packages/config:** shared `tsconfig`, ESLint (flat config), Prettier, and a Zod-validated env loader. Apps crash at boot, with a clear message, if an env var is missing.
3. **apps/api:** NestJS app with global prefix `/api/v1`, pino JSON logger, correlation-id middleware (accept or generate `X-Correlation-Id` and echo it back), global exception filter with the error envelope from `API_SPEC.md`, and Helmet and CORS settings for the web origin.
4. **Health:** `GET /health`, `/health/live` and `/health/ready` on the api and the worker. Readiness checks Postgres (`SELECT 1`), Redis (`PING`) and BullMQ (queue client connected). Web gets `/api/health`.
5. **packages/database:** Prisma with an initial migration, plus an idempotent `sql/post-migrate.sql` (grants now, RLS helpers and `system` schema functions later). The Postgres init SQL creates `fenwira_owner`, `fenwira_app` (`NOSUPERUSER NOBYPASSRLS`) and `fenwira_system` (`NOLOGIN BYPASSRLS`), per `DEPLOYMENT.md`. Migrations run as `fenwira_owner`; apps connect as `fenwira_app`.
6. **packages/queue:** queue-name constants (`whatsapp.inbound`, `whatsapp.outbound`, `whatsapp.status`) and a typed BullMQ factory. The worker registers a no-op `system.ping` processor that proves end-to-end queue flow.
7. **apps/web:** Next.js App Router with a placeholder page that calls the api health endpoint.
8. **Docker:** multi-stage Dockerfiles in `infrastructure/docker/`, non-root user, and dev targets with hot reload through bind mounts.

`docker-compose.yml` services: `fenwira-web`, `fenwira-api`, `fenwira-worker`, `fenwira-postgres` (16), `fenwira-redis` (7, AOF on), `fenwira-minio` (plus a one-shot bucket-init container), `fenwira-mailpit`. They share one network, `fenwira-network`, with named volumes. **Host ports are exactly as in `DEPLOYMENT.md`:** web 3000, api 4000, MinIO 9000 (S3 API, for presigned URLs) and 9001 (console), Mailpit UI 8025. Postgres and Redis publish none. Every service has a `healthcheck`, and `depends_on` uses `condition: service_healthy`. The `fenwira-migrate` and `fenwira-minio-init` one-shots must complete before api and worker start (`service_completed_successfully`).

9. **Env files:** `.env.example` (committed, with safe placeholders and a comment for every var), `.env.development` and `.env.test`. Real `.env*` files are git-ignored.
10. **CI (`.github/workflows/ci.yml`):** checkout → pnpm install (cached) → lint → typecheck → unit tests → integration tests (Postgres and Redis service containers, with the app role created) → build → docker build (all three apps) → security scan (`pnpm audit --prod` + Trivy image scan + gitleaks). Add Dependabot config.
11. **Testing setup:** Vitest everywhere (Nest via `unplugin-swc`), Playwright for E2E (skeleton only), and an integration harness that uses the compose Postgres/Redis under `.env.test`, connecting as `fenwira_app`.
12. **Boundaries:** dependency-cruiser config enforcing the module rules in `ARCHITECTURE.md` (empty modules for now; the rules still run in CI).

## Acceptance criteria

- [ ] A fresh clone, then `cp .env.example .env && docker compose up -d`, gives all 7 services healthy within 3 minutes.
- [ ] `curl localhost:<api>/health/ready` returns 200 and lists postgres, redis and queue as `up`. Stopping Redis makes it return 503.
- [ ] `psql` from the host to Postgres fails (no published port).
- [ ] The api connects as `fenwira_app`, and `SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user` returns false.
- [ ] Enqueuing `system.ping` from the api (through an outbox row and the relay, proving ADR-0013 end to end) is processed by the worker, and the correlation id appears in both logs.
- [ ] CI is green on a PR. A lint error, type error or failing test fails the build.
- [ ] `docs/DEPLOYMENT.md` documents every env var and port.
