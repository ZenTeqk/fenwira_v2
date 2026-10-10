# Phase 3A: production configuration and database bootstrap

10 October 2026.
- **Infrastructure used:** the Terraform-provisioned infrastructure only (Phase 2).
- **Not done in this phase:** the application was not deployed or started, no migrations ran, there was no DNS or certificate work, and no Terraform apply. No secret value appears in this document, logs or command output.

## 1. Database bootstrap

`deploy/sql/bootstrap-roles.sql` was validated first. It is semantically identical to `infrastructure/docker/postgres/init/01-roles.sh`, plus the RDS-required `GRANT fenwira_owner TO CURRENT_USER`. It was then run once:
- **As:** the RDS master user, through an SSM port-forwarding tunnel.
- **TLS:** `sslmode=verify-full` against the RDS global CA bundle, with `hostaddr` so the certificate name is verified through the tunnel.
- **Passwords:** the role passwords were passed as **SCRAM-SHA-256 verifiers** computed locally. Plaintext passwords never reached the server or its logs.

The first attempt failed at connection time ("server closed the connection"), before authentication, so nothing executed. The SSM tunnel needed a few more seconds to establish. The retry succeeded on every statement:

```
CREATE ROLE ×3, GRANT ROLE ×2, CREATE DATABASE fenwira, REVOKE/GRANT on the database,
ALTER SCHEMA public OWNER, REVOKE CREATE ON public, CREATE EXTENSION citext, pg_trgm,
CREATE SCHEMA system, GRANT ×2
```

## 2. Roles and RLS verification

| Role | Login | BYPASSRLS | Create role / DB | Memberships |
| --- | --- | --- | --- | --- |
| `fenwira_app` (runtime) | yes | **no** | no / no | none |
| `fenwira_owner` (migrations, schema owner) | yes | no | no / no | `fenwira_system` (inherit, set) |
| `fenwira_system` (owner of SECURITY DEFINER system functions) | **no** | **yes** | no / no | none |
| `fenwira_admin` (RDS master) | yes | no | yes / yes | `rds_superuser`, `fenwira_owner` |

- **Ownership:** database `fenwira` is owned by `fenwira_owner`, with `datacl` `{fenwira_owner=CTc, fenwira_app=Tc}` and no PUBLIC access. Schemas `public` and `system` are owned by `fenwira_owner`.
- **Schema privileges:** the app has USAGE only. `fenwira_system` has USAGE and CREATE on `system`. CREATE on `public` is revoked from PUBLIC.
- **Settings:** extensions citext 1.6 and pg_trgm 1.6; 0 tables (no migrations yet); `password_encryption = scram-sha-256`; `ssl = on`; `max_connections = 79`.

**Functional RLS test.** It ran inside `fenwira`, in one transaction that was **rolled back**, with 0 leftover objects or grants verified afterwards:

| Check | Result |
| --- | --- |
| App, tenant A context, `FORCE ROW LEVEL SECURITY` table | 1 row visible; tenant B rows: 0 |
| App, no tenant context | 0 rows |
| App inserts a tenant B row while in tenant A | `new row violates row-level security policy` |
| App sets `row_security = off` | `query would be affected by row-level security policy` (refused) |
| App creates a table | `permission denied for schema public` |
| SECURITY DEFINER function owned by `fenwira_system`, executed by the app | 2 rows (cross-tenant, by design) |

**Real logins** (credentials from SSM, through the tunnel):

| Check | Result |
| --- | --- |
| `fenwira_app` login, `verify-full` | connected, TLS 1.3 |
| `fenwira_owner` login, `verify-full` | connected, TLS |
| App `SET ROLE fenwira_owner` / `fenwira_system` | `permission denied to set role` (both) |
| App CREATE in `public` / in `system` / CREATE DATABASE | permission denied (all three) |
| `sslmode=disable` | rejected by RDS (`no pg_hba.conf entry … no encryption`) |
| Wrong CA | `certificate verify failed` |
| Hostname not in the certificate | `server certificate … does not match` |
| Wrong password | `password authentication failed` |
| `fenwira_system` login | refused |

