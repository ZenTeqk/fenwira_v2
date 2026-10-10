# Production runtime (native, no Docker)

How Fenwira runs on a single Ubuntu 24.04 EC2 host: Node 22, systemd, nginx and a local Redis. PostgreSQL is on Amazon RDS, storage is Amazon S3, and email goes through Amazon SES SMTP. There's no Docker, PM2 or container runtime on the server.

```
                 Internet (443)
                      │
                   nginx ── app.fenwira.zenteqk.com ──► 127.0.0.1:3000  fenwira-web     (Next.js standalone)
                      └──── api.fenwira.zenteqk.com ──► 127.0.0.1:4000  fenwira-api     (NestJS: REST, /ws, webhooks)
                                                127.0.0.1:4100  fenwira-worker  (health only; BullMQ processors)
                                                127.0.0.1:6379  redis-server
                     RDS PostgreSQL 16 (TLS) ◄──┘  S3 (instance role) · SES SMTP 465 · Meta Graph API
```

## Release layout

```
/opt/fenwira/releases/<sha>/      immutable build output of deploy/scripts/build-release.sh
/opt/fenwira/current -> releases/<sha>
/etc/fenwira/{api,worker,web,migrate}.env   root:fenwira 0640 (migrate.env 0600)
/etc/fenwira/rds-global-bundle.pem          RDS CA bundle (node-postgres, psql: sslrootcert)
/etc/fenwira/rds-ca-ap-south-1-rsa2048-g1.pem   single RDS region root (Prisma: sslcert)
/etc/systemd/system/fenwira-{api,worker,web}.service, fenwira.target   (deploy/systemd)
/etc/nginx/sites-available/fenwira-{app,api}.conf, snippets/, conf.d/  (deploy/scripts/render-nginx.sh)
/etc/redis/fenwira-redis.conf                (deploy/redis)
```

## Processes

| Unit | Command (relative to working directory) | Working directory | Listens |
| --- | --- | --- | --- |
| `fenwira-api` | `node --enable-source-maps apps/api/dist/main.js` | `/opt/fenwira/current` | `HOST:PORT` = 127.0.0.1:4000 |
| `fenwira-worker` | `node --enable-source-maps apps/worker/dist/main.js` | `/opt/fenwira/current` | 127.0.0.1:4100 (`/health*` only) |
| `fenwira-web` | `node apps/web/server.js` | `/opt/fenwira/current/apps/web/.next/standalone` | `HOSTNAME:PORT` = 127.0.0.1:3000 |
| migrations | `node packages/database/dist/cli/migrate.js` via `deploy/scripts/migrate.sh` | release dir | — |

These are the same entry points the Docker images run (`infrastructure/docker/*.Dockerfile`): one implementation, two ways to package it.

- **Starting and stopping:** `systemctl start|stop|restart fenwira.target` controls all three services.
- **Order:** web waits for the API (`After=`). Both API and worker start after `redis-server`.
- **Database availability:** RDS is remote, so systemd can't order on it. The services retry their connections, and readiness reports the database down until it answers.

## Workers and queues

- **One process:** a single `fenwira-worker` process consumes all 25 queues and keeps the recurring job schedulers.
- **Schedulers:** these use BullMQ `upsertJobScheduler`, which is idempotent. A restart or a second worker instance never creates duplicate schedules.
- **No consumers in the API:** the API process runs no queue consumers.
- **Enqueuing:** domain events are written to the outbox table in the same transaction as the change, and the worker relays them to the queues (AGENTS.md rule 6).
- **Graceful shutdown:** on SIGTERM, Nest shutdown hooks call `Worker.close()` on every BullMQ worker. It stops taking new jobs and waits for the jobs in progress.
  - `TimeoutStopSec=120` bounds the wait.
  - A job still running at the timeout is killed. Its lock then expires and BullMQ hands it to the next worker (stalled-job recovery).
  - Every handler is idempotent (AGENTS.md rule 5), so redelivery is safe.
- **What keeps working unchanged:** retries, backoff, delayed jobs, Meta rate limiting and the dead-letter queue (`whatsapp.outbound.dlq`, replayed with `pnpm --filter @fenwira/worker dlq`) are BullMQ and application logic, untouched.

## Database

