# Deployment

## Scope

The Docker Compose topology (the only deployment target in v2), images, environment variables, ports, volumes, migrations, the development and test variants, local Meta webhook tunnelling, backup and restore, and the later path to production (described only; nothing is built for it).

## Decisions

Docker Compose is the current deployment target (decision DP1). The production AWS architecture is finalized during production-readiness/migration work, and nothing in the code depends on Compose beyond environment variables.

### Quick start

```bash
git clone … && cd fenwira_v2
cp .env.example .env          # or: pnpm setup:env  (same file, with random secrets)
docker compose up -d --wait   # builds images on first run
pnpm smoke                    # optional: health + outbox round-trip check
```

The web app is at http://localhost:3000, the API at http://localhost:4000, Mailpit at http://localhost:8025 and the MinIO console at http://localhost:9001.

### Services (`docker-compose.yml`)

| Service | Image / build | Host port | Internal port | Healthcheck | Starts after |
| --- | --- | --- | --- | --- | --- |
| `fenwira-postgres` | `postgres:16-alpine` | **none** | 5432 | `pg_isready` | |
| `fenwira-redis` | `redis:7-alpine` (`--appendonly yes --maxmemory-policy noeviction`) | **none** | 6379 | `redis-cli ping` | |
| `fenwira-minio` | `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` | 9000 (S3 API, needed for presigned URLs), 9001 (console) | 9000/9001 | `curl /minio/health/live` | |
| `fenwira-minio-init` | same MinIO image, `mc` (one-shot) | | | exits 0 | minio healthy |
| `fenwira-mailpit` | `axllent/mailpit:v1.29` | 8025 (UI) | 1025 (SMTP), 8025 | `mailpit readyz` | |
| `fenwira-migrate` | `server.Dockerfile` target `migrate` (one-shot) | | | exits 0 | postgres healthy |
| `fenwira-api` | `server.Dockerfile` target `api` | 4000 | 4000 | `/health/ready` | postgres, redis healthy; migrate and minio-init completed |
| `fenwira-worker` | `server.Dockerfile` target `worker` | **none** | 4100 (health) | `/health/ready` | as api |
| `fenwira-web` | `web.Dockerfile` target `runtime` | 3000 | 3000 | `/api/health` | api healthy |
| `fenwira-test` (profile `test`) | `server.Dockerfile` target `dev` | none | | | postgres, redis healthy |

- Network: a single bridge network, `fenwira-network`.
- Volumes: `fenwira-postgres-data`, `fenwira-redis-data`, `fenwira-minio-data` and `fenwira-mailpit-data`.
- MinIO buckets (created by `fenwira-minio-init`): `fenwira-media`, `fenwira-imports` (7-day expiry), `fenwira-exports` (7-day expiry) and `fenwira-uploads`.
- Docker Hub `minio/minio` no longer receives community images, so the MinIO images come from `quay.io`. **Known blocker (2026-09-29):** `quay.io/minio/minio` itself now also refuses anonymous pulls (MinIO discontinued free container distribution); the only remaining public path, `quay.io/minio/aistor/minio`, pulls but refuses to create buckets without a paid/free-tier AIStor license. This blocks `docker compose up` and CI until a license is obtained or MinIO is replaced — see the comment on `fenwira-minio` in `docker-compose.yml` for the two remediation paths.
- Postgres and Redis publish no host ports. For a DB shell, use `docker compose exec fenwira-postgres psql -U postgres -d fenwira`.

### Images (`infrastructure/docker/`)

| File | Targets | Notes |
| --- | --- | --- |
| `server.Dockerfile` | `api`, `worker`, `migrate`, `dev` | One pruned build (`turbo prune @fenwira/api @fenwira/worker --docker`) shared by all targets. Runtime images have production dependencies only, run as the `node` user, and include OpenSSL for Prisma. `dev` is the full workspace with dev dependencies (hot reload and the test runner). |
| `web.Dockerfile` | `runtime`, `dev` | Next.js `output: 'standalone'`, runs as `node`. `NEXT_PUBLIC_API_URL` is a **build argument** (inlined at build time). |
| `postgres/init/01-roles.sh` | | Runs once, on an empty data volume |