## 3. Production configuration readiness

| Variable | Source | Status |
| --- | --- | --- |
| `DATABASE_URL` | SSM `secrets/database-url-app` (verified TLS, `connect_timeout=10`, `pool_timeout=10`) | ✅ |
| `MIGRATION_DATABASE_URL` | SSM `secrets/database-url-migrate` | ✅ |
| `ENCRYPTION_KEYS`, `ENCRYPTION_ACTIVE_KEY_ID` | SSM `secrets/encryption-keys`, `secrets/encryption-active-key-id` | ✅ new (no existing v2 production data) |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | SSM `secrets/jwt-*` (Ed25519, same format as `pnpm setup:env`) | ✅ new |
| `API_KEY_PEPPER` | SSM `secrets/api-key-pepper` | ✅ new |
| `META_WEBHOOK_VERIFY_TOKEN` | SSM `secrets/meta-webhook-verify-token` (ours to choose; entered in the Meta console later) | ✅ new |
| `REDIS_URL` | fixed: `redis://127.0.0.1:6379/0` | ✅ |
| `S3_*` | SSM `config/s3-*`, `config/aws-region`. Access keys **unset** (instance role) | ✅ |
| `WEB_ORIGIN`, `PUBLIC_API_URL`, `COOKIE_DOMAIN`, `NEXT_PUBLIC_API_URL` | `https://app.fenwira.zenteqk.com`, `https://api.fenwira.zenteqk.com`, `.fenwira.zenteqk.com`, `…/api/v1` (build-time) | ✅ |
| `HOST`, `WORKER_HEALTH_HOST`, `METRICS_HOST`, `HOSTNAME`, `TRUST_PROXY`, `COOKIE_SECURE`, `NODE_ENV`, ports | fixed production values (`deploy/env/*.example`) | ✅ |
| `META_APP_ID`, `META_APP_SECRET`, `META_ES_CONFIG_ID` | **must come from the Meta app (you)** | ❌ missing |
| `SMTP_URL`, `MAIL_FROM` | **email provider not chosen** (the worker env schema requires both) | ❌ missing |
| `NATIVE_{GOOGLE,ZOHO,SHOPIFY}_CLIENT_{ID,SECRET}` | optional: only for connectors to be enabled | ⏳ optional |
| `OPS_ALERT_EMAIL`, `BILLING_SUPPORT_EMAIL/URL` | optional | ⏳ optional |
| `BILLING_ENFORCED`, `BILLING_SUBSCRIPTIONS_ENFORCED`, trial/credit values | business decision (defaults off) | ⏳ decision |
| `APP_VERSION` | release SHA at deploy | at deploy |

Generated secrets were never reused from development (`.env`, `.env.test`, test containers).

## 4. SSM status

- **Config:** 13 non-secret String parameters under `/fenwira/prod/config/` (Terraform).
- **Secrets:** 8 SecureString parameters under `/fenwira/prod/secrets/` (manual, version 1, `aws/ssm`).
- **Instance access:** the instance role reads and decrypts all 21. It can't write parameters, can't read the RDS master secret in Secrets Manager, and can't change live Route 53 records.

## 5. Connection budget (`max_connections` = 79; 3 superuser-reserved)

The code opens **one Prisma pool per process** (`Database.connect`, `connection_limit = DB_POOL_SIZE`). The worker adds **one** dedicated `pg` client for the outbox relay. Migrations use the Prisma CLI plus one `pg` client.

| Consumer | Connections |
| --- | ---: |
| API (`DB_POOL_SIZE=10`) | 10 |
| Worker (`DB_POOL_SIZE=10`) + outbox relay | 11 |
| Migrations (during deploys only) | ~4 |
| Operator CLIs (`replay-dlq` pool 2; others use the Prisma default pool of 5 on 2 vCPU) | ≤ 5 |
| Admin / `psql` / RDS internal | ~3 |
| **Steady / peak** | **~21 / ~33** of 76 |

