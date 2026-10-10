# Non-Docker runtime audit

9 October 2026, at commit `9471992` plus the Phase 1 working changes. Source of truth: the files cited below, not a generic NestJS/Next.js layout.

## Repository shape

| Area | Finding | Evidence |
| --- | --- | --- |
| Monorepo | pnpm 10.34.5 workspace + Turborepo; apps `web`, `api`, `worker`; packages `config`, `contracts`, `database`, `queue`, `ui`, `whatsapp` | `pnpm-workspace.yaml`, `package.json` (`packageManager`), `turbo.json` |
| Node.js | 22 (LTS) | `.nvmrc`, `server.Dockerfile` (`node:22-bookworm-slim`) |
| Next.js | App Router, `output: 'standalone'` already configured, `outputFileTracingRoot` = monorepo root, so the entry point is `apps/web/.next/standalone/apps/web/server.js`. No `middleware.ts`, no server actions. Server reads only `API_INTERNAL_URL` and `WEB_ORIGIN`; `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_NAV_PREVIEW` are build-time | `apps/web/next.config.ts`, `apps/web/lib/env.ts`, `web.Dockerfile` |
| API | NestJS 11 + Express, `bootstrap.ts` (helmet, `trust proxy`, raw body for the Meta HMAC, global prefix `/api/v1`, `enableShutdownHooks()`), `main.ts` listens on `PORT` and (new) `HOST` | `apps/api/src/{main,bootstrap}.ts` |
| Worker | Separate Nest app (`apps/worker/src/main.ts`), HTTP only for `/health*` on `WORKER_HEALTH_PORT`. Processors are defined in `apps/api/src/modules/**` but registered only through `forWorker(...)` modules in `apps/worker/src/worker.module.ts` → `WorkerRuntimeModule`. The API process never imports `WorkerRuntimeModule`: no queue consumers run in the API | `worker.module.ts`, `apps/api/src/core/queue/worker-runtime.ts` |
| BullMQ | 27 queues (`packages/queue/src/names.ts`); 25 processors, one `Worker` each; fixed per-processor concurrency (sum ≈ 157); producers in the API enqueue via the transactional outbox, relayed by the worker (`PlatformWorkerModule`, polls every `OUTBOX_POLL_INTERVAL_MS`) | `queue-processor.ts`, `outbox-relay.service.ts` |
| Recurring jobs | Registered with `upsertJobScheduler` (idempotent): inbox maintenance 60 s, campaign due/active 30 s/60 s, automation recovery 60 s, billing (reservations 5 min, subscriptions 15 min, ledger 02:15 UTC), template sync fan-out, WhatsApp number sync, webhook delivery retention 03:30 UTC, analytics rollups and retention (8 processors). No cron outside BullMQ; no separate scheduler process needed | `*-processor.ts` (`upsertJobScheduler`) |
| Redis | ioredis via `@fenwira/queue` (`createRedisConnection`): BullMQ queues/workers, Socket.IO Redis adapter and realtime emitter, rate limits (`rate-limit.service.ts`), sessions (`session.service.ts`), Inbox compose locks and presence, platform-operator auth state, system ping. Requires `maxmemory-policy noeviction` | `packages/queue/src`, `apps/api/src/modules/realtime/redis-io.adapter.ts`, `docker-compose.yml` |
| Prisma | Prisma 6.19.3, `prisma-client-js` with the Rust library engine; `pg` 8.23 for `post-migrate.sql`. Pool size via `connection_limit` (`DB_POOL_SIZE`). Migrations: `packages/database/dist/cli/migrate.js` = `prisma migrate deploy` → `post-migrate.sql` → RLS check → RBAC and plan seeds, as `fenwira_owner`. Never run by API or worker | `packages/database/src/{client.ts,cli/migrate.ts}` |
| Storage | `StorageService` (AWS SDK v3 `S3Client`, internal and public endpoints), presigned PUT/GET; buckets media/uploads/imports/exports. No multipart upload reaches the API | `apps/api/src/core/storage/storage.service.ts` |
| Email | Nodemailer from `SMTP_URL` (worker only); outbox-driven | `apps/api/src/modules/platform/email/mailer.ts` |
| Logging | nestjs-pino, JSON to stdout, central redaction list, correlation and job IDs via `requestContext` | `apps/api/src/core/logging/logger.ts`, `worker-runtime.ts` |
| Health | `/health/live` (static), `/health/ready` and `/health` (indicators: Postgres, Redis, storage, outbox relay, processors) on API and worker; web `/api/health` | `apps/api/src/core/health/*`, `apps/worker/src/processors.health.ts` |
| Metrics | Optional Prometheus listener on `METRICS_PORT` (API) | `metrics.service.ts` |
| Realtime | Socket.IO at path `/ws` on the API, Redis adapter | `redis-io.adapter.ts`, `realtime.gateway.ts` |
| Tests / CI | Vitest unit tests per package; integration tests in the `fenwira-test` Compose profile; Playwright e2e against the stack | `package.json` scripts, `docker-compose.yml` |

## Compose services

