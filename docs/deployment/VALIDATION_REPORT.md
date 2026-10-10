# Phase 1 validation report: non-Docker production runtime

9 October 2026. Base commit `9471992` plus the approved working-tree changes. Nothing was committed or deployed.

## Test environment

| Role | Used for validation | Production equivalent |
| --- | --- | --- |
| Server | Throwaway `ubuntu:24.04` container (Ubuntu 24.04.5 LTS, x86_64, 2 CPU / 4 GB cap) running only apt packages and plain `node`: no Docker, PM2 or container runtime **inside** it | EC2 t3a.medium |
| Node.js / pnpm | 22.23.3 (official tarball, SHA-256 verified) / 10.34.5 | same |
| nginx / Redis / OpenSSL | 1.24.0 / 7.0.15 / 3.0.13, Ubuntu apt packages | same packages |
| PostgreSQL | PostgreSQL 16 with TLS and a private CA (server certificate naming only `fenwira-pg-tls`) | RDS PostgreSQL 16 with the RDS CA |
| S3 / SMTP / Meta | MinIO (static keys) / Mailpit / signed webhooks sent directly | S3 (instance role) / SES / Meta |

The release under test was built by `deploy/scripts/build-release.sh WORKTREE` on that host. `schema.prisma` is unchanged; P4 was not approved.

## Results

| # | Requirement | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Docker Compose still works | **PASS** | `docker compose config` OK. `up -d --wait --build`: every service healthy with the new code. `pnpm smoke`: 3/3. Integration suite: 263 database + 10 API + 226 worker passed, 2 skipped (existing opt-in performance probes) |
| 2 | Next.js production build | **PASS** | Built on Ubuntu, standalone assembled, `verify-build.sh` OK |
| 3 | NestJS API build | **PASS** | `apps/api/dist/main.js` |
| 4 | Worker build | **PASS** | `apps/worker/dist/main.js` |
| 5 | Native startup | **PASS** | All three started as user `fenwira` using each unit's exact `WorkingDirectory`, `EnvironmentFile` and `ExecStart`. `check-health.sh all`: ready. Heap limits from `NODE_OPTIONS` applied (560/816/432 MB effective) |
| 6 | PostgreSQL connectivity, TLS | **PASS** | Prisma and node-postgres, as installed in the release: right CA + right name connected; wrong CA refused; another DNS name refused; bare IP refused. Through the app's own `createPrismaClient` (with `connection_limit`): verified. The production-mode `DATABASE_URL` is used by the running services |
| 6b | Migrations | **PASS** | `bootstrap-roles.sql` over verify-full TLS, then `migrate.sh`: migrations, `post-migrate.sql`, RBAC (5 roles, 35 permissions, 113 grants), 3 plans, RLS check passed. Rerun: "No pending migrations", RLS passed |
| 7 | Redis | **PASS** | `deploy/redis` config active: `noeviction`, `maxmemory`, `appendonly yes`, `everysec`, bind 127.0.0.1/::1, `protected-mode yes`. After `shutdown nosave` and a restart, schedules survived (AOF) |
| 8 | BullMQ processing | **PASS** | Sign-up email; S3 import; 300- and 400-webhook bursts all processed |
| 9 | Delayed jobs | **PASS** | `system.ping` with a 3 s delay: `delayed`, then `completed` 3065 ms after enqueue |
| 10 | Scheduled jobs | **PASS** | 13 job schedulers across 8 processors registered (`every` and cron). `campaign.dispatch` completions 14 → 17 in 65 s. No duplicate schedulers after restarts |
| 11 | Meta webhooks | **PASS** | Correct HMAC: 200. Forged: 401. Unknown number: 200 and ignored (by design). For a connected number (test fixture rows in the throwaway database), API → outbox → worker created the conversation and an INBOUND message; a duplicate delivery left exactly one message |
| 12 | S3 storage | **PASS (static keys)** | Presigned upload issued; browser-style PUT 200; the worker downloaded and parsed the file (`UPLOADED → MAPPING`). **The instance-role path is unit-tested only** (see "Not verified") |
| 13 | Email | **PASS** | Verification email delivered by the worker over SMTP to Mailpit; link verified (204). No real email sent |
| 14 | Graceful shutdown | **PASS** | Worker SIGTERM during a 400-message burst: exited in 681 ms. The API kept accepting (400/400). One in-flight outbox dispatch failed with "Connection is closed" and was retried after restart. Result: 400 messages, 400 distinct (no loss, no duplicates). API and web exit on SIGTERM in about 108 ms |
| 15 | No Docker in the production runtime | **PASS** | Units contain no container/PM2 references (checked by `verify-build.sh` and `validate-templates.sh`). Services ran on the plain Ubuntu host |
| 16 | No secrets committed | **PASS** | Only `*.example` templates with placeholders. `deploy/env/*.env` is git-ignored. `verify-build.sh` rejects env files inside a release. Test secrets were generated in the test host and never printed |
| — | Listeners | **PASS** | 3000, 4000, 4100 and 6379 bound to 127.0.0.1 only. A request to :4000 on the network interface was refused |
| — | nginx | **PASS** | `nginx -t` OK on nginx 1.24. HTTP → 301 HTTPS. App 200 over HTTP/2. `/_next/static` served from disk with one `public, max-age=31536000, immutable`. App security headers present. API helmet headers and CORS limited to the app origin. Version hidden (`server: nginx`) |
| — | WebSockets | **PASS** | Socket.IO polling handshake via nginx returned a `sid`. WebSocket upgrade returned HTTP 101 through nginx |
| — | Health sanitising (P3) | **PASS** | Real Redis outage: public `/health/ready` 503 with only `"unavailable"`; the cause stayed in the service log. Recovered to 200 automatically |
| — | systemd units | **PASS** | `systemd-analyze verify` without warnings (after the fix below). Static checks OK |
| — | Repository gates | **PASS** | Lint and typecheck for config/api/worker/database. Unit tests: config 18, database 3, API 142 (including the new health test), worker 4. Prettier OK. shellcheck clean |
| — | Load (60 s) | **PASS** | 25 concurrent HTTP clients via nginx/TLS: 27,544 requests, 0 errors, plus a 300-webhook burst; see RESOURCE_BUDGET |

