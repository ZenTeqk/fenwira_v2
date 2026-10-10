# Phase 3B: first production deployment

10 October 2026.
- **Release:** `9471992-wt387d94657f`.
- **Status:** the API and web are running on the v2 instance. The worker is stopped (no SMTP).
- **Not done in this phase:**
  - no DNS change: `app.fenwira.zenteqk.com` still serves v1, and `api.fenwira.zenteqk.com` has no record;
  - no SES;
  - no WhatsApp traffic;
  - no commit or push.
- **Secrets:** no secret value appears in this document, logs or command output.

## 1. Terraform security corrections

Applied, with 0 added, 2 changed and 0 destroyed:
- the IAM `DenyParametersOutsideFenwira` statement;
- the CloudWatch agent extra configuration (EMF on UDP `127.0.0.1:25888`).

The instance reads only `/fenwira/prod/*`, and the local agent override file is removed.

After the deployment, a second apply enabled the availability alarms per service (0 added, 3 changed, 0 destroyed; see §8). The final plan shows **No changes**.

## 2. IAM verification

The instance role was verified on the instance:
- **Allowed:** reading and decrypting `/fenwira/prod/*`; S3 media, imports and exports.
- **Denied:** parameters outside the prefix; the RDS master secret; other buckets; `DeleteObjectVersion`; Route 53 changes other than the two `_acme-challenge` TXT records.

## 3. Database role limits

| Role | `CONNECTION LIMIT` | BYPASSRLS |
| --- | ---: | --- |
| `fenwira_app` | 40 | no |
| `fenwira_owner` | 10 | no |
| `fenwira_system` | NOLOGIN | yes (function owner only) |

## 4. Release build and install

- **Build:** off-instance, from base commit `9471992` plus the approved uncommitted changes (listed in the release `MANIFEST`).
- **Transfer:** through `imports/_deploy-artifacts/`, checksum-verified; the artifact was deleted afterwards.
- **Install:** immutable, under `/opt/fenwira/releases/`, with `current` pointing to it.
- **Env files:** rendered from SSM by `deploy/scripts/render-env-from-ssm.py`. Values are never printed.

## 5. Migrations

**First attempt** failed before any change:

```
P1011 … certificate verify failed (self-signed certificate in certificate chain)
```

- **Cause:** Prisma loads only the **first** certificate of `sslcert`, and the RDS global bundle starts with the sa-east-1 root.
- **Fix (approved):**
  - extracted the single "Amazon RDS ap-south-1 Root CA RSA2048 G1" certificate (valid until 2061; the chain verifies with code 0) to `/etc/fenwira/rds-ca-ap-south-1-rsa2048-g1.pem`;
  - pointed `sslcert` at it in both SSM URLs (now version 2);
  - kept the global bundle as `sslrootcert` for node-postgres.
- **Unchanged:** full TLS and hostname verification.
- **Same fix applied to:**
  - `check-env.mjs`, which now rejects a multi-certificate `sslcert`;
  - the first-boot script;
  - the env templates;
  - the docs (PRODUCTION_RUNTIME → Database TLS).

**Rerun** against `fenwira_owner@zenteqk-internal-fenwira-v2-prod-db…:5432/fenwira`:
- all 22 migrations applied, 0 unfinished;
- `post-migrate.sql` applied;
- RBAC seeded: 5 roles, 35 permissions, 113 grants;
- 3 plans seeded;
- **RLS check passed**.

Independent check as the master user:

| Check | Result |
| --- | --- |
| Tables | 76, all owned by `fenwira_owner` |
| RLS | 60 tenant tables enabled **and forced**; 63 policies |
| Tables without RLS | the 16 global tables only (no `tenant_id`: users, sessions, roles, plans, platform_*, …) |
| SECURITY DEFINER functions | 24, owned by `fenwira_system` |
| Runtime connection | `fenwira_app` over TLS 1.3 |

## 6. Application health

