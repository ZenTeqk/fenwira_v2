# Fenwira v2: AWS infrastructure (Terraform)

Production only, in ap-south-1 (Mumbai), in the existing ZenteqK account `569476542351`.

- **What this provisions:** the infrastructure only. It doesn't build or deploy the application.
- **How the application runs on it:** see [`docs/deployment/`](../../docs/deployment/) (Phase 1).
- **How it's applied:** manually, by an operator, never by CI.
- **Rule exception:** this directory is the only place AWS infrastructure code is allowed (AGENTS.md).

## Existing account (discovered 9 Oct 2026, read-only)

| Item | Finding | Use |
| --- | --- | --- |
| Account / profile | `569476542351`, IAM user `Admin`, CLI profile `default`. It holds the `zenteqk.com` hosted zone | `allowed_account_ids` refuses any other account |
| VPC | `vpc-038deffeecb93ad2f`, `172.31.0.0/16` (default VPC), IGW `igw-0cf7d9a6ace1b6b41`, no NAT | **Reused** (data source) |
| Public subnets | `subnet-093d33b240544d710` (1a), `subnet-05da36a15945e144f` (1b), `subnet-0a7ecf0b1e748af24` (1c): main route table `rtb-0e0415efaf8a27a95` with `0.0.0.0/0 → IGW` | EC2 in 1a. Routing re-checked by a plan-time precondition |
| Private subnets | `RDS-Pvt-subnet-1/2/3` (`subnet-0e7b3f34bcd155c26`, `-076946fc8f85daf1a`, `-0e70c07bcfec2db17`), explicitly associated with `rtb-0486643a47da69dd2` (**local route only**) | RDS. "No default route" re-checked by a precondition |
| DB subnet group | `rds-ec2-db-subnet-group-1` already spans the three private subnets (no RDS instance uses it) | Not modified. Fenwira gets its own group over the same subnets |
| EC2 | `i-0bfb6eb6021d939d7` (`telegram-controlled-instance`, t3a.large, stopped), Lenz instance profile, EIP `15.207.132.61` serving activepieces/lead/api.lenz/server.zenteqk.com | **Untouched**. Fenwira gets a dedicated instance |
| Security groups | `db-sg-1`, `rds-ec2-1`, `ec2-rds-1`, `zenteqk-internal-lenz-prod-ec2`, `default` | Not reused or modified |
| Route 53 | `zenteqk.com` (public, Route 53). `app.fenwira.zenteqk.com` A/AAAA → CloudFront `EY1203ZVXV0NP` (Fenwira v1 app), owned by state `internal/fenwira/prod`. `fenwira.zenteqk.com` A/AAAA → CloudFront `E32KM5M08KEJMY` (**Fenwira landing page**), owned by state `internal/fenwira-landing/prod`. Both use ACM certificates in us-east-1 | Reused zone (read only). No records change until the approved cutover |
| SES | ap-south-1 has production access | Domain identity `fenwira.zenteqk.com` (Easy DKIM, MAIL FROM `mail.`), SMTP-only IAM user, when `manage_ses = true` (decision 20 Oct; replaces the 9 Oct "not provisioned") |
| Terraform state | `zenteqk-platform-tfstate-shared` (us-east-1, versioned, SSE-S3, public access blocked, TLS-only). Keys: `internal/{fenwira,fenwira-landing,lenz}/prod` | **Reused** with key `internal/fenwira-v2/prod/terraform.tfstate`, S3-native locking |
| Naming | Existing convention `zenteqk-internal-<app>-prod-*`. Fenwira v1 owns `…-fenwira-prod-*` | v2 uses `zenteqk-internal-fenwira-v2-prod-*` (names verified free) |
| Availability | PostgreSQL 16.9–16.15; `db.t4g.micro` with gp3 (min 20 GB); `t3a.medium` in 1a/1b/1c; Canonical Ubuntu 24.04 amd64 AMI via SSM | As selected |

## What Terraform creates (68 resources; nothing existing is changed)

