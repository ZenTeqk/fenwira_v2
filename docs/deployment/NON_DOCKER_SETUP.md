# Native setup on Ubuntu 24.04 (no Docker)

How to install and run Fenwira on one Ubuntu 24.04 LTS x86_64 server. These are the steps that were validated (VALIDATION_REPORT.md).

- **Covered here:** everything on the server.
- **Phase 2 (Terraform):** provisioning AWS itself: EC2, the RDS instance, S3 buckets, the SES identity, IAM, DNS and SSM.
- **Architecture and runtime behaviour:** [PRODUCTION_RUNTIME.md](PRODUCTION_RUNTIME.md).

## 1. Prerequisites

| Need | Version / source |
| --- | --- |
| OS | Ubuntu 24.04 LTS, x86_64 |
| Node.js | 22.x LTS (`.nvmrc`), installed at `/usr/bin/node`. Use the NodeSource 22.x apt repository, or the official tarball with its SHA-256 verified |
| pnpm | 10.34.5 (`npm i -g pnpm@10.34.5`). Needed only on the machine that **builds** |
| Packages | `nginx` (1.24 from Ubuntu), `redis-server` (7.0), `curl`, `git`, `openssl`, `postgresql-client` (for bootstrap and `psql` only) |
| AWS | RDS PostgreSQL 16 endpoint with the RDS CA bundle, an S3 bucket per purpose, SES SMTP credentials, and an instance role with access to the buckets |

```sh
sudo apt-get update && sudo apt-get install -y nginx redis-server curl git openssl postgresql-client
sudo useradd --system --home /opt/fenwira --shell /usr/sbin/nologin fenwira
sudo mkdir -p /opt/fenwira/releases /etc/fenwira /var/www/letsencrypt
sudo curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /etc/fenwira/rds-global-bundle.pem
# Prisma reads only the first certificate of sslcert: extract the single root for the region
sudo awk -v dir=/tmp/rdsca '/BEGIN CERT/{n++} {print > (dir "-" n ".pem")}' /etc/fenwira/rds-global-bundle.pem
for c in /tmp/rdsca-*.pem; do
  openssl x509 -in "$c" -noout -subject -nameopt oneline | grep -q 'CN = Amazon RDS ap-south-1 Root CA RSA2048 G1,' \
    && sudo install -m 0644 "$c" /etc/fenwira/rds-ca-ap-south-1-rsa2048-g1.pem
done; sudo rm -f /tmp/rdsca-*.pem
```

## 2. Database bootstrap (one time, from any machine that can reach RDS)

```sh
psql "host=<rds-endpoint> dbname=postgres user=<master> sslmode=verify-full sslrootcert=/etc/fenwira/rds-global-bundle.pem" \
  -v owner_pw='<owner password>' -v app_pw='<app password>' -v db=fenwira \
  -f deploy/sql/bootstrap-roles.sql
```

**Check first** that the `CREATE ROLE fenwira_system … BYPASSRLS` statement succeeds on RDS. If RDS refuses it, stop and escalate.

`psql` (libpq) rejects Prisma's `sslaccept` parameter, so don't paste `DATABASE_URL` into `psql`. Use the libpq form above.

## 3. Build a release (Ubuntu x86_64 only)

Prisma generates the query engine for the build machine, so release artifacts **must** be built on Ubuntu Linux x86_64: this server, a separate builder or a CI runner. The script refuses any other platform.

```sh
git clone <repo> /srv/fenwira-src && cd /srv/fenwira-src && git checkout <tag>
NEXT_PUBLIC_API_URL=https://api.fenwira.zenteqk.com/api/v1 \
  deploy/scripts/build-release.sh <tag> /opt/fenwira/releases/<tag>
```

- **`NEXT_PUBLIC_API_URL`:** compiled into the browser bundle, so rebuild if it changes.
- **What the script does:** installs with the frozen lockfile, builds web, API, worker and their packages, assembles the Next.js standalone server (static assets, `public`, a writable `.next/cache`), prunes to production dependencies, regenerates the Prisma client, and runs `verify-build.sh`.
- **Memory:** building on the live 4 GB instance competes with the running services (RESOURCE_BUDGET.md). Prefer a separate builder.

## 4. Configuration

**AWS production (Terraform-provisioned server):** render the env files from SSM Parameter Store with the instance role. The script prints file and variable names only, never values, and exits with code 3 when a required value is missing (today: `SMTP_URL` and `MAIL_FROM`, so the worker env is incomplete):

```sh
sudo env PATH=/snap/bin:$PATH AWS_REGION=ap-south-1 \
  /opt/fenwira/current/deploy/scripts/render-env-from-ssm.py --release "$(basename "$(readlink /opt/fenwira/current)")"
for s in api worker web migrate; do sudo /opt/fenwira/current/deploy/scripts/check-env.sh $s /etc/fenwira/$s.env /opt/fenwira/current; done
```

Sources: `/fenwira/prod/config/*` (Terraform) and `/fenwira/prod/secrets/*` (SecureStrings created out of band, see infra/terraform/README.md → Credentials). Re-run it after any parameter change, then restart the affected services.