| Check | Result |
| --- | --- |
| `fenwira-api` | enabled, active. `/health/ready` 200: postgres, redis and queue up |
| `fenwira-web` | enabled, active. `/api/health` 200; `/login` and `/register` 200 |
| `fenwira-worker` | **disabled, stopped** (SMTP missing) |
| Listeners | API `127.0.0.1:4000`, web `127.0.0.1:3000`, Redis loopback; only nginx is public (80/443) |
| Memory | API ~99 MiB, web ~50 MiB; 3.0 GiB available; swap unused |
| Restart | `kill -9` on each service: restarted by systemd (`NRestarts=1`), ready again |
| Hardening | `User=fenwira`, `NoNewPrivileges`, `ProtectSystem=strict`, `MemoryMax` |

## 7. HTTPS and nginx

- **Certificate:** Let's Encrypt, issued by DNS-01 through Route 53 (TXT records only).
  - One certificate covers both names: SAN `app.fenwira.zenteqk.com` and `api.fenwira.zenteqk.com`.
  - Expires 2027-01-08.
  - `certbot.timer` is active; the deploy hook reloads nginx.
  - No email address was registered.
- **Configuration:** nginx sites rendered from `deploy/nginx`.
  - `nginx -t` passed before the reload.
  - The previous configuration is backed up under `/root/nginx-backup-*`.

Tested from outside with `curl --resolve <name>:443:15.252.206.15`. Public DNS is unchanged.

| Check | Result |
| --- | --- |
| TLS | verified, HTTP/2; HTTP redirects with 301 to HTTPS |
| App | `/login` 200; static assets 200 with `immutable` |
| Headers | HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` |
| API | `/health/ready` 200; `/api/v1/auth/me` 401; CORS preflight 204 allowing only the app origin |
| Socket.IO `/ws` | polling handshake OK; WebSocket upgrade **101** |
| Unknown host on port 80 | connection closed (`444`) |

## 8. CloudWatch

- **Alarm actions:** the availability alarms now have per-service actions (`app_alarm_services = ["api", "web"]`).
  - The api and web alarms are OK, with actions on.
  - The worker alarm is in ALARM (stopped by design) with actions off.
  - The SNS topic has no subscription yet.
- **Process metrics:** procstat `pid_count` is 1 for the API and web.
- **Logs:** api logs reach `/fenwira/v2/prod/api`; nginx and system logs also flow.
  - **Fixed:** rsyslog couldn't write `/var/log/fenwira`, which was `root:root`. It's now `syslog:adm 0750`, in the template too, and logrotate uses `su syslog adm`.
  - Web logs appear when Next.js writes any.
- **`rds-cpu-credits-low` is in ALARM:** expected for a new t4g instance, which starts with 0 credits. It's accruing at about 5–11 an hour and should clear on its own.

## 9. Missing configuration

| Item | Impact |
| --- | --- |
| `SMTP_URL`, `MAIL_FROM` | The worker can't start. With no worker, there are no emails (verification, reset, invites), no campaigns, imports, exports or webhooks, and no schedulers. Workspace creation needs a verified email |
| `META_APP_ID`, `META_APP_SECRET`, `META_ES_CONFIG_ID` | Doesn't block startup; WhatsApp Embedded Signup is unavailable |

## 10. Risks and next actions

1. **DNS cutover** needs your approval. `app.fenwira.zenteqk.com` is still v1 CloudFront, owned by the Terraform state `internal/fenwira/prod`; that state must release the record. `api.fenwira.zenteqk.com` needs a new A record pointing at 15.252.206.15.
2. **SMTP:** choose a provider and store the two SecureStrings. Then re-render the env files, enable the worker and add `worker` to `app_alarm_services`.
3. **Meta:** add the app values before onboarding real WhatsApp numbers.
4. **SNS:** subscribe an email address to the alarm topic, so alarms reach someone.
5. **Uncommitted changes:** 15 files in the repository (P1–P3, deploy, infra and docs). The release is built from the working tree, so commit before the next release for traceability.
6. **The newer `check-env.mjs` and `render-env-from-ssm.py` are not in this release.** They are installed separately under `/usr/local/lib/fenwira`; the next release will include them.
7. **Unknown-SNI HTTPS:** a request on port 443 with an unknown host name is answered by the API server block (404). Consider a `default_server` with `ssl_reject_handshake on`.
8. **`/health/ready` is public on the API host:** it exposes the release version and dependency status, with no error details.
9. **Pending decisions:** the local test containers `fenwira-ubuntu-host` and `fenwira-pg-tls` are still running; the 7-day import expiry is unchanged.