Recommendations:
- Keep `DB_POOL_SIZE=10` for both processes, with `connect_timeout=10` and `pool_timeout=10` (already in the stored URL).
- **Proposed, not applied:** per-role caps `ALTER ROLE fenwira_app CONNECTION LIMIT 40` and `fenwira_owner CONNECTION LIMIT 10`, so the application can never take the slots needed for administration and migrations. Also consider `idle_in_transaction_session_timeout = '60s'` for `fenwira_app`.
- No PgBouncer.

## 6. S3 instance-role verification

These were run on the instance as `assumed-role/zenteqk-internal-fenwira-v2-prod-ec2`:
- **Allowed:** list, put, get and delete in **media, imports and exports**.
- **Denied:** the v1 bucket (`zenteqk-internal-fenwira-prod-site`), the Terraform state bucket, and `s3:DeleteObjectVersion` (confirmed with the IAM policy simulator).

All test objects, versions and delete markers were removed afterwards (0 left).

## 7. Findings

1. **SSM least privilege.** AWS-managed `AmazonSSMManagedInstanceCore`, required for Session Manager, allows `ssm:GetParameter(s)` on **every** parameter. With `kms:Decrypt` on `aws/ssm`, the instance could read other applications' SecureStrings in this account and region. Today the only other parameter is `DB_NAME`, a plain String.
   - **Fixed in code, not applied:** an explicit Deny for parameter reads outside `/fenwira/prod/*` (`iam.tf`, `DenyParametersOutsideFenwira`).
2. **CloudWatch agent EMF listener.** It listened on `*:25888` (TCP and UDP). It's now bound to **UDP 127.0.0.1:25888** through a local agent override file (`/opt/aws/amazon-cloudwatch-agent/etc/fenwira-agent-extra-loopback.json`), and Redis metrics are verified flowing.
   - **The same setting is coded in `ssm.tf`, not applied.** After the next approved apply, re-run the agent `fetch-config` / `append-config` from SSM and delete the override file.
   - Pending Terraform plan: **0 to add, 2 to change, 0 to destroy** (the IAM inline policy and the agent parameter).
3. **AWS CLI on the instance.** Canonical's AMI ships without it, so `aws-cli` (snap, Canonical-signed) was installed through Run Command and added to the bootstrap template for rebuilds.

## 8. Import retention

If an import stays unconfirmed for more than 7 days, its file is gone:
- `confirm` still moves the job to `IMPORTING`;
- the worker's S3 read fails with `NoSuchKey`;
- after the retries, the job is `FAILED` with the raw S3 message ("The specified key does not exist.").

No rows are written and nothing crashes, but the message is technical and the user's mapping work is lost. **Behaviour unchanged.**

Recommended options (product decision):
- (a) refuse confirmation of imports older than 7 days, with a clear "upload again" message;
- (b) lengthen the imports lifecycle, for example to 14–30 days, and align `DATA_RETENTION.md`;
- (c) map `NoSuchKey` to a friendly failure reason.

## 9. Email (SES deferred)

- **Startup:** **does not block startup or readiness.** The worker validates that `SMTP_URL` and `MAIL_FROM` are set and well-formed. Nodemailer connects lazily, and there is no SMTP health check. The API needs no SMTP.
- **Flows:** **does block real use:**
  - workspace creation requires a verified email (`EMAIL_NOT_VERIFIED`);
  - verification, password-reset and invitation emails can't be delivered;
  - notifications and operational alerts can't be sent.
- **Safe options** (none applied):
  - (a) choose a provider before go-live: SES (already has production access in ap-south-1) or another SMTP provider. Store `smtp-url` and `mail-from` as SecureStrings;
  - (b) for a closed pre-launch only: an operator verifies specific invited test users by an audited, documented procedure. Verification is never disabled globally.
