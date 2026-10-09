# Fenwira — AWS deployment without Docker

Prepared 8 October 2026 from the current repository. This is a deployment design and operator guide, not an executed AWS deployment or production acceptance result. It documents the user's requested alternative to the existing Compose-only deployment target. No AWS infrastructure, runtime code, rollout flags or existing customer data were changed.

## 1. What runs

Fenwira is a pnpm monorepo with three long-running Node processes and one release-time migration process:

| Process | Repository | Runtime | Port / probe |
| --- | --- | --- | --- |
| Web | apps/web | Next.js standalone server | 3000; `/api/health` |
| API | apps/api | NestJS REST and Socket.IO | 4000; `/health/ready`, `/health/live`; Socket.IO `/ws` |
| Worker | apps/worker | NestJS + BullMQ processors, outbox relay and scheduled jobs | 4100; `/health/ready`; internal `/metrics` |
| Migrate | packages/database | Prisma migrations + post-migrate SQL + seeds + RLS validation | One-shot; no listener |

Use the repository's Node 22 major with current security patches, pnpm **10.34.5**, PostgreSQL **16**, Prisma **6.19.3**, and a compatible Redis OSS **7** deployment. The backend runtime also needs OpenSSL and CA certificates. Compile/install native dependencies on Linux for the target architecture; do not copy macOS node_modules or its Prisma engine to EC2. Start with Linux x86-64 to match the simplest existing runtime path; ARM needs its own native dependency/build verification.

Next.js is a server application here; uploading frontend files to an S3 static website is insufficient. The worker is essential for sending, imports, connector transfers, campaigns, automations, analytics, notifications, subscription lifecycle and reconciliation. Do not deploy only the frontend/API.

## 2. AWS resource map

| AWS resource | Purpose | Initial configuration |
| --- | --- | --- |
| EC2 application host(s) | Run web and API with systemd | Private subnets; Linux; dedicated non-root service users |
| EC2 worker host(s) | Run worker with systemd | Private subnets; no public ingress |
| RDS PostgreSQL | Persistent tenant data, ledger, subscriptions, audit, outbox | PostgreSQL 16; private; encrypted; bootstrap compatibility gate below |
| ElastiCache Redis OSS | BullMQ, locks, rate limits, realtime fan-out | Node-based, cluster mode disabled, TLS/auth, custom noeviction parameter group |
| S3 | Private media and temporary import/export files | Private buckets, encryption, presigned browser access, CORS |
| SES SMTP | Verification, reset, billing and notification email | Verified sending domain; production sending access; regional SMTP credentials |
| Application Load Balancer | Public HTTPS, routing, WebSocket upgrade | Public subnets in two AZs; web/API target groups |
| ACM | TLS certificate for application domain | Attach to ALB in its region; DNS validation |
| Route 53 or existing DNS provider | Application DNS | Domain points to ALB; existing DNS provider is acceptable |
| VPC, subnets, routing, security groups | Network boundaries | Public ingress subnets, private compute/data subnets |
| NAT gateway(s) | Outbound provider calls from private compute | Meta, OAuth/CRM/store services, external webhooks and package downloads |
| S3 gateway endpoint | Private compute → S3 | Include deployment/artifact buckets as appropriate; browser presigned traffic still needs authorized S3 access |
| IAM instance profiles + Systems Manager | Host access and controlled AWS access | SSM, scoped configuration/artifact access and logs; no public SSH required |
| Secrets Manager or SSM SecureString + KMS | Secrets and configuration | Separate runtime, release/migration and operator access |
| CloudWatch | Host metrics, application logs and alarms | Explicit retention; private application metrics collection needs configuration |
| AWS Budgets / billing alerts | Spend visibility | Thresholds selected by the owner |

No ECS, EKS, ECR, Docker daemon or container image is needed. SQS is not a substitute for the existing Redis/BullMQ queues. Lambda is not the initial fit for this long-running worker/realtime architecture. CloudFront, WAF and RDS Proxy are optional later additions, not initial requirements.

### Planning capacity — not a load-tested guarantee