| File | Resources |
| --- | --- |
| `networking.tf` | DB subnet group (existing private subnets), Elastic IP + association |
| `security_groups.tf` | `…-ec2`: inbound 80/443 only, all outbound. `…-rds`: 5432 **from the EC2 group only**, no egress |
| `ec2.tf` | t3a.medium Ubuntu 24.04, 40 GB gp3 encrypted (aws/ebs), IMDSv2 only, **no key pair**, termination protection, EBS-optimised, `cpu_credits = standard`, gzip'd bootstrap (below) |
| `ebs.tf` | Optional daily snapshots of the root volume (DLM), **off** by default |
| `rds.tf` | PostgreSQL 16.15, db.t4g.micro, Single-AZ in 1a, 20 GB gp3 (autoscaling to 50), encrypted (aws/rds), private, `rds.force_ssl=1`, 7-day backups, deletion protection + final snapshot, **master password managed by RDS in Secrets Manager**, PostgreSQL log export |
| `iam.tf` | Instance role + profile (SSM Core; inline: 3 buckets, `/fenwira/prod/*` parameters, `kms:Decrypt` on aws/ssm via SSM only, own log groups, `CWAgent` metrics, and Route 53 **TXT changes only for `_acme-challenge.<app_domain>` and `_acme-challenge.<api_domain>`** for certbot DNS-01) |
| `s3.tf` | `…-media` (versioned, noncurrent versions expire after 30 days), `…-imports` and `…-exports` (7-day expiry). All: public access blocked, `BucketOwnerEnforced`, SSE-S3, CORS for `https://<app_domain>` PUT/GET/HEAD, TLS-only policy, abort-incomplete-multipart. **Three, not four:** `S3_BUCKET_UPLOADS` is declared in config but `StorageService` never uses it |
| `ses.tf` | SES domain identity + DKIM/MAIL FROM records + SMTP-only IAM user (no access keys in state) |
| `ssm.tf` | Non-secret String parameters under `/fenwira/prod/config/*`, and the CloudWatch agent config |
| `cloudwatch.tf` | Log groups `/fenwira/v2/prod/{api,worker,web,nginx,system}` and the RDS PostgreSQL group (30 days). SNS topic **without subscriptions** (added when `alarm_email` is provided). Alarms: EC2 system check (**auto-recover**), instance check, CPU credits, memory, disk; RDS CPU, storage, memory, credits |
| `route53.tf` | `app`/`api` A records **only when `manage_dns = true`** (after the approved cutover), with `allow_overwrite = false` |

**Bootstrap** (`templates/bootstrap.sh.tftpl`, idempotent, no secrets) installs and configures the host:
- **Packages:** Node 22 (NodeSource signed apt repo), pnpm 10.34.5, nginx, redis-server, postgresql-client, certbot + `python3-certbot-dns-route53`.
- **Host setup:** the `fenwira` user and directories, 2 GB swap (`vm.swappiness=10`), and the RDS CA bundle.
- **From `deploy/`:** the Redis config, plus the nginx snippets and a holding site (ACME challenges only; everything else gets 444). The Fenwira systemd units are installed but **not enabled or started**.
- **Logging:** journald capped at 500 MB, and rsyslog routing for the `fenwira-*` services into `/var/log/fenwira/*.log`.
- **CloudWatch agent:** reads its config from SSM.

The AMI and user data are ignored after creation, so a newer AMI never replaces the production server.

## Security

- **Access:**
  - No SSH and no port 22: shell access is SSM Session Manager.
  - The instance accepts only 80/443.
  - RDS is private and accepts PostgreSQL only from the Fenwira EC2 security group.
- **Redis:** binds to loopback only (Phase 1 config).
- **Encryption:** AWS-managed keys only: aws/ebs, aws/rds, aws/ssm (SecureStrings), aws/secretsmanager (RDS master secret) and SSE-S3. No customer-managed KMS keys.
- **Credentials on the server:** no static AWS credentials; S3 access is through the instance role (Phase 1, P2).
- **Secrets stay out of state:**
  - RDS generates the master password itself.
  - Application passwords and app secrets are created out of band as SecureStrings.
  - Terraform deliberately doesn't manage secret SSM parameters, because it would store their values in state.
- **Existing resources:** guarded by `allowed_account_ids`, data sources only, routing preconditions, and DNS records that refuse to overwrite.

## Estimated monthly cost (ap-south-1, on-demand, AWS Pricing API, 9 Oct 2026)