**Any other server:** copy the templates and fill them in by hand:

```sh
sudo cp deploy/env/api.env.example     /etc/fenwira/api.env      # then fill in every <placeholder>
sudo cp deploy/env/worker.env.example  /etc/fenwira/worker.env
sudo cp deploy/env/web.env.example     /etc/fenwira/web.env
sudo cp deploy/env/migrate.env.example /etc/fenwira/migrate.env
sudo chown root:fenwira /etc/fenwira/{api,worker,web}.env && sudo chmod 0640 /etc/fenwira/{api,worker,web}.env
sudo chmod 0600 /etc/fenwira/migrate.env
for s in api worker web migrate; do sudo deploy/scripts/check-env.sh $s /etc/fenwira/$s.env /opt/fenwira/releases/<tag>; done
```

Generate the secrets with `pnpm setup:env` on a workstation and copy the values. Never reuse development values. [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) lists every variable.

## 5. Redis

```sh
sudo install -m 0644 deploy/redis/fenwira-redis.conf /etc/redis/fenwira-redis.conf
echo 'include /etc/redis/fenwira-redis.conf' | sudo tee -a /etc/redis/redis.conf
sudo systemctl enable --now redis-server && sudo systemctl restart redis-server
redis-cli config get maxmemory-policy        # noeviction
```

## 6. Migrations (before every release switch)

```sh
sudo deploy/scripts/migrate.sh /opt/fenwira/releases/<tag> /etc/fenwira/migrate.env
```

These run only `prisma migrate deploy` (pending migrations), the idempotent `post-migrate.sql`, the RLS check and the seeds. Rerunning is a no-op. The services never migrate.

## 7. systemd

```sh
sudo cp deploy/systemd/fenwira-{api,worker,web}.service deploy/systemd/fenwira.target /etc/systemd/system/
sudo ln -sfn /opt/fenwira/releases/<tag> /opt/fenwira/current
sudo chown -R fenwira:fenwira /opt/fenwira/current/apps/web/.next/standalone/apps/web/.next/cache
sudo systemctl daemon-reload
sudo systemctl enable --now fenwira.target
deploy/scripts/check-health.sh all 120
```

## 8. nginx and certificates

1. **Point DNS** for `app.` and `api.` at the instance's Elastic IP.
2. **Get certificates.** With HTTP-01 through the ACME webroot: `sudo apt install certbot`, then `sudo certbot certonly --webroot -w /var/www/letsencrypt -d app.fenwira.zenteqk.com -d api.fenwira.zenteqk.com`. A temporary HTTP-only server block is needed for the very first issuance: comment out the 443 blocks, or run `certbot --standalone` before nginx starts.
3. **Render and install:**

```sh
deploy/scripts/render-nginx.sh --out /tmp/fenwira-nginx \
  --app-domain app.fenwira.zenteqk.com --api-domain api.fenwira.zenteqk.com \
  --app-cert /etc/letsencrypt/live/app.fenwira.zenteqk.com/fullchain.pem --app-key /etc/letsencrypt/live/app.fenwira.zenteqk.com/privkey.pem \
  --api-cert /etc/letsencrypt/live/app.fenwira.zenteqk.com/fullchain.pem --api-key /etc/letsencrypt/live/app.fenwira.zenteqk.com/privkey.pem
sudo cp /tmp/fenwira-nginx/sites-available/*.conf /etc/nginx/sites-available/
sudo cp /tmp/fenwira-nginx/snippets/*.conf /etc/nginx/snippets/
sudo cp /tmp/fenwira-nginx/conf.d/*.conf /etc/nginx/conf.d/
sudo ln -sf /etc/nginx/sites-available/fenwira-{app,api,default}.conf /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/fenwira-bootstrap.conf   # older first-boot holding site, if present
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
deploy/scripts/validate-templates.sh /opt/fenwira/current
```

4. **Set up Meta:** set the webhook callback to `https://api.fenwira.zenteqk.com/api/v1/webhooks/whatsapp` with `META_WEBHOOK_VERIFY_TOKEN`.

## 9. Updating

### Continuous deployment (AWS production)

A merged pull request on `main` that changes application or deployment code runs `.github/workflows/deploy.yml`. Changes only under `infra/`, `docs/` or to Markdown files never deploy. Pull requests and other branches only run `ci.yml`, and CI never runs Terraform.

1. **Build:** on a GitHub-hosted `ubuntu-24.04` runner, `build-release.sh <sha>` builds the committed commit, and `verify-build.sh` checks the result. No AWS credentials exist during the build.
2. **Authenticate:** GitHub OIDC → role `zenteqk-internal-fenwira-v2-prod-github-deploy`. Only this repository's `main` branch can assume it (`infra/terraform/cicd.tf`). The role can upload to `imports/_deploy-artifacts/`, run one SSM document on this one instance, and read the command result. Nothing else.
3. **Deliver:** SSM document `zenteqk-internal-fenwira-v2-prod-deploy` downloads the tarball and verifies its SHA-256, then extracts it to `/opt/fenwira/releases/<git-sha>`. Release directories are immutable.
4. **Activate:** the release's `deploy/scripts/deploy-release.sh` runs:
   1. renders the env files from SSM into a staging directory;
   2. runs `check-env` for every **enabled** service and for migrate;
   3. runs `migrate.sh`;
   4. backs up the env files and switches `current`;
   5. restarts the enabled services;
   6. runs `check-health.sh`.

   A disabled worker is never started or enabled.