| Service | Purpose | Start command | Depends on | Key environment | Volumes | Ports | Health check | Production equivalent | Change required | Risks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `fenwira-postgres` | Postgres 16; `01-roles.sh` creates roles/DBs/extensions on first start | image entrypoint | — | `POSTGRES_PASSWORD`, `FENWIRA_OWNER_PASSWORD`, `FENWIRA_APP_PASSWORD` | `fenwira-postgres-data` | none published | `pg_isready` | Amazon RDS PostgreSQL 16; one-time `deploy/sql/bootstrap-roles.sql` | TLS URL parameters; bootstrap without superuser | RDS must allow `BYPASSRLS` for `fenwira_system` (verify first); TLS must be strictly verified (see PRODUCTION_RUNTIME) |
| `fenwira-redis` | Queues, realtime adapter, rate limits | `redis-server --appendonly yes --maxmemory-policy noeviction` | — | — | `fenwira-redis-data` | none | `redis-cli ping` | Ubuntu `redis-server` + `deploy/redis/fenwira-redis.conf` (loopback, AOF, noeviction, `maxmemory`) | none in code | full memory → writes refused (jobs/realtime fail loudly, not silently) |
| `fenwira-minio` / `-init` | S3-compatible storage, bucket creation + 7-day ILM on imports/exports | `minio server`, `mc` | — | `S3_ACCESS_KEY_ID/SECRET` | `fenwira-minio-data` | 9000, 9001 | `/minio/health/live` | Amazon S3, private buckets, lifecycle rules, CORS for presigned browser PUT/GET | static keys made optional → instance role (done) | bucket CORS/lifecycle are infrastructure (Phase 2) |
| `fenwira-mailpit` | Captures email locally | image | — | — | `fenwira-mailpit-data` | 8025 | `readyz` | Amazon SES SMTP (`smtps://…:465`) | none | SES sandbox until production access |
| `fenwira-migrate` | One-shot migrations | `node packages/database/dist/cli/migrate.js` | postgres | `MIGRATION_DATABASE_URL` | — | — | exit 0 | `deploy/scripts/migrate.sh` before switching a release | none | run before restarting services; never automatic |
| `fenwira-api` | REST, Socket.IO, webhooks | `node --enable-source-maps apps/api/dist/main.js` | postgres, redis, migrate, minio-init | see ENVIRONMENT_VARIABLES | — | 4000 | `/health/ready` | systemd `fenwira-api.service` behind nginx, bound to 127.0.0.1 | `HOST` (done); readiness no longer echoes driver errors (done) | `TRUST_PROXY` must equal the proxy hop count (1) |
| `fenwira-worker` | All BullMQ processors, schedulers, outbox relay, email | `node --enable-source-maps apps/worker/dist/main.js` | as API | + `SMTP_URL`, `MAIL_FROM` | — | 4100 (internal) | `/health/ready` | systemd `fenwira-worker.service`, health on 127.0.0.1:4100 | `WORKER_HEALTH_HOST` (done) | memory with ~157 concurrent job slots (RESOURCE_BUDGET) |
| `fenwira-web` | Next.js standalone | `node apps/web/server.js` | api | `API_INTERNAL_URL`, `WEB_ORIGIN`, build args `NEXT_PUBLIC_*` | — | 3000 | `/api/health` | systemd `fenwira-web.service`, `HOSTNAME=127.0.0.1` | none in code; build copies `.next/static` + `public` | `NEXT_PUBLIC_API_URL` is compiled in: rebuild when it changes |
| `fenwira-meta-mock` | Simulated Graph API (profile) | `node packages/whatsapp/dist/testing/server.js` | — | `META_MOCK_WEBHOOK_URL` | — | 127.0.0.1:4200 | `/__mock/health` | none (real Graph API) | none | production validation refuses `WHATSAPP_DEV_CONNECT` |
| `fenwira-test` | Integration tests (profile) | `db:deploy` + `test:integration` | postgres, redis, mailpit, minio | `.env.test` | — | — | — | CI only | none | — |

## Findings that required changes

1. **Fixed bind addresses** (approved P1). API (`0.0.0.0`), worker health (`0.0.0.0`) and metrics (`0.0.0.0`) could not be restricted to loopback. Added `HOST`, `WORKER_HEALTH_HOST`, `METRICS_HOST` (default `0.0.0.0`, so Compose is unchanged).
2. **S3 static keys were mandatory** (approved P2), preventing EC2 instance-role credentials. Keys are now optional as a pair; unset means the AWS SDK default credential chain. Pair validation added.
3. **Readiness exposed dependency error text** (approved P3) (Prisma/ioredis messages name hosts and ports) on unauthenticated endpoints. It now returns `"unavailable"`; the cause goes to the service log.
4. **Prisma engine portability (no code change).** Prisma generates only the build machine's query engine. Decision: releases are built on Ubuntu Linux x86_64 (`build-release.sh` refuses other platforms); `binaryTargets` is unchanged. `verify-build.sh` checks the `debian-openssl-3.0.x` engine is present.
5. **Database TLS (found by testing).** Prisma ignores `sslrootcert` and, without `sslaccept=strict`, encrypts but accepts any certificate; node-postgres ignores `sslaccept`. Verified TLS for both requires `sslmode=require&sslaccept=strict&sslcert=<CA>&sslrootcert=<CA>`. Documented and enforced by `deploy/scripts/check-env.sh`.

## Not changed (already suitable)

Standalone Next.js output; separate worker bootstrap with graceful `Worker.close()`; idempotent schedulers; outbox relay; structured logging with redaction; migrations as an explicit command; SMTP URL abstraction; environment validation (`packages/config`).
