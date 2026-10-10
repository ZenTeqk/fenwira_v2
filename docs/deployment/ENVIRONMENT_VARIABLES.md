# Environment variables (native production)

The single source of truth is the Zod schemas in [`packages/config/src/env.ts`](../../packages/config/src/env.ts) (API, worker, migrations) and [`apps/web/lib/env.ts`](../../apps/web/lib/env.ts) (web). Every service validates its environment at startup and exits with a list of the invalid variable names. Values are never printed.

The same variables are used in Docker Compose (`docker-compose.yml` + `.env`) and natively. Only where they come from differs:
- **Natively:** systemd reads `EnvironmentFile=/etc/fenwira/<service>.env`. The templates are [`deploy/env/*.env.example`](../../deploy/env/).
- **Later:** AWS SSM Parameter Store will write these same files (Phase 2). The application doesn't change.

```sh
deploy/scripts/check-env.sh api /etc/fenwira/api.env /opt/fenwira/current      # same for worker, web, migrate
```

On top of the schema, `check-env.sh` checks the following when `NODE_ENV=production`:
- **Bind addresses:** the API and the worker health endpoint bind to loopback.
- **No Docker hostnames:** no URL points at a Compose hostname.
- **Redis:** remote Redis uses TLS.
- **Database:** a remote database URL uses verified TLS.
- **File permissions:** the env file isn't world-readable.

## Never commit

Database passwords, `ENCRYPTION_KEYS`, JWT keys, `API_KEY_PEPPER`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, OAuth client secrets, SMTP credentials and Redis passwords. `.gitignore` excludes `.env`, `.env.*` and `deploy/env/*.env`. Only `*.example` templates are tracked.

## Shared by API and worker