Base image: `node:22-bookworm-slim`. The pnpm version is pinned in the Dockerfiles, and must match `packageManager` in `package.json`.

### Variants

| Command | What runs |
| --- | --- |
| `docker compose up -d` | Production-like built images (the default) |
| `pnpm dev` (= `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`) | Hot reload. api and worker run `tsc --watch` plus `node --watch`; web runs `next dev`. Only `src/` directories are bind-mounted (read-only), so host `node_modules` never enter the Linux containers. `.env.development` is layered on top of `.env`. |
| `pnpm test:integration` (= `docker compose --profile test run --rm --build fenwira-test`) | Migrates `fenwira_test`, then runs every `test:integration` task as `fenwira_app` against Postgres and Redis db 1 |
| `pnpm smoke` | `scripts/smoke.sh` against a running stack: readiness, the web dashboard, and the `system.ping` round trip |
| `pnpm --filter @fenwira/web test:e2e` | Playwright (axe WCAG 2.1 AA, responsive, keyboard) against the running stack at `E2E_BASE_URL` (default `http://localhost:3000`). Needs `ENABLE_UI_GALLERY=true`. |

### Postgres initialization

`infrastructure/docker/postgres/init/01-roles.sh` runs once as the `postgres` superuser. It creates:

- `fenwira_owner` (LOGIN, not superuser): owns the schema and runs migrations
- `fenwira_app` (LOGIN, `NOSUPERUSER NOBYPASSRLS`): runtime DML only
- `fenwira_system` (NOLOGIN, `BYPASSRLS`): owns the `system.*` functions. `fenwira_owner` is a member so it can assign that ownership.
- the databases `fenwira` and `fenwira_test`, owned by `fenwira_owner`, each with the `citext` and `pg_trgm` extensions and the `system` schema

Passwords come from `FENWIRA_OWNER_PASSWORD` and `FENWIRA_APP_PASSWORD`. Because the script only runs on an empty volume, changing those passwords later needs `docker compose down -v` (development) or a manual `ALTER ROLE`.

The `fenwira-migrate` one-shot (`node packages/database/dist/cli/migrate.js`, as `fenwira_owner`) runs these steps, and the api and worker don't start unless it succeeds:

1. `prisma migrate deploy`
2. `packages/database/sql/post-migrate.sql`, which is idempotent: RLS policies, grants, triggers and the `system.*` functions
3. The RLS coverage check (every table with a `tenant_id` column must have forced RLS plus the `tenant_isolation` policy). A violation fails the migrate step.

### Environment variables

`.env.example` (committed) documents every variable and ships local-only defaults, so `cp .env.example .env` works as-is. `.env` is git-ignored. `.env.test` and `.env.development` are committed and contain no secrets. Connection URLs are **assembled by `docker-compose.yml`** from the passwords, so they never need editing by hand.