For a controlled pilot: one application EC2 host with roughly 2 vCPU / 8 GiB RAM, one worker host with roughly 2 vCPU / 4–8 GiB RAM, a PostgreSQL instance starting around 2 vCPU / 4–8 GiB RAM, and a Redis node sized after measuring queues, sessions and locks. Build on a separate Linux machine with at least 8 GiB RAM; compilation can need more memory than serving pages. Use encrypted gp3 EBS volumes with space for several release artifacts and bounded logs. Starting application disks around 40–60 GiB are a planning allowance, not durable data storage.

The pilot's single application/worker hosts are availability limitations. For a customer-facing availability target, use two application hosts across AZs, two worker hosts after exercising multi-worker behavior, Multi-AZ RDS and a Redis replication group with a replica/automatic failover. Private-subnet egress across two AZs should be designed explicitly; one shared NAT is cheaper but adds an AZ dependency, two NAT gateways cost more. Use the region closest to the intended users and approved data location; Mumbai (`ap-south-1`) is a reasonable planning assumption for this India-focused launch, not an already approved residency policy.

Size from concurrent workspaces, messages/minute, campaign bursts, import volume, retention and attachments. There is no defensible monthly total until region, HA, traffic and retention are specified. Budget for EC2/EBS, RDS storage/backups, Redis, ALB, NAT hourly/data processing, S3 requests/storage, internet transfer, logs, secrets and SES. NAT, database HA and unbounded logs can dominate a small deployment.

## 3. Network and public URLs

Use a single application origin initially, for example `https://app.example.com`. This reduces cross-subdomain cookie/CORS complexity. Route ALB HTTPS requests as follows, preserving the request URI:

| Listener match | Target |
| --- | --- |
| `/api/v1/*` | API :4000 |
| `/ws` and `/ws/*` | API :4000 |
| Default, including `/platform`, `/integrations/native/callback`, `/api/health` and `/_next/*` | Web :3000 |

The API target group's health check is `/health/ready` on port 4000. The web target group's health check is `/api/health` on port 3000. Health checks address targets directly and do not require public health routes. Worker health and metrics stay private. Configure HTTP port 80 to redirect to HTTPS, ALB certificate, target deregistration/draining and an idle timeout suitable for persistent connections.

The browser currently uses WebSocket-only Socket.IO on `/ws`; the API Redis adapter provides cross-instance event fan-out. ALB supports WebSocket upgrade. Do not rewrite `/ws` to `/api/v1/ws`. An established WebSocket stays on its target; if HTTP polling is added later, revisit session affinity. Start without extra reverse proxies; ALB → API is one trusted proxy hop, so `TRUST_PROXY=1`, and only the ALB security group may reach API ingress. CloudFront/Nginx would change this trust-chain analysis.

Security-group ingress:

- ALB: public 443 and optional 80 redirect.
- Application hosts: 3000 and 4000 only from the ALB group; API 4000 additionally from the web-host group if server-side checks use private API addresses.
- PostgreSQL: 5432 only from API/worker and controlled migration host groups.
- Redis: 6379 only from API/worker groups, including the realtime adapter.
- Worker: 4100 only from private monitoring/administration sources.
- API metrics: 9464 only from the private collector.
- No public PostgreSQL, Redis, worker/metrics, MinIO or Mailpit ports. Prefer SSM to public SSH.

Provide outbound HTTPS/DNS and SMTP TLS connectivity. Private compute needs NAT or appropriate private endpoints for dependencies. A VPC endpoint for S3 does not replace NAT for Meta or other external providers.

Avoid recording raw query strings in ingress/access logs: OAuth callback URLs contain authorization codes; S3 presigned URLs contain credentials/signatures. CloudWatch ingestion does not automatically apply Fenwira's pino redaction to ALB/Nginx logs. Evaluate log-field redaction/retention/access before enabling raw ingress logs; application audit remains in the database.

## 4. Database bootstrap: a real compatibility gate

The repository uses:

- `fenwira_owner`: LOGIN, schema owner/migration account, not application runtime.
- `fenwira_app`: LOGIN, NOSUPERUSER, NOBYPASSRLS, no CREATEDB/CREATEROLE.
- `fenwira_system`: NOLOGIN, BYPASSRLS, narrow grants; owns named system.* SECURITY DEFINER functions.

