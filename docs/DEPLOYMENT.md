# Deployment

## Scope

The Docker Compose topology (the only deployment target in v2), environment variables, ports, volumes, migrations, local Meta webhook tunnelling, backup and restore, and the later path to production (described only; nothing is built for it).

## Decisions

### Services

| Service | Image / build | Host port | Internal port | Healthcheck | Depends on (healthy) |
| --- | --- | --- | --- | --- | --- |
| `fenwira-postgres` | `postgres:16-alpine` | **none** | 5432 | `pg_isready` | |
| `fenwira-redis` | `redis:7-alpine` (`--appendonly yes --maxmemory-policy noeviction`) | **none** | 6379 | `redis-cli ping` | |
| `fenwira-minio` | `minio/minio` | 9000 (S3 API, needed for presigned URLs), 9001 (console) | 9000/9001 | `mc ready local` | |
| `fenwira-minio-init` | `minio/mc` (one-shot) | | | exits 0 | minio |
| `fenwira-mailpit` | `axllent/mailpit` | 8025 (UI) | 1025 (SMTP), 8025 | HTTP `/livez` | |
| `fenwira-migrate` | `infrastructure/docker/api.Dockerfile` target `migrate` (one-shot) | | | exits 0 | postgres |
| `fenwira-api` | `infrastructure/docker/api.Dockerfile` | 4000 | 4000 | `/health/ready` | postgres, redis, minio, migrate (completed) |
| `fenwira-worker` | `infrastructure/docker/worker.Dockerfile` | **none** | 4100 (health) | `/health/ready` | postgres, redis, minio, migrate (completed) |
| `fenwira-web` | `infrastructure/docker/web.Dockerfile` | 3000 | 3000 | `/api/health` | api |

- Network: a single bridge network, `fenwira-network`.
- Volumes: `fenwira-postgres-data`, `fenwira-redis-data`, `fenwira-minio-data` and `fenwira-mailpit-data`.
- Profiles: default (the above), `observability` (Phase 12: `fenwira-otel`, `fenwira-prometheus`, `fenwira-grafana`) and `test` (`meta-mock`).
- Dev mode: `docker-compose.override.yml` (committed) bind-mounts the source and runs `pnpm dev` targets with hot reload. Production-like mode: `docker compose -f docker-compose.yml up` uses the built targets.
- Postgres and Redis publish no host ports. For DB access in dev, use `docker compose exec fenwira-postgres psql -U fenwira_owner fenwira`.

### Postgres initialization

`infrastructure/docker/postgres/init/01-roles.sql` (runs once, as `postgres`):

- Create `fenwira_owner` (LOGIN), `fenwira_app` (LOGIN NOSUPERUSER NOBYPASSRLS) and `fenwira_system` (NOLOGIN BYPASSRLS).
- Create the `fenwira` database owned by `fenwira_owner`, and the schemas `public` and `system`.
- Default privileges: `fenwira_app` gets DML on the `public` tables and EXECUTE on the `system` functions. No DDL.

Migrations (`prisma migrate deploy`) run as `fenwira_owner` in the `fenwira-migrate` one-shot, followed by `packages/database/sql/post-migrate.sql` (RLS policies, grants, `system.*` functions, triggers), which is idempotent.

### Environment variables

`.env.example` (committed) documents all of them. `.env` is git-ignored.