| Variable | Default (`.env.example`) | Used by | Phase |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` (`production` enforces deployment guardrails: JWT keys, secure cookies, ping off) | api, worker | 1 |
| `APP_VERSION` | `dev` (CI sets the git SHA) | api, worker | 1 |
| `LOG_LEVEL` | `info` | api, worker | 1 |
| `WEB_PORT` / `API_PORT` / `MINIO_API_PORT` / `MINIO_CONSOLE_PORT` / `MAILPIT_UI_PORT` | 3000 / 4000 / 9000 / 9001 / 8025 | compose | 1 |
| `WEB_ORIGIN` | `http://localhost:3000` | api (CORS, and the CSRF origin check from Phase 3) | 1 |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api/v1` | web **build arg** | 1 |
| `API_INTERNAL_URL` | set by compose: `http://fenwira-api:4000` | web (server side) | 1 |
| `POSTGRES_PASSWORD` | local value | postgres init | 1 |
| `FENWIRA_OWNER_PASSWORD` | local value | postgres init, migrate URL | 1 |
| `FENWIRA_APP_PASSWORD` | local value | postgres init, api/worker URL | 1 |
| `DATABASE_URL` | assembled: `postgresql://fenwira_app:…@fenwira-postgres:5432/fenwira` | api, worker | 1 |
| `MIGRATION_DATABASE_URL` | assembled: `postgresql://fenwira_owner:…@fenwira-postgres:5432/fenwira` | migrate | 1 |
| `DB_POOL_SIZE` | `10` | api, worker | 1 |
| `REDIS_URL` | assembled: `redis://fenwira-redis:6379/0` | api, worker | 1 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | local values | minio, minio-init (api and worker from Phase 5) | 1 |
| `PORT` | `4000` | api | 1 |
| `WORKER_HEALTH_PORT` | `4100` | worker (internal only) | 1 |
| `OUTBOX_POLL_INTERVAL_MS` | `250` | worker (outbox relay fallback poll) | 1 |
| `SYSTEM_PING_ENABLED` | `true` locally, **must be `false` in production** | api (`POST /api/v1/system/ping`) | 1 |
| `ENABLE_UI_GALLERY` | `true` locally (runtime) | web: serves `/dev/ui`, which the e2e accessibility suite needs. Off in production. | 2 |
| `NEXT_PUBLIC_NAV_PREVIEW` | `false` (`true` in `.env.development`) | web **build arg**: shows navigation for unshipped phases, with placeholder pages. Development only. | 2 |
| `S3_ENDPOINT` (internal), `S3_PUBLIC_ENDPOINT` (what browsers use for presigned URLs, `http://localhost:9000` locally), `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_BUCKET_MEDIA` (`fenwira-media`), `S3_BUCKET_UPLOADS` | compose sets the internal endpoint | api, worker | 5 |
| `WHATSAPP_OUTBOUND_BACKOFF_MS` | `1000` | worker | 5 |
| `METRICS_PORT` | `9464` (not published) | api | 5 |
| `SMTP_URL` | assembled by compose: `smtp://fenwira-mailpit:1025` | worker | 3 |
| `MAIL_FROM` | `Fenwira <no-reply@fenwira.local>` | worker | 3 |
| `WEB_ORIGIN` (worker) | `http://localhost:3000` | worker: links in emails | 3 |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | empty = generated per boot (non-production); `pnpm setup:env` writes real base64 PEM keys | api | 3 |
| `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_ID` | local-only dev key `k1:…`, `k1`; `pnpm setup:env` generates a random one | api | 3 |
| `COOKIE_SECURE` | `false` locally (**must be true in production**) | api | 3 |
| `COOKIE_DOMAIN` | unset (localhost); e.g. `.fenwira.com` for sibling subdomains | api | 3 |
| `TRUST_PROXY` | `0` (socket IP) | api: reverse-proxy hops trusted for `X-Forwarded-For`. Set to the real hop count behind a proxy; never >0 when the API is exposed directly. | 3 |
| `META_APP_ID`, `META_APP_SECRET` | empty (Embedded Signup off) | api, worker | 4 (Phase 8: `META_APP_ID` also addresses the resumable upload of template header samples) |
| `META_ES_CONFIG_ID`, `META_WEBHOOK_VERIFY_TOKEN` | empty | api | 4 |
| `META_GRAPH_API_VERSION`, `META_GRAPH_BASE_URL` | `v23.0`, `https://graph.facebook.com` (`.env.example`: the local mock) | api, worker | 4 |
| `WHATSAPP_DEV_CONNECT` | `false` (refused in production) | api | 4 |
| `WHATSAPP_SYNC_INTERVAL_HOURS` | `6` | worker | 4 |
| `BILLING_ENFORCED` | `false` | api, worker | 9 (platform switch; tenants' billing modes decide, P9-D1. Top up: `pnpm --filter @fenwira/worker wallet:credit -- --tenant <id> --amount <₹>`; mode: `billing:mode -- --tenant <id> --mode PREPAID`) |
| `TRIAL_CREDIT_MINOR` | `0` | api, worker | 9 (credit granted once to a new TRIAL tenant's wallet) |
| `BILLING_LOW_BALANCE_THRESHOLD_MINOR` | `10000` (₹100, P11-D12) | api, worker | 11 (`billing.low_balance_threshold`) |
| `BILLING_SUPPORT_EMAIL`, `BILLING_SUPPORT_URL` | unset (fallback text) | api, worker | 11 (billing contact, P11-D20) |
| `BILLING_RESERVATION_GRACE_MINUTES` | `360` | worker | 11 (stale-reservation recovery) |
| `ANALYTICS_SETTLE_SECONDS` | `20` | worker | 11 (analytics recompute marks wait this long; tests use 0) |
| `OPS_ALERT_EMAIL` | unset (alerts only logged) | worker | 11 (operational alerts, decision O1) |
| `CAMPAIGN_BATCH_SIZE` | `50` | worker | 9 |
| `PUBLIC_API_URL` | `http://localhost:4000` | api | 4 |
| `COMPOSE_PROFILES`, `META_MOCK_PORT` | `meta-mock`, `4200` (local development only) | compose | 4 |
| `API_KEY_PEPPER` | | api | 11 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | | all | 12 |

Each app validates its variables at boot with the Zod schemas in `packages/config/src/env.ts`. A missing or invalid variable stops the process with one message listing every problem.

### Simulated Meta locally (Phase 4)

Without a Meta app, local development uses `fenwira-meta-mock`, a small simulated Graph API from `@fenwira/whatsapp/testing` (profile `meta-mock`, published on `127.0.0.1:4200` only). `.env.example` turns it on with `COMPOSE_PROFILES=meta-mock`, `META_GRAPH_BASE_URL=http://fenwira-meta-mock:4200` and `WHATSAPP_DEV_CONNECT=true`. It starts with one demo account (WABA `100000000000001`, phone number ID `200000000000001`). In Settings → WhatsApp → **Developer connect**, use those IDs and the token `mock-dev:100000000000001:local`. Since Phase 5 the mock posts signed status webhooks to the api (`META_APP_SECRET` is shared between the two locally), so a test message goes queued → sent → delivered → read on screen. To simulate a customer writing in: `curl -X POST 127.0.0.1:4200/__mock/inbound -d '{"phoneNumberId":"200000000000001","from":"919876543210","text":"Hi"}'`. Tests seed more accounts through `POST /__mock/seed`. To use real Meta, set the Meta variables, point `META_GRAPH_BASE_URL` at `https://graph.facebook.com`, and remove the profile.

### Receiving Meta webhooks locally (Phase 4+)

1. `cloudflared tunnel --url http://localhost:4000` (or ngrok) gives a public HTTPS URL.
2. Set `PUBLIC_API_URL` to it. In the Meta app dashboard, set the webhook callback to `{PUBLIC_API_URL}/webhooks/whatsapp` and the verify token to `META_WEBHOOK_VERIFY_TOKEN`.
3. Without Meta, `pnpm webhook:simulate <fixture>` (Phase 5) posts signed fixture payloads to the local API.

### Backup and restore (verified in Phase 12)

- **Postgres:** a nightly `pg_dump -Fc` to `./backups/postgres/`, keeping 14 days.
- **MinIO:** a nightly `mc mirror` of all buckets to `./backups/minio/`.
- **Restore:** `scripts/restore.sh <date>` does `down`, drops the volumes, brings up postgres and minio, runs `pg_restore`, mirrors the files back, runs migrate, brings up everything, then runs the smoke test.
- Redis is **not** backed up. By design it holds no business truth.

### Path to production (later; documented only)

- The same images run on any container host. Postgres goes to a managed Postgres 16 (create the three roles with the same attributes), Redis to managed Redis (`noeviction`), MinIO to S3, Mailpit to SES SMTP, and the tunnel to a real TLS ingress.
- api and worker are stateless and scale horizontally. The Socket.IO Redis adapter handles fan-out, and BullMQ plus `SKIP LOCKED` handle work distribution.
- Production must set `SYSTEM_PING_ENABLED=false`, `COOKIE_SECURE=true` and real secrets, with `WEB_ORIGIN` and the API on the same site.
- Nothing in the code assumes Docker Compose hostnames except through env.

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.