5. **Failures:**
   - **Before the switch** (for example, a failed migration): the running release is untouched. Migrations are never rolled back automatically.
   - **Failed health checks after the switch:** the previous release and its env files are restored and restarted.
   - **Either way:** the workflow fails and shows the server output.
6. **Retention:** the 5 newest releases are kept; current and previous are never pruned. Artifacts expire from the bucket after 7 days.

**Manual rollback** to a release still on the server. Don't re-run `deploy-release.sh` for an older release: it would re-apply that release's older `post-migrate.sql`. Switch, re-render and restart without migrations:

```sh
R=/opt/fenwira/releases/<sha>
sudo ln -sfn "$R" /opt/fenwira/current.new && sudo mv -T /opt/fenwira/current.new /opt/fenwira/current
sudo env PATH=/snap/bin:$PATH AWS_REGION=ap-south-1 "$R/deploy/scripts/render-env-from-ssm.py" --release <sha>
sudo systemctl restart fenwira-api fenwira-web && "$R/deploy/scripts/check-health.sh" api 90 && "$R/deploy/scripts/check-health.sh" web 90
```

### Manual update

1. Build the new tag into a new release directory.
2. Run `check-env.sh`.
3. Run `migrate.sh <new release>`.
4. `ln -sfn <new release> /opt/fenwira/current`.
5. `systemctl restart fenwira.target`.
6. `check-health.sh all 120`.

To roll back, point `current` at the previous release and restart. This is safe for additive migrations only.

## 10. Operating

| Task | Command |
| --- | --- |
| Logs | `journalctl -u fenwira-api -f`, or `-o cat \| jq` for JSON |
| Status, memory | `systemctl status fenwira-worker` |
| Restart one | `sudo systemctl restart fenwira-web` |
| Dead-letter replay | `cd /opt/fenwira/current && sudo -u fenwira node --env-file=/etc/fenwira/worker.env apps/worker/dist/cli/replay-dlq.js` |
| Operator CLIs | the same pattern with `apps/worker/dist/cli/{wallet-credit,subscription-activate,entitlement-override,billing-mode}.js` |

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| A service exits at once listing `ENV_NAME: …` | Invalid environment. Run `check-env.sh` |
| `Error opening a TLS connection: … not trusted` (Prisma) | Wrong or missing CA in `sslcert`, or connecting by IP. Use the RDS **DNS endpoint**; `sslcert` must be the single region root, not the bundle |
| `P1011 … self-signed certificate in certificate chain` (Prisma) | `sslcert` points at the global bundle: Prisma reads only its first (other-region) certificate. Use `/etc/fenwira/rds-ca-<region>-rsa2048-g1.pem` |
| `Hostname/IP does not match certificate's altnames` (migrations) | You connected by IP or a CNAME not in the certificate. Use the RDS endpoint |
| `/health/ready` 503 with `"error":"unavailable"` | The real reason is in the journal: `journalctl -u fenwira-api -n 50` |
| Web listens on the wrong address when started by hand | `node --env-file` never overrides inherited variables, and shells export `HOSTNAME`. Start through systemd, or use `env -i` |
| `pkill node` leaves the web server running | Next.js renames its process to `next-server`. Use `systemctl stop` |
| `unknown directive "http2"` from nginx | Template older than this release. Ubuntu's nginx 1.24 needs `listen 443 ssl http2` |
| Redis `OOM command not allowed` | `maxmemory` reached under `noeviction`. Investigate the backlog (`redis-cli info memory`, failed-job counts) before raising the cap |
| Unit stuck "start-limit-hit" | 10 crashes in 5 minutes: fix the cause, then `systemctl reset-failed fenwira-api` |

## Local development

**Docker Compose is unchanged and stays the development environment:** `cp .env.example .env && docker compose up -d --wait`. The new variables (`HOST`, `WORKER_HEALTH_HOST`, `METRICS_HOST`) default to `0.0.0.0`, and the MinIO keys keep working.

**To run a single service natively against the Compose dependencies, for debugging only:**
- **Prerequisite:** Postgres and Redis must be reachable from the host. Compose doesn't publish them, so add a private `docker-compose.override.yml` publishing `127.0.0.1:5432` / `127.0.0.1:6379`.
- **Build and run:**
  1. `pnpm turbo run build --filter=@fenwira/api...`
  2. `node --env-file=<private env file> apps/api/dist/main.js`
- **Values in the env file:** the same names as above, with URLs pointing at `127.0.0.1` and the MinIO and Mailpit ports.
- **Warning:** use a separate Redis database index (for example `/3`), so the native worker doesn't consume the Compose worker's jobs.