| Item | Basis | USD / month |
| --- | --- | ---: |
| EC2 t3a.medium | $0.0246/h × 730 | 17.96 |
| EBS gp3 40 GB | $0.0912/GB | 3.65 |
| Public IPv4 (Elastic IP, in use) | $0.005/h × 730 | 3.65 |
| RDS db.t4g.micro PostgreSQL Single-AZ | $0.021/h × 730 | 15.33 |
| RDS gp3 20 GB | $0.131/GB | 2.62 |
| RDS backups (7 days) | free up to the DB size (20 GB); $0.095/GB beyond | ~0 |
| Secrets Manager (RDS master secret) | $0.40/secret | 0.40 |
| S3 (3 buckets, low volume) | storage + requests | ~0.50 |
| CloudWatch | 10 alarms ($0.10 each beyond the free 10), 4 agent metrics ($0.30 each beyond the free 10), ~1–2 GB logs ingested | ~1–4 |
| Route 53 | existing `zenteqk.com` zone already billed; certbot DNS-01 queries negligible | ~0 |
| Data transfer out | first 100 GB/month free (account-wide), then ~$0.11/GB | ~0 at launch |
| SSM parameters (standard), AWS-managed KMS keys, SNS email | free tier / free | 0 |
| **Total** | | **≈ $45–49** before tax |

That is within the ~$60 target, but not guaranteed:
- **Burst credits:** `cpu_credits = standard` throttles rather than bills when the EC2 instance runs out of credits. The RDS db.t4g instance is always *unlimited*, so sustained CPU above its 10% baseline is billed (about $0.075 per vCPU-hour of surplus).
- **Data transfer:** grows with media traffic.
- **Free tiers:** they apply only if the account isn't already using them.

## Procedure

Prerequisites: Terraform ≥ 1.10, the `default` profile (`AWS_PROFILE=default`), and `cp terraform.tfvars.example terraform.tfvars`. Then edit the domains and `alarm_email`.

```sh
terraform fmt -check -recursive
terraform init                  # backend: shared bucket, key internal/fenwira-v2/prod (S3-native lock)
terraform validate
terraform plan -out=phase2.tfplan
```

### Gated apply (only after approval)

1. **Stage 1: the RDS privilege gate (24 resources).** Create the database and the instance needed to reach it. The EC2 egress rule is required: Terraform removes AWS's default allow-all outbound rule. The S3 buckets, log groups and SSM agent config come along because the instance role and bootstrap reference them; new buckets are private and SSE-S3 encrypted by AWS default even before stage 2 adds the explicit settings.
   ```sh
   terraform apply -target=aws_db_instance.this -target=aws_instance.app -target=aws_eip_association.app \
     -target=aws_vpc_security_group_ingress_rule.rds_from_ec2 -target=aws_vpc_security_group_egress_rule.ec2_all
   ```
   Then, on the instance (`aws ssm start-session --target <instance_id>`), run the read-only probe with the master password from Secrets Manager (`rds_master_secret_arn` output):
   ```sh
   psql "host=<rds_endpoint> dbname=postgres user=fenwira_admin sslmode=verify-full sslrootcert=/etc/fenwira/rds-global-bundle.pem" \
     -f deploy/sql/verify-rds-privileges.sql
   ```
   Every line must say `PASS`. **If any line says `FAIL`, stop and report the exact error**: no switch to self-managed PostgreSQL, no RLS policy change and no function redesign without a decision (result: see "RDS privilege gate: result" below). Nothing has been bootstrapped at that point.
2. **Stage 2 (after a passing probe and approval):** run `terraform plan` again, review it, then `terraform apply`. This creates the remaining 44 resources: S3 bucket settings, SSM config parameters, the SNS topic and alarms, and the HTTP/HTTPS ingress rules.
3. **Stage 3: DNS cutover (separate approval).** See "Domains and cutover".

### Credentials (never through Terraform)

Do everything from a trusted workstation. Write values to `chmod 600` temporary files rather than command lines, and delete them afterwards. Secrets live as **SecureString** parameters (aws/ssm) under `/fenwira/prod/secrets/`, which the instance role can read.