| Variable | Required | Default | Production value / notes |
| --- | --- | --- | --- |
| `NODE_ENV` | — | `development` | `production`. This turns on the production-only refusals listed under API |
| `APP_VERSION` | — | `dev` | Git SHA of the release |
| `LOG_LEVEL` | — | `info` | `info` (`debug` only temporarily) |
| `DATABASE_URL` | yes | — | `fenwira_app` role. RDS: `…?sslmode=require&sslaccept=strict&sslcert=<region root>&sslrootcert=<global bundle>` (see PRODUCTION_RUNTIME → Database TLS) |
| `DB_POOL_SIZE` | — | 10 | Per process. See RESOURCE_BUDGET |
| `REDIS_URL` | yes | — | `redis://127.0.0.1:6379/0` (add `:<password>@` if `requirepass` is set) |
| `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_ID` | yes | — | AES-256-GCM key ring for secrets at rest. Must be identical in API and worker |
| `S3_ENDPOINT` | yes | — | `https://s3.<region>.amazonaws.com` |
| `S3_PUBLIC_ENDPOINT` | — | = `S3_ENDPOINT` | Unset on AWS (it's only needed for MinIO behind Docker) |
| `S3_REGION` | — | `us-east-1` | Bucket region |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | pair or neither | unset | **Unset on EC2**: the SDK uses the instance role. Setting only one of the two is refused |
| `S3_FORCE_PATH_STYLE` | — | `true` | `false` for AWS |
| `S3_BUCKET_MEDIA/UPLOADS/IMPORTS/EXPORTS` | — | `fenwira-*` | Your bucket names |
| `META_APP_ID`, `META_APP_SECRET` | — | unset | Real Meta app. The secret also verifies webhook signatures |
| `META_GRAPH_BASE_URL` | — | `https://graph.facebook.com` | Keep the default |
| `META_GRAPH_API_VERSION` | — | `v23.0` | |
| `NATIVE_{GOOGLE,ZOHO,SHOPIFY}_CLIENT_{ID,SECRET}` | — | unset | OAuth connectors. Unset means "setup required" |
| `BILLING_ENFORCED`, `BILLING_SUBSCRIPTIONS_ENFORCED` | — | `false` | Business decisions |
| `BILLING_TRIAL_DAYS`, `BILLING_TRIAL_PLAN`, `TRIAL_CREDIT_MINOR`, `BILLING_LOW_BALANCE_THRESHOLD_MINOR`, `BILLING_SUPPORT_EMAIL`, `BILLING_SUPPORT_URL` | — | 14, `GROWTH`, 0, 10000, unset | See docs/BILLING.md |
| `NODE_OPTIONS` | — | — | Heap ceiling, e.g. `--max-old-space-size=512` (RESOURCE_BUDGET) |

## API only

| Variable | Required | Default | Production value / notes |
| --- | --- | --- | --- |
| `HOST` | — | `0.0.0.0` | **`127.0.0.1`** (nginx proxies) |
| `PORT` | — | 4000 | |
| `WEB_ORIGIN` | yes | — | `https://app.fenwira.zenteqk.com`. Used for CORS, CSRF and Socket.IO origin |
| `PUBLIC_API_URL` | — | unset | `https://api.fenwira.zenteqk.com` |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | prod | generated per boot | Ed25519 PEM (base64). **Required in production** |
| `COOKIE_SECURE` | — | `false` | **`true`** (required in production) |
| `COOKIE_DOMAIN` | — | unset | `.fenwira.zenteqk.com` (shared by `app.` and `api.`) |
| `TRUST_PROXY` | — | 0 | **`1`**: exactly one hop (nginx). Never higher than the real number of proxies |
| `API_KEY_PEPPER` | prod | dev value | Random secret of at least 16 characters (the dev value is refused in production) |
| `API_KEY_RATE_LIMIT_PER_MINUTE` | — | 120 | |
| `META_WEBHOOK_VERIFY_TOKEN`, `META_ES_CONFIG_ID` | — | unset | Webhook handshake / Embedded Signup |
| `WHATSAPP_DEV_CONNECT` | — | `false` | Must be `false` (refused in production) |
| `SYSTEM_PING_ENABLED` | — | `false` | Must be `false` (refused in production) |
| `AUTOMATION_WEBHOOK_DEV_HOSTS` | — | empty | Must be empty in production |
| `METRICS_PORT`, `METRICS_HOST` | — | off, `0.0.0.0` | If enabled: `127.0.0.1` |

## Worker only

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `WORKER_HEALTH_HOST` | — | `0.0.0.0` | **`127.0.0.1`** |
| `WORKER_HEALTH_PORT` | — | 4100 | Never proxied by nginx |
| `WEB_ORIGIN` | yes | — | Links in emails |
| `SMTP_URL` | yes | — | SES: `smtps://<user>:<url-encoded password>@email-smtp.<region>.amazonaws.com:465`. Locally: `smtp://fenwira-mailpit:1025` |
| `MAIL_FROM` | yes | — | A verified SES identity, e.g. `Fenwira <no-reply@<verified sending domain>>` |
| `OPS_ALERT_EMAIL` | — | unset | Operational alerts. Unset means they're only logged |
| `OUTBOX_POLL_INTERVAL_MS` | — | 250 | |
| `WHATSAPP_SYNC_INTERVAL_HOURS`, `WHATSAPP_OUTBOUND_BACKOFF_MS`, `CAMPAIGN_BATCH_SIZE` | — | 6, 1000, 50 | |
| `BILLING_RESERVATION_GRACE_MINUTES`, `ANALYTICS_SETTLE_SECONDS` | — | 360, 20 | |
| `WEBHOOK_BACKOFF_MS`, `WEBHOOK_MAX_RETRY_HOURS`, `WEBHOOK_DISABLE_AFTER_FAILURES` | — | 30000, 24, 20 | |

## Migrations (`deploy/scripts/migrate.sh` only)

| Variable | Required | Notes |
| --- | --- | --- |
| `MIGRATION_DATABASE_URL` | yes | The `fenwira_owner` role, with the same TLS parameters as `DATABASE_URL` |

## Web

| Variable | When | Default | Production value |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **build** | `http://localhost:4000/api/v1` | `https://api.fenwira.zenteqk.com/api/v1`. Compiled into the browser bundle, so rebuild when it changes |
| `NEXT_PUBLIC_NAV_PREVIEW` | build | `false` | `false` |
| `HOSTNAME`, `PORT` | runtime | `0.0.0.0`, 3000 | `127.0.0.1`, 3000 |
| `API_INTERNAL_URL` | runtime | `http://fenwira-api:4000` (Docker) | **`http://127.0.0.1:4000`** |
| `WEB_ORIGIN` | runtime | `http://localhost:3000` | `https://app.fenwira.zenteqk.com` |
| `ENABLE_UI_GALLERY` | runtime | `false` | `false` |

## Environments

| Environment | Configuration |
| --- | --- |
| Local Docker | `.env` (copy of `.env.example`, or `pnpm setup:env`) + `docker-compose.yml`. Unchanged |
| Local native (optional) | The same variable names in a private env file. Point the URLs at locally reachable Postgres/Redis/S3/SMTP (see NON_DOCKER_SETUP → Local native run) |
| Production | `/etc/fenwira/{api,worker,web,migrate}.env` from `deploy/env/*.env.example` |