`fenwira_app` must never be a member of `fenwira_system` or rds_superuser, nor receive bypass or migration privileges. Forced tenant RLS and the system gateways must survive deployment.

RDS administrative access is rds_superuser rather than a true PostgreSQL superuser. The current bootstrap script expects privileges available in local PostgreSQL. **Verify that the chosen RDS PostgreSQL version permits the exact system-role attributes/function ownership with the intended migration account before committing to this configuration.** AWS documentation alone is not execution evidence for this repository. Do not solve a failed bootstrap by removing FORCE RLS, granting broad rds_superuser to runtime, or replacing narrow gateways with generic tenant bypass. If the bootstrap cannot be supported, assess a narrowly equivalent reviewed database bootstrap or separately operated PostgreSQL 16 on EC2; the latter adds backup, patching and HA responsibility.

On an isolated staging DB, an authorized DBA should adapt `infrastructure/docker/postgres/init/01-roles.sh` to the managed service. Do not execute the existing script unchanged: it expects local psql/socket privileges and recreates roles. Required setup is equivalent to:

```sql
-- Illustrative DBA statements. Supply passwords through a secure provisioning mechanism.
CREATE ROLE fenwira_owner LOGIN NOSUPERUSER NOCREATEROLE;
CREATE ROLE fenwira_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE fenwira_system NOLOGIN BYPASSRLS NOSUPERUSER;
GRANT fenwira_system TO fenwira_owner;
CREATE DATABASE fenwira OWNER fenwira_owner;
```

Connect to `fenwira` and preserve schema privileges:

```sql
REVOKE ALL ON DATABASE fenwira FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE fenwira TO fenwira_app;
ALTER SCHEMA public OWNER TO fenwira_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS system AUTHORIZATION fenwira_owner;
GRANT USAGE, CREATE ON SCHEMA system TO fenwira_system;
GRANT USAGE ON SCHEMA public, system TO fenwira_app;
```

Set unique LOGIN passwords securely; the illustrative statements omit them intentionally. Never use the RDS master account as DATABASE_URL. The migration executable then creates tables, applies remaining grants/functions/triggers, seeds RBAC/plans and validates forced RLS. Run it once per release, serialized, not on each API boot:

```bash
# Run from the Linux release repo with migration-only environment injected.
node packages/database/dist/cli/migrate.js
```

This command runs Prisma deploy **and post-migrate.sql**. Running only `prisma migrate deploy` misses essential security functions/grants/RLS validation.

Use verified TLS to RDS and the RDS CA bundle. Prisma 6 runtime URLs use its supported `sslmode=require`, root-certificate and `sslaccept=strict` options. The migration tool also uses node-postgres; validate certificate verification for both drivers rather than assuming a Prisma-only option configures pg. Mount the CA bundle read-only at a stable path; do not disable certificate verification or set NODE_TLS_REJECT_UNAUTHORIZED=0. Test that invalid certificates fail. Budget DB connections as roughly API replicas × pool size + worker replicas × pool size + realtime/outbox/migration/admin connections. Avoid adding a transaction pooler/RDS Proxy until Prisma transactions, tenant SET LOCAL context and outbox listeners are tested with it.

## 5. Redis

Use a node-based ElastiCache Redis OSS replication group with **cluster mode disabled**, authenticated TLS and a custom parameter group with `maxmemory-policy=noeviction`. The current code constructs ordinary IORedis clients, not Redis.Cluster. Do not use a cluster configuration endpoint or assume ElastiCache Serverless is compatible with BullMQ's eviction requirement.

Configure a primary endpoint, database 0 and a credential-bearing rediss URL, percent-encoding credentials. AUTH-token and ACL/RBAC URL forms differ; use the form actually configured and tested. TLS certificate checks stay enabled. Enable failover/replica for the HA tier and alert on memory, connection count, evictions, delayed/failed queues and reconnect errors. Non-eviction protects queue state but makes memory capacity/alerts essential.

Test enqueue/consume, delayed jobs, schedulers, Socket.IO pub/sub and redis failover. Postgres is durable business truth, but Redis loss can still interrupt queues, locks and rate limits; test recovery/requeue instead of assuming all jobs instantly recreate themselves. Keep staging/testing in separate resources, not the production test DB/Redis namespace.