- **Migrations are explicit:** `deploy/scripts/migrate.sh <release> /etc/fenwira/migrate.env` runs them, before the `current` link is switched to a new release.
- **What it runs:** `prisma migrate deploy` (pending committed migrations only; never `db push`, never a reset), then the idempotent `post-migrate.sql`, the RLS coverage check and the RBAC/plan seeds.
- **Who runs it:** neither API nor worker ever migrates.
- **Rollback:** migrations are forward-only. Roll back by switching `current` back to the previous release, which works only if the newer migration was additive (the project convention). For anything destructive, take an RDS snapshot first and plan a forward fix.
- **One-time role bootstrap:** [`deploy/sql/bootstrap-roles.sql`](../../deploy/sql/bootstrap-roles.sql), run as the RDS master user.
  - Verify first that RDS allows creating the `BYPASSRLS` role `fenwira_system`.
  - If it doesn't, stop: the SECURITY DEFINER system functions depend on it.

### Database TLS

Measured against PostgreSQL 16 with a private CA, using both drivers (VALIDATION_REPORT §TLS):

| URL parameters | Prisma (API/worker) | node-postgres (`post-migrate.sql`) |
| --- | --- | --- |
| `sslmode=require` alone | encrypted, **certificate not verified** | verified (pg ≥ 8.x treats `require` as verify-full) |
| `sslrootcert=<CA>` | ignored | verified |
| `sslaccept=strict&sslcert=<CA>` | verified | fails (it reads `sslcert` as a client certificate) |
| **`sslmode=require&sslaccept=strict&sslcert=<CA>&sslrootcert=<CA>`** | **verified** | **verified** |

Use the last form, with two different CA files:
- **`sslrootcert` = the RDS global bundle** (`https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`) at `/etc/fenwira/rds-global-bundle.pem`. node-postgres and `psql` read every certificate in it.
- **`sslcert` = the single root CA for the region** at `/etc/fenwira/rds-ca-ap-south-1-rsa2048-g1.pem`. **Prisma loads only the first certificate of the `sslcert` file.** The global bundle starts with another region's root, so pointing `sslcert` at it fails with `P1011 … self-signed certificate in certificate chain` (seen in the first production migration).

The region root is "Amazon RDS ap-south-1 Root CA RSA2048 G1". It is extracted from the global bundle by subject (first boot does this in `bootstrap.sh.tftpl` and asserts exactly one certificate):
- SHA-256 fingerprint `FF:6A:59:9C:…:21:23:39:B8`;
- valid until 2061;
- `openssl verify` of the server chain returns 0.

It matches the instance's CA (`rds-ca-rsa2048-g1`). If the RDS instance moves to another CA (for example `rds-ca-ecc384-g1`), or to another region, extract that root, update `sslcert` in both SSM URLs and re-render the env files. `check-env.sh` refuses a remote production URL without these parameters, or whose `sslcert` file is missing or holds more than one certificate.

Hostname verification was tested too. With a certificate naming only the server's DNS name, both drivers refused another DNS name pointing at the same server, and refused the bare IP.
- **Use the DNS endpoint:** always connect to the RDS DNS endpoint, never an IP. When given an IP, node-postgres checks the certificate against `localhost`.
- **`psql`:** it rejects `sslaccept` ("invalid URI query parameter"). Use the libpq form in NON_DOCKER_SETUP.
- **Before upgrading node-postgres to v9:** node-postgres 8.23 treats `sslmode=require` as `verify-full`, and prints a deprecation warning saying v9 will adopt libpq semantics, where `require` does not verify. Review the URL before that upgrade: Prisma accepts only `disable|prefer|require`, so the migration URL may then need a node-postgres-specific form.

## Redis

- **Install and config:** `apt install redis-server`, plus [`deploy/redis/fenwira-redis.conf`](../../deploy/redis/fenwira-redis.conf).
  - Binds to loopback only.
  - `maxmemory-policy noeviction` is required by BullMQ: eviction would silently drop jobs, locks and schedules.
  - `maxmemory 512mb`, AOF `everysec` plus RDB snapshots.