1. **Database roles:** open a tunnel through SSM, then bootstrap with libpq hostname verification. `hostaddr` connects to the tunnel while still verifying the RDS name:
   ```sh
   aws ssm start-session --target <instance_id> --document-name AWS-StartPortForwardingSessionToRemoteHost \
     --parameters host=<rds_endpoint>,portNumber=5432,localPortNumber=15432
   psql "host=<rds_endpoint> hostaddr=127.0.0.1 port=15432 dbname=postgres user=fenwira_admin sslmode=verify-full sslrootcert=<rds-global-bundle.pem>" \
     -v owner_pw="$(cat owner.pw)" -v app_pw="$(cat app.pw)" -v db=fenwira -f deploy/sql/bootstrap-roles.sql
   ```
2. **Secrets to create** (`aws ssm put-parameter --type SecureString --name /fenwira/prod/secrets/<name> --value file://<file>`):
   - `database-url-app`
   - `database-url-migrate`, with the TLS parameters from `deploy/env/*.env.example` and the RDS **DNS** endpoint
   - `encryption-keys`
   - `jwt-private-key`, `jwt-public-key`
   - `api-key-pepper`
   - `meta-app-secret`, `meta-webhook-verify-token`
   - `native-*-client-secret` (when used)
   - `smtp-url` (once an email provider is chosen)
3. **Env files on the instance:** render `/etc/fenwira/*.env` (root:fenwira 0640) from `/config` (String) and `/secrets` (SecureString, `--with-decryption`), then check them with `deploy/scripts/check-env.sh`. Automating this rendering belongs to the deployment phase.

### Manual steps

- **SNS:** once a recipient is provided, set `alarm_email` and confirm the subscription email.
- **Certificates (before the cutover):** `sudo certbot certonly --dns-route53 -d app.fenwira.zenteqk.com -d api.fenwira.zenteqk.com`, then render the Fenwira nginx sites. This needs no DNS change to the live records.
- **Meta:** set the webhook URL to `https://<api_domain>/api/v1/webhooks/whatsapp`.

## Domains and cutover

| Name | Role | Today | Changed by this configuration? |
| --- | --- | --- | --- |
| `fenwira.zenteqk.com` | Marketing landing page | A/AAAA alias → CloudFront `E32KM5M08KEJMY` (S3 `zenteqk-internal-fenwira-landing-prod-site`); state `internal/fenwira-landing/prod` | **Never** |
| `app.fenwira.zenteqk.com` | Next.js app | A/AAAA alias → CloudFront `EY1203ZVXV0NP` (Fenwira v1 demo); state `internal/fenwira/prod` | Only at the approved cutover |
| `api.fenwira.zenteqk.com` | NestJS API and Meta webhooks | No record | At the approved cutover: A → Elastic IP (new name, no conflict) |

Cutover sequence (each step needs approval; nothing here is automated):
1. **Before the switch:** Fenwira v2 is fully deployed and verified on the Elastic IP, with Let's Encrypt certificates for `app.` and `api.fenwira.zenteqk.com` issued through **DNS-01**. The instance role may only change the TXT records `_acme-challenge.app.fenwira.zenteqk.com` and `_acme-challenge.api.fenwira.zenteqk.com`, so no live record is touched.
2. **Release the app records:** in `internal/fenwira/prod`, release `aws_route53_record.site_a` and `site_aaaa`. Use `terraform state rm` there, or change that configuration.
3. **Remove the AAAA record for `app.`:** the instance has no IPv6, so IPv6 clients would otherwise still reach CloudFront.
4. **Switch:** set `manage_dns = true` here, then plan and apply. This creates `app.` and `api.` A records to the Elastic IP. `allow_overwrite = false` refuses if step 2 was skipped.
5. **Retire the v1 CloudFront alias later**, or roll back by restoring the alias records.

The cookie domain `.fenwira.zenteqk.com` (`COOKIE_DOMAIN` in `deploy/env/api.env.example`) covers `app.` and `api.`. Browsers also send these cookies to the landing page's CloudFront. They are `Secure` and `HttpOnly`, and the landing page is static, so nothing reads them there.

## RDS privilege gate: result (Stage 1, 10 Oct 2026)

**PASS.** On the provisioned RDS (PostgreSQL 16.15, `db.t4g.micro`), the probe was run through an SSM tunnel with `sslmode=verify-full`.