## 6. S3

The service uses private GetObject/HeadObject/PutObject plus presigned GET/PUT. Use unique bucket names; the four Compose bucket names are local examples:

| Bucket setting | Purpose | Retention |
| --- | --- | --- |
| S3_BUCKET_MEDIA | Message/template media | Product retention; no arbitrary 7-day deletion |
| S3_BUCKET_IMPORTS | Contact import files | Existing local policy is 7 days; carry over deliberately |
| S3_BUCKET_EXPORTS | Temporary exports | Existing local policy is 7 days; carry over deliberately |
| S3_BUCKET_UPLOADS | Declared/provisioned local bucket | Currently declared in config but not consumed by StorageService; verify future upload use before enabling permissions |

Use Block Public Access, encryption, exact regional HTTPS endpoint and `S3_FORCE_PATH_STYLE=false`. Browser-visible presigned endpoints must remain reachable; do not replace them with an internal hostname. Avoid a bucket policy restricting all reads/writes to a VPC endpoint if that would deny browser presigned requests. Consider versioning/backup for durable media; if versioning temporary buckets, lifecycle rules must handle noncurrent versions too.

A browser CORS example (apply only required origins/methods):

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

CORS is not an authorization policy. Grant the server only the required bucket/object actions; no public-read ACL or broad administrator S3 credentials. If using SSE-KMS, add only the necessary KMS permissions and verify presigned downloads/uploads. Verify signed Content-Type, file size/type checks, range downloads and template preview URLs.

**Current-code credential limitation:** env validation requires S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, and StorageService explicitly passes only those credentials. It does not currently use the default EC2 credential provider chain or accept a session token. An instance profile alone will not make this implementation work. Preferred production preparation is a focused tested change allowing SDK role credentials while preserving explicit MinIO credentials for local/test. Until that change exists, the supported mechanism is a restricted static credential stored as a runtime secret with a rotation procedure; do not paste temporary role credentials into these two fields without their session token. No such code change was made for this guide.

## 7. SES email

Verify the selected MAIL_FROM domain in the chosen SES region, publish the supplied DKIM records, configure SPF/DMARC and an appropriate MAIL FROM policy, and request production sending access. Sandbox restrictions prevent normal unverified-customer delivery. Create regional **SES SMTP credentials**, not generic AWS access keys. Use TLS; port 465 with smtps is a straightforward match for the existing Nodemailer URL configuration:

```dotenv
SMTP_URL=smtps://SMTP_USERNAME:URL_ENCODED_SMTP_PASSWORD@email-smtp.ap-south-1.amazonaws.com:465
MAIL_FROM="Fenwira <no-reply@example.com>"
```

These values are placeholders, not real credentials/contact decisions. Test verification, password reset, MFA/security notifications, billing support events, bounce/complaint handling and sending limits. MAIL_FROM and billing.support_email/support_url remain configuration-driven. Mailpit is local-only and must not be deployed as production mail delivery.

## 8. Configuration and secret separation

Compose currently assembles database/Redis/SMTP URLs. Without Compose you must supply the actual URLs explicitly. Zod parses process.env; API/worker do not magically load the repo root .env. Inject environment through systemd or a reviewed secret-loader. Keep secrets out of source, deployment artifacts, shell history, command-line arguments and logs.

Suggested files on hosts, provisioned securely from Secrets Manager/SSM:

- `/etc/fenwira/common.env`: common runtime config/secrets for API/worker.
- `/etc/fenwira/api.env`: JWT/cookie/API settings.
- `/etc/fenwira/worker.env`: SMTP/worker settings.
- `/etc/fenwira/web.env`: web settings only; no database/token encryption secrets.
- Migration-only configuration on a controlled release host; never distribute its credential to application hosts.

Use root-owned environment files with mode 0600 when systemd reads them as manager. Access control, refresh/rotation and audit require host provisioning; AWS SDKs do not automatically fetch all these values from Secrets Manager merely because a secret exists.

### Common API/worker settings