- **What lives there:** queues, schedules, locks, rate limits, presence, sessions and realtime fan-out.
- **What a restart does:** with persistence, queued and delayed jobs and sessions survive. Without it, they'd be lost (Postgres keeps business state, but users would be signed out).
- **When full:** Redis refuses writes instead of evicting. The `used_memory` alarm (Phase 2) must fire well before `maxmemory`.

## Storage and email

- **S3:** with `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` unset, the AWS SDK uses the EC2 instance role (IMDSv2). Presigned upload and download URLs are signed with the role's temporary credentials.
- **Bucket setup (Phase 2):** private buckets, CORS for `https://app.fenwira.zenteqk.com` (PUT/GET), and a 7-day lifecycle rule on imports and exports.
- **SES:**
  - `SMTP_URL=smtps://…@email-smtp.<region>.amazonaws.com:465` (implicit TLS).
  - `MAIL_FROM` must be a verified identity.
  - The account must be out of the SES sandbox.
  - Tests use Mailpit. Production credentials are never used in tests.

## Health checks

| Endpoint (loopback) | Meaning |
| --- | --- |
| `GET :4000/health/live` | API process up (no dependency calls) |
| `GET :4000/health/ready` | Postgres, Redis and storage reachable: 200 / 503 |
| `GET :4100/health/ready` | Worker: Postgres, Redis, outbox relay, every processor running |
| `GET :3000/api/health` | Web server up |

- **What failure responses show:** only `{"status":"down","error":"unavailable"}` per check. The real cause is logged to journald, so no host names, connection strings or customer data appear.
- **Exposure:** worker health isn't proxied by nginx, and `/health` on `api.fenwira.zenteqk.com` exposes only up or down.
- **Checking after a deploy:** `deploy/scripts/check-health.sh all 90`.

## Logging

- **Where it goes:** every service writes JSON to stdout, and journald stores it. Read it with `journalctl -u fenwira-api -f`, or `-o cat | jq` for the raw JSON.
- **What's in each line:** the correlation ID (requests), job ID and queue (jobs), and tenant ID.
- **What's kept out:** the central pino redaction list removes tokens, passwords, cookies and authorisation headers. Message bodies, phone numbers and email addresses are never logged at `info` or above (AGENTS.md rule 8).
- **Level:** `LOG_LEVEL=info`.
- **CloudWatch:** rsyslog copies each service's journal lines (`SyslogIdentifier=fenwira-*`) to `/var/log/fenwira/<service>.log`, and the CloudWatch agent ships those to `/fenwira/v2/prod/<service>`. The directory must be `syslog:adm 0750`: rsyslog runs as `syslog`, and `cwagent` reads through group `adm`. With `root:root` ownership, rsyslog fails with "Permission denied" and nothing reaches CloudWatch.

## nginx

- **Source:** templates in [`deploy/nginx`](../../deploy/nginx), rendered by `deploy/scripts/render-nginx.sh`, which fills in domains and certificate paths, so none are hard-coded.
- **app.fenwira.zenteqk.com:** proxies to `:3000` and serves `/_next/static` straight from the release with a year-long immutable cache. It adds HSTS, `nosniff`, `X-Frame-Options DENY`, a Referrer-Policy and a Permissions-Policy.
- **No CSP yet:** Meta Embedded Signup loads the Facebook SDK, so a Content-Security-Policy needs its own tested allowlist.
- **api.fenwira.zenteqk.com:**
  - Proxies to `:4000`.
  - `/ws` gets WebSocket upgrade with a 1 h read timeout.
  - The body limit is 2 MB: the API takes JSON only (Express limit 100 kB), and files go to S3 directly.
  - Security headers come from helmet in the API itself.
- **Forwarded client IP:** `X-Forwarded-For` is set to `$remote_addr`, never appended from the client, which matches `TRUST_PROXY=1`.
- **HTTP:** redirects to HTTPS, except ACME challenges under `/var/www/letsencrypt`.

## Security

- **Users:** services run as the unprivileged `fenwira` user, with `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`, no capabilities and restricted address families.
- **Write access:** only the web unit can write to disk, and only its `.next/cache` (the Next.js image cache).
- **Secrets:** they live only in `/etc/fenwira/*.env`, never in units or the repository.
- **Network exposure:** internal ports bind to 127.0.0.1. The security group should allow only 22 (or SSM), 80 and 443.