| Variable | Example (dev) | Used by |
| --- | --- | --- |
| `NODE_ENV` | `development` | all |
| `APP_VERSION` | `dev` (CI sets the git SHA) | all |
| `LOG_LEVEL` | `debug` | all |
| `WEB_ORIGIN` | `http://localhost:3000` | api (CORS, CSRF origin check), emails |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api/v1` | web |
| `NEXT_PUBLIC_WS_URL` | `http://localhost:4000` | web |
| `PUBLIC_API_URL` | `https://<tunnel>.trycloudflare.com` | api (webhook URL shown in the docs/UI) |
| `DATABASE_URL` | `postgresql://fenwira_app:…@fenwira-postgres:5432/fenwira` | api, worker |
| `MIGRATION_DATABASE_URL` | `postgresql://fenwira_owner:…@fenwira-postgres:5432/fenwira` | migrate |
| `POSTGRES_PASSWORD`, `FENWIRA_OWNER_PASSWORD`, `FENWIRA_APP_PASSWORD` | dev values | postgres init |
| `DB_POOL_SIZE` | `10` | api, worker |
| `REDIS_URL` | `redis://fenwira-redis:6379/0` | api, worker |
| `S3_ENDPOINT` | `http://fenwira-minio:9000` | api, worker |
| `S3_PUBLIC_ENDPOINT` | `http://localhost:9000` | api (presigned URLs for browsers) |
| `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | `us-east-1`, dev keys, `true` | api, worker |
| `S3_BUCKET_MEDIA` / `_IMPORTS` / `_EXPORTS` / `_UPLOADS` | `fenwira-media` … | api, worker |
| `SMTP_URL` | `smtp://fenwira-mailpit:1025` | api, worker |
| `MAIL_FROM` | `Fenwira <no-reply@fenwira.local>` | api, worker |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | Ed25519 PEM (base64) | api |
| `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_ID` | `k1:<base64 32 bytes>`, `k1` | api, worker |
| `API_KEY_PEPPER` | random 32 bytes | api |
| `COOKIE_SECURE` | `false` (dev over http) | api |
| `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_ES_CONFIG_ID` | from the Meta app | api, worker |
| `META_GRAPH_API_VERSION`, `META_GRAPH_BASE_URL` | `v23.0`, `https://graph.facebook.com` | api, worker |
| `WHATSAPP_DEV_CONNECT` | `true` | api, web (`NEXT_PUBLIC_WHATSAPP_DEV_CONNECT`) |
| `WORKER_HEALTH_PORT` | `4100` | worker |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | empty (Phase 12) | all |

A `pnpm setup:env` script generates `.env` from `.env.example`, filling random secrets (JWT keypair, encryption key, pepper, DB passwords). **A fresh clone needs `cp .env.example .env` to work as-is.** `.env.example` ships dev-safe defaults for everything except the Meta values, which are only needed for Phase 4+ real connections.

`.env.test` is used by CI and `pnpm test:integration`, with separate DB and Redis logical DB names.

### Receiving Meta webhooks locally

1. `cloudflared tunnel --url http://localhost:4000` (or ngrok) gives a public HTTPS URL.
2. Set `PUBLIC_API_URL` to it. In the Meta app dashboard, set the webhook callback to `{PUBLIC_API_URL}/webhooks/whatsapp` and the verify token to `META_WEBHOOK_VERIFY_TOKEN`.
3. Without Meta, `pnpm webhook:simulate <fixture>` posts signed fixture payloads to the local API.

### Backup and restore (verified in Phase 12)

- **Postgres:** a `pg_dump -Fc` nightly via the `fenwira-backup` one-shot (compose profile `ops`) to the `./backups/postgres/` bind mount, keeping 14 days.
- **MinIO:** `mc mirror` of all buckets to `./backups/minio/` nightly.
- **Restore:** `scripts/restore.sh <date>` does `docker compose down`, drops the volumes, `up` postgres and minio, `pg_restore`, `mc mirror` back, runs migrate (a no-op), `up` everything, and runs the smoke E2E.
- Redis is **not** backed up. By design it holds no business truth (queues are rebuilt from Postgres via the outbox and campaign recovery).

### Path to production (later; documented only)

- The same images run on any container host. Postgres goes to a managed Postgres 16, Redis to managed Redis (`noeviction`), MinIO is replaced by S3 (drop `S3_ENDPOINT`), Mailpit by SES SMTP credentials, and the tunnel by a real TLS ingress.
- api and worker scale horizontally: they are stateless, the Socket.IO Redis adapter handles fan-out, and BullMQ handles distribution. The web app is static-plus-server Next.js.
- Cookies need `COOKIE_SECURE=true`, and `WEB_ORIGIN`/API on the same site (for example `app.fenwira.com` and `api.fenwira.com`).
- Nothing in the code may assume Docker Compose hostnames except through env.

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| DP1 | Which production host comes after v2? Not needed until after Phase 12. | Ops |