```dotenv
NODE_ENV=production
APP_VERSION=RELEASE_GIT_SHA
LOG_LEVEL=info
WEB_ORIGIN=https://app.example.com
DATABASE_URL=postgresql://fenwira_app:ENCODED_PASSWORD@RDS_ENDPOINT:5432/fenwira?sslmode=require&sslrootcert=/etc/fenwira/rds-ca.pem&sslaccept=strict
DB_POOL_SIZE=10
REDIS_URL=rediss://:ENCODED_REDIS_AUTH@REDIS_PRIMARY_ENDPOINT:6379/0
ENCRYPTION_KEYS=k1:BASE64_32_BYTE_KEY
ENCRYPTION_ACTIVE_KEY_ID=k1
S3_REGION=ap-south-1
S3_ENDPOINT=https://s3.ap-south-1.amazonaws.com
S3_PUBLIC_ENDPOINT=https://s3.ap-south-1.amazonaws.com
S3_FORCE_PATH_STYLE=false
S3_ACCESS_KEY_ID=RESTRICTED_KEY_UNTIL_ROLE_CREDENTIAL_SUPPORT
S3_SECRET_ACCESS_KEY=RESTRICTED_SECRET_UNTIL_ROLE_CREDENTIAL_SUPPORT
S3_BUCKET_MEDIA=YOUR_UNIQUE_MEDIA_BUCKET
S3_BUCKET_IMPORTS=YOUR_UNIQUE_IMPORTS_BUCKET
S3_BUCKET_EXPORTS=YOUR_UNIQUE_EXPORTS_BUCKET
S3_BUCKET_UPLOADS=YOUR_UNIQUE_UPLOADS_BUCKET
META_GRAPH_BASE_URL=https://graph.facebook.com
META_GRAPH_API_VERSION=v23.0
META_APP_ID=YOUR_META_APP_ID
META_APP_SECRET=YOUR_META_APP_SECRET
BILLING_ENFORCED=false
BILLING_SUBSCRIPTIONS_ENFORCED=false
BILLING_TRIAL_DAYS=14
BILLING_TRIAL_PLAN=GROWTH
TRIAL_CREDIT_MINOR=0
BILLING_LOW_BALANCE_THRESHOLD_MINOR=10000
```

`v23.0` is the current repository configuration, not a claim that it is the newest Meta version. Verify Meta support and approved app permissions at launch; do not silently upgrade the integration contract. Keep both financial rollout switches off for this deployment unless a separate rollout is authorized. Do not invent trial funding or price-book values. Optional configured support values may be added after commercial approval.

### API-only

```dotenv
PORT=4000
PUBLIC_API_URL=https://app.example.com
JWT_PRIVATE_KEY=BASE64_ENCODED_ED25519_PRIVATE_PEM
JWT_PUBLIC_KEY=BASE64_ENCODED_ED25519_PUBLIC_PEM
COOKIE_SECURE=true
TRUST_PROXY=1
SYSTEM_PING_ENABLED=false
WHATSAPP_DEV_CONNECT=false
API_KEY_PEPPER=NEW_HIGH_ENTROPY_SERVER_SECRET
API_KEY_RATE_LIMIT_PER_MINUTE=120
META_ES_CONFIG_ID=YOUR_EMBEDDED_SIGNUP_CONFIG
META_WEBHOOK_VERIFY_TOKEN=YOUR_HIGH_ENTROPY_VERIFY_TOKEN
METRICS_PORT=9464
```

Leave COOKIE_DOMAIN unset for the single-origin setup. If sibling subdomains are deliberately used, verify cookie domain, CORS, CSRF and the platform-session path on that topology. Shared signing/encryption/API-key secrets must remain stable across instances/restarts. JWT keys are base64 PEM Ed25519 values, not arbitrary random strings. Encryption keys are 32 random bytes per key ID; retain old IDs when rotating until ciphertext is re-encrypted. Never regenerate encryption keys at every deployment. Losing them loses access to stored provider credentials/MFA material. Rotation of API_KEY_PEPPER needs a planned key compatibility strategy.

### Worker-only