## Defects found and fixed during validation (deploy assets only)

1. **`http2 on;` is not supported by Ubuntu 24.04's nginx 1.24.** Changed to `listen 443 ssl http2`.
2. **Duplicate `proxy_send_timeout`** in the `/ws` location. Removed.
3. **Double `Cache-Control` on static assets** (`expires` + `add_header`). `expires` removed.
4. **`StartLimitIntervalSec` / `StartLimitBurst` were in `[Service]`, where systemd ignores them.** Moved to `[Unit]`.
5. **nginx version disclosure.** `server_tokens off`.
6. **Database TLS:** Prisma doesn't verify with `sslrootcert` and accepts any certificate without `sslaccept=strict`. Templates now use `sslaccept=strict&sslcert=<CA>&sslrootcert=<CA>`, and `check-env.sh` enforces it.
7. **`verify-build.sh` false positive** on "docker" in unit comments. Checks now ignore comments.

## Application source changes (approved P1–P3)

| | Files | Tests |
| --- | --- | --- |
| P1 listen addresses (`HOST`, `WORKER_HEALTH_HOST`, `METRICS_HOST`; default `0.0.0.0`) | `packages/config/src/env.ts`, `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `apps/api/src/core/metrics/metrics.service.ts`, `apps/api/src/core/config/core-config.ts`, `apps/api/src/app.module.ts` | `packages/config/test/env.test.ts` |
| P2 optional S3 key pair → SDK default credential chain | `packages/config/src/env.ts`, `apps/api/src/core/storage/storage.service.ts`, `apps/api/src/core/config/core-config.ts` | `packages/config/test/env.test.ts` |
| P3 sanitised readiness | `apps/api/src/core/health/health.service.ts` | `apps/api/test/health.test.ts` (new) |

## Not verified

| Item | Why | How to close |
| --- | --- | --- |
| EC2 instance-role credentials for S3 | No AWS in Phase 1 | On the provisioned instance, with keys unset: upload, presigned PUT and GET (Phase 2 acceptance) |
| RDS specifics: `BYPASSRLS` for `fenwira_system` and the real RDS CA bundle | No RDS in Phase 1 (a TLS PostgreSQL 16 stood in) | Run `bootstrap-roles.sql` on the new instance first |
| Amazon SES (implicit TLS on 465, sandbox) | No SES | Send to a verified address after provisioning |
| Real Meta Graph API and Embedded Signup | Production data only | Staging test number |
| systemd as PID 1 (`MemoryHigh`/`MemoryMax`, hardening, `TimeoutStopSec`, restart behaviour) | The container doesn't run systemd. The units were verified with `systemd-analyze` and their exact commands run under the same user, cwd and environment | First boot on EC2: `systemctl start fenwira.target`, then kill a process and confirm restart |
| Let's Encrypt issuance | No public DNS | NON_DOCKER_SETUP §8 |
| Campaigns at volume, large imports/exports, many WebSocket clients | Synthetic load only | Staging load test before launch |
| Release build on the live 4 GB instance alongside running services | Built in an isolated 4 GB host | Build off-instance (recommended) |
| Playwright e2e on Compose | Web code unchanged in this phase; the Compose smoke test rendered the sign-in page | Run the e2e suite before the next commit if desired |