`deploy/sql/verify-rds-privileges.sql` as the master user `fenwira_admin` (`superuser=f createrole=t createdb=t bypassrls=f`):

```
PASS create owner-style role
PASS create runtime role without BYPASSRLS
PASS create BYPASSRLS role (fenwira_system model is supported)
PASS role grants (system → owner, owner → admin)
PASS extensions citext, pg_trgm
ROLLBACK
```

**This contradicted the earlier expectation.** That expectation came from two things:
- AWS's documented role list, which shows no *Bypass RLS* for the master;
- a stock PostgreSQL 16 test, which returned `42501`.

RDS evidently permits `rds_superuser` members to create `BYPASSRLS` roles, even though the master user doesn't hold the attribute itself.

**Functional confirmation:** a throwaway database and roles, removed afterwards and verified with 0 leftovers:
- A runtime-style role under `FORCE ROW LEVEL SECURITY` saw **1** row in tenant A's context and **0** with no tenant.
- A `SECURITY DEFINER` function owned by the `BYPASSRLS` role saw **2** rows, across tenants.

That is exactly the mechanism Fenwira's 25 system functions rely on. The bootstrap needs no RLS or application change for RDS.

Not yet exercised (it's part of the deployment phase): the real `bootstrap-roles.sql` (`CREATE DATABASE … OWNER fenwira_owner`, `ALTER SCHEMA public OWNER`, the `system` schema), then `migrate.sh`. The functional test did run the same statement types successfully.

## Stage 2 result (10 Oct 2026)

Applied: **52 added, 0 changed, 0 destroyed**. That is the 44 planned resources, plus 7 alarms and 1 agent parameter for the Stage 2 monitoring requirements. The configuration now manages **76 resources**, and `terraform plan` reports no changes.

**Monitoring (16 alarms; SNS topic with no subscription yet):**

| Area | Alarms (threshold) |
| --- | --- |
| EC2 | system check (auto-recover), instance check, CPU > 80% for 15 min, CPU credits < 30, memory > 85%, disk > 80% |
| RDS (`max_connections` = 79) | CPU > 80%, free storage < 3 GiB, freeable memory < 100 MiB, CPU credits < 20, connections > 60 |
| Redis | `redis_up` < 1 for 3 min (missing data = breaching), `redis_used_memory_percent` > 75% of `maxmemory` |
| Fenwira services | api, worker and web process down. **Actions enabled per service** with `app_alarm_services` (empty until deployment; the worker joins once SMTP is configured) |

How the Redis metrics work:
- **Source:** the metrics come from Redis itself (`INFO used_memory`, `PING`), published every minute by `deploy/monitoring/redis-metrics.sh` (systemd timer `fenwira-redis-metrics.timer`).
- **Delivery:** through the agent's local EMF listener, configured by `/fenwira/prod/config/cloudwatch-agent-extra`.
- **Why not process stats:** the agent runs as the unprivileged `cwagent` user and can't read Redis's `/proc/<pid>/io`, so its own process metrics were dropped. It wasn't given extra privileges.

**Changes made on the instance through SSM Run Command (no Terraform state involved):**
- **SSH:** `ssh.socket` and `ssh.service` disabled.
- **Monitoring:** the Redis metrics script and timer installed.
- **Agent:** reloaded from the two SSM parameters, with a temporary discovery config removed.

`templates/bootstrap.sh.tftpl` does the same on a rebuilt instance.

**Verified:**
- **S3 (all 3 buckets):** public access blocked, `BucketOwnerEnforced`, AES256, TLS-only (plain HTTP → 403), CORS limited to `https://app.fenwira.zenteqk.com`. Imports and exports expire after 7 days; media is versioned and only noncurrent versions expire.
- **Exposure:** from the internet only port 80 is open (holding config). 443 has no listener yet; 22, 3000, 4000, 4100, 5432, 6379, 9464 and 25888 are closed. RDS resolves privately and is unreachable.

## Required before the application deployment phase

Secrets to inject manually as `SecureString` under `/fenwira/prod/secrets/` (no values exist yet):

| Parameter | Used as |
| --- | --- |
| `database-url-app` | `DATABASE_URL` (`fenwira_app`, RDS DNS endpoint, `sslmode=require&sslaccept=strict&sslcert=/etc/fenwira/rds-ca-ap-south-1-rsa2048-g1.pem&sslrootcert=/etc/fenwira/rds-global-bundle.pem`; Prisma reads only the first certificate of `sslcert`) |
| `database-url-migrate` | `MIGRATION_DATABASE_URL` (`fenwira_owner`, same TLS parameters) |
| `encryption-keys` | `ENCRYPTION_KEYS` (and `ENCRYPTION_ACTIVE_KEY_ID`) |
| `jwt-private-key`, `jwt-public-key` | Ed25519, base64 PEM |
| `api-key-pepper` | ≥ 16 random characters |
| `meta-app-id`, `meta-app-secret`, `meta-es-config-id`, `meta-webhook-verify-token` | Meta app |
| `native-{google,zoho,shopify}-client-{id,secret}` | only for connectors being enabled |
| `smtp-url`, `mail-from` | after `terraform apply` with `manage_ses`: `deploy/scripts/ses-smtp-credentials.py --user <ses_smtp_user output> --mail-from 'Fenwira <no-reply@fenwira.zenteqk.com>'` mints the key and writes both (never printed) |

Deployment sequence:
1. Bootstrap the roles: `deploy/sql/bootstrap-roles.sql` through the SSM tunnel (`fenwira_owner` and `fenwira_app` passwords generated locally, then stored as the URLs above).
2. Build the release on Ubuntu x86_64.
3. Render `/etc/fenwira/*.env` from `/config` and `/secrets`, and run `check-env.sh`.
4. Run `migrate.sh`.
5. Enable and start `fenwira.target`, then `check-health.sh`.
6. Issue certificates with DNS-01 for `app.` and `api.fenwira.zenteqk.com`, then render the nginx sites.
7. Add each running service to `app_alarm_services` (for example `["api", "web"]`).
8. DNS cutover (separate approval).

## Static analysis

- **Results:** `terraform validate` OK, `tflint` (AWS ruleset 0.40) clean. Stage 1 applied (24 resources). The remaining plan is 44 to add, 0 to change, 0 to destroy.
- **Checkov:** 154 passed. The failed checks are accepted by design or are false positives:

| Check | Decision |
| --- | --- |
| CKV2_AWS_6, CKV2_AWS_61 (public access block, lifecycle) | False positives: both exist as separate `for_each` resources |
| CKV_AWS_145, CKV_AWS_158, CKV_AWS_26, CKV2_AWS_34 (KMS / encryption) | AWS-managed encryption by decision. The SSM parameters flagged are non-secret Strings |
| CKV_AWS_157, CKV_AWS_118, CKV_AWS_353, CKV_AWS_126 (Multi-AZ, enhanced monitoring, Performance Insights, detailed monitoring) | Cost: Single-AZ by decision. The CloudWatch agent and alarms cover monitoring |
| CKV_AWS_338 (1-year logs), CKV_AWS_18 (S3 access logs), CKV_AWS_144 (cross-region replication), CKV2_AWS_62 (S3 events) | Cost / not needed. 30-day retention |
| CKV_AWS_21 (versioning) | Imports and exports are transient (7-day expiry). Media is versioned |
| CKV_AWS_88 (public IP), CKV_AWS_260 (port 80 open) | Required: no ALB/NAT by decision. Port 80 serves only ACME and the HTTPS redirect |
| CKV_AWS_161 (RDS IAM auth) | The application authenticates with database roles |

## CI/CD separation

There are no workflows in this phase. When CD is added:
- **Terraform is never applied by GitHub Actions.**
- **Application deployment ignores Terraform changes:** application deployment triggers must exclude `infra/terraform/**`, and Terraform-only commits deploy nothing.
- **Production deploys:** only approved merges to the protected production branch deploy, and only when application files change.

## State backend permissions

The operator needs these on the shared state bucket:
- `s3:ListBucket` on the bucket, with the prefix `internal/fenwira-v2/`;
- `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on `internal/fenwira-v2/prod/terraform.tfstate*`, which includes the `.tflock` lock object.

The state and plan files are git-ignored, and so is `terraform.tfvars`.