```dotenv
WORKER_HEALTH_PORT=4100
OUTBOX_POLL_INTERVAL_MS=250
SMTP_URL=smtps://SMTP_USERNAME:ENCODED_SMTP_PASSWORD@email-smtp.ap-south-1.amazonaws.com:465
MAIL_FROM="Fenwira <no-reply@example.com>"
WHATSAPP_SYNC_INTERVAL_HOURS=6
CAMPAIGN_BATCH_SIZE=50
WHATSAPP_OUTBOUND_BACKOFF_MS=1000
BILLING_RESERVATION_GRACE_MINUTES=360
ANALYTICS_SETTLE_SECONDS=20
WEBHOOK_BACKOFF_MS=30000
WEBHOOK_MAX_RETRY_HOURS=24
WEBHOOK_DISABLE_AFTER_FAILURES=20
```

Set OPS_ALERT_EMAIL to the chosen internal operations destination, not the local demo address. Leave AUTOMATION_WEBHOOK_DEV_HOSTS unset on both processes; production validation rejects development exceptions.

### Web build-time and runtime

Build-time:

```dotenv
NEXT_PUBLIC_API_URL=https://app.example.com/api/v1
NEXT_PUBLIC_NAV_PREVIEW=false
```

Runtime:

```dotenv
NODE_ENV=production
PORT=3000
HOSTNAME=0.0.0.0
WEB_ORIGIN=https://app.example.com
API_INTERNAL_URL=http://PRIVATE_API_ADDRESS:4000
ENABLE_UI_GALLERY=false
NEXT_TELEMETRY_DISABLED=1
```

If API and web are colocated, API_INTERNAL_URL can be `http://127.0.0.1:4000`; otherwise use a reachable private service address/internal load-balancer endpoint. It must reach `/health/live`, not assume the public ALB exposes `/health/live`. The web `/api/health` depends on that connection. Only NEXT_PUBLIC values become browser config; never put secrets there. Rebuild if changing NEXT_PUBLIC_API_URL; changing only a runtime environment file does not replace its inlined value. Existing public API/connector endpoints must use the production origin.

### Optional native OAuth apps (API and worker)

Set NATIVE_GOOGLE_CLIENT_ID/SECRET, NATIVE_ZOHO_CLIENT_ID/SECRET and NATIVE_SHOPIFY_CLIENT_ID/SECRET pairs only after provider app registration. Unconfigured providers remain unavailable honestly. Callback for all three is:

```text
https://app.example.com/integrations/native/callback
```

See NATIVE_CONNECTORS.md for Google offline refresh/Sheets scope, Zoho Contacts READ and regional support, Shopify read_customers/protected customer data, and ERPNext public HTTPS/API key setup. Real-account consent/refresh/revocation acceptance is still required. No local demo OAuth success is production verification.

## 9. Build and release without Docker

Use a Linux build host/runner with the same architecture/libc family as runtime, Node 22 and pnpm 10.34.5. Pin the release to a reviewed commit; the current workspace contains uncommitted implementation/user changes, so do not deploy an older remote branch and assume it includes them. Exclude demo evidence, test accounts/config, secrets and local .env from the release payload.

From the release checkout:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@fenwira/worker... --filter=@fenwira/api... --env-mode=loose --force
```

The worker depends on compiled API modules. Include the full backend workspace dependency graph, not only apps/worker/dist. Build the web after its workspace dependencies, with the production public build settings explicitly supplied:

```bash
NEXT_PUBLIC_API_URL=https://app.example.com/api/v1 \
NEXT_PUBLIC_NAV_PREVIEW=false \
WEB_ORIGIN=https://app.example.com \
pnpm --filter @fenwira/web build
```

Build in a controlled environment without runtime customer secrets. The direct web build avoids accidentally reusing a build for a different origin; if CI uses Turbo for web, explicitly include public environment values in its cache policy. Run lint/typecheck/unit checks and staging integration/browser regressions before promoting the artifact. The current root integration command still launches Docker; a genuinely Docker-free CI/staging pipeline needs an external-service test harness with the required test database/roles/Redis/S3/SMTP/mock Meta. Do not point integration/browser mutation suites at production.

For deployment artifacts:

- Backend needs compiled apps/api and apps/worker, compiled packages, production node_modules with workspace links, generated Linux Prisma client/engine, database schema/migrations/sql and copied API assets.
- Build with dev dependencies, then prepare a separate runtime install using `pnpm install --prod --frozen-lockfile` and regenerate the Prisma client on Linux before packaging. Do not blindly `pnpm prune` a monorepo or discard workspace links.
- Next standalone output needs its **contents** copied into a web release directory, plus public and static assets:

```bash
mkdir -p release/web/apps/web/.next
cp -a apps/web/.next/standalone/. release/web/
cp -a apps/web/.next/static release/web/apps/web/.next/static
cp -a apps/web/public release/web/apps/web/public
```

Backend release layout convention:

```text
/srv/fenwira/releases/RELEASE_ID/repo/  # backend workspace payload
/srv/fenwira/releases/RELEASE_ID/web/   # standalone payload
/srv/fenwira/current                  # symlink to approved release
/etc/fenwira/                        # protected runtime config, not release contents
```

Direct commands from the backend repo directory:

```bash
node --enable-source-maps apps/api/dist/main.js
node --enable-source-maps apps/worker/dist/main.js
```

Web command from the standalone web directory:

```bash
node apps/web/server.js
```

Use systemd, not `next dev`, shell backgrounding or an interactive SSH session. An API service example (adapt the installed absolute node path):

```ini
[Unit]
Description=Fenwira API
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=fenwira-api
Group=fenwira-api
WorkingDirectory=/srv/fenwira/current/repo
EnvironmentFile=/etc/fenwira/common.env
EnvironmentFile=/etc/fenwira/api.env
ExecStart=/usr/local/bin/node --enable-source-maps apps/api/dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=120
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
UMask=0077
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Create corresponding worker/web services:

| Unit | User | WorkingDirectory | Env files | ExecStart |
| --- | --- | --- | --- | --- |
| fenwira-worker | fenwira-worker | /srv/fenwira/current/repo | common.env + worker.env | node --enable-source-maps apps/worker/dist/main.js |
| fenwira-web | fenwira-web | /srv/fenwira/current/web | web.env | node apps/web/server.js |

Use the same absolute node path in each unit, protect artifact ownership, and allow only necessary writable web cache/temp locations if adding a read-only filesystem policy. Next's runtime cache requirements should be tested before applying aggressive hardening. systemd boot ordering does not replace dependency readiness or migrations. A release pipeline must verify DB/Redis/config and finish migration before starting traffic/consumers.

After preparing units/config and passing migration:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fenwira-api fenwira-worker fenwira-web
sudo systemctl status fenwira-api fenwira-worker fenwira-web
```

On separate hosts, start only the units assigned to each host. Register healthy app targets with ALB, check private worker readiness, then enable public DNS/traffic. Prefer staged release directories and target draining; do not compile over a running release. systemd EnvironmentFile syntax differs from shell .env: no export statements or shell substitution, quote MAIL_FROM correctly, and preserve credential characters.

## 10. Meta and platform bootstrap

Meta callback in the **actual current API routing** is:

```text
https://app.example.com/api/v1/webhooks/whatsapp
```

The controller is `webhooks/whatsapp` under the API global prefix; only health routes are excluded. Some older deployment prose omits `/api/v1`; follow the current code, not that old example. Verify GET handshake and signed POST delivery at this URL, with the real Meta app/verify secret and selected app permissions/review. Ensure ingress does not alter raw payload bytes used for HMAC. No simulated Meta process, demo credentials or WHATSAPP_DEV_CONNECT belongs in production.

For an initial platform operator, create/verify the actual user identity and enroll MFA first. Use the restricted migration-access grant tool on the release/admin host:

```bash
node packages/database/dist/cli/platform-operator.js \
  --user USER_UUID --actor AUTHORIZED_CHANGE_REFERENCE --reason "Approved initial commercial operator"
```

Provision operator grant/revoke only through controlled access. Platform login requires password/MFA and separate short privileged sessions. OWNER/ADMIN membership does not grant platform authorization. Financial CLI tools reuse the authenticated platform boundary; do not resume old direct database wallet-credit shortcuts. Keep platform audit and operation receipts intact.

## 11. Monitoring, backup and rollout

Collect JSON stdout through journald/CloudWatch with bounded retention rather than creating unmanaged project log files. Configure CPU/memory/disk, process restart, ALB unhealthy-target/5xx/latency, DB connections/storage/replication, Redis memory/evictions/failovers, and queue/outbox lag alarms. Scrape private API :9464/metrics and worker :4100/metrics with a collector; exporting a metrics endpoint does not automatically create CloudWatch dashboards. Add wallet drift/stale reservations, platform auth/MFA failures and connector failure signals. Secrets/customer message content must remain redacted.

Choose RDS backup retention explicitly (for example 14 days initially), enable point-in-time recovery, deletion protection and release snapshots. Version/backup durable S3 media and protect encryption keys separately. Existing Docker restore.sh is not an RDS/S3 restore runbook and must not be run against AWS production. Rehearse restoring a staging copy, including ledger/audit/tenant isolation and media/key access. Do not rewrite historical financial rows during migration.

First deploy staging with a separate domain, database, Redis and buckets. Live release checks:

1. Role/bootstrap compatibility, successful migrations/seeds and forced RLS coverage; runtime user has no bypass.
2. Verified DB/Redis TLS, no direct public data ports, protected internal probes/metrics.
3. Web/API/worker health and persisted release SHA; correct build-time API URL.
4. Registration/verification/reset/email delivery; tenant switching, cookie/CSRF and MFA; operator session grant/revoke.
5. Real Meta handshake/inbound/outbound/status and realtime reconnect across app nodes.
6. S3 signed upload/download/import/export/media preview, exact origin CORS, IAM credential refresh if implemented.
7. Campaign/automation/import job durability and duplicate/retry behavior with a worker restart.
8. Ledger/reservation/idempotency, provider-cost confidentiality and commercial operations audit.
9. Connector authorization/refresh/revoke and explicit Google contact export on nonproduction provider accounts.
10. Backups and tested restore, alert delivery, logs/redaction and capacity/load validation.
11. Public API-key scope/tenant boundaries and platform isolation.
12. Subscription rollout remains disabled; no prices/tax/gateway/promo consumption policies invented.

The existing `pnpm smoke` always calls the development system.ping endpoint. It cannot pass unchanged with the required SYSTEM_PING_ENABLED=false; do not temporarily expose that endpoint to make production smoke green. Use safe health checks plus an authenticated staging user workflow with observed outbox processing. Prepare a production-safe smoke procedure before launch.

Release updates: test the exact artifact in staging, snapshot/backup as appropriate, serialize compatible migration, drain targets/gracefully stop workers, update release symlinks, start/check processes and restore traffic. Older app artifacts are a rollback option only while compatible with the new schema/events; database rollback is not automatic. Avoid reversing financial migrations/history. Preserve keys/config between releases.

## 12. What is ready versus preparation still required

Ready in application code: separate web/API/worker entrypoints, standalone frontend output, runtime env validation, S3-compatible storage, SMTP email, PostgreSQL/Redis integration, graceful shutdown hooks, readiness/metrics, narrow system gateways, platform auth/audit, and durable worker infrastructure.

Still required for this AWS/non-Docker target: confirmed AWS account/domain/region/capacity, EC2/systemd provisioning, managed-service bootstrap and TLS verification, preferred S3 instance-role support (or consciously managed scoped static credentials), secure secret injection/rotation, native Linux artifact pipeline, ingress routing and no-secret access logging, production-safe smoke and AWS backup/restore, real Meta/SES/OAuth provider configuration, and staging failover/load/security acceptance. A local Docker acceptance result does not certify these new AWS boundaries.

## Official references checked

- [Node release support](https://nodejs.org/en/about/previous-releases)
- [RDS administrative role restrictions](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)
- [RDS TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html)
- [Prisma 6 PostgreSQL connection/TLS options](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql)
- [BullMQ ElastiCache requirements](https://docs.bullmq.io/guide/redis-tm-hosting/aws-elasticache)
- [ALB WebSockets](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html)
- [EC2 instance-profile credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html)
- [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
- [S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html)
- [SES SMTP](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html)
- [SES TLS ports](https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html)
- [SSM host access](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- [RDS backup retention](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)
