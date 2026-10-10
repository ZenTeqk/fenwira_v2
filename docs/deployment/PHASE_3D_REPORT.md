# Phase 3D: cloud deployment completion (no email, no Meta)

10 October 2026.

**Scope.** Complete the AWS deployment for development and testing. There is no public launch.

**Changed in production:** the approved nginx hardening only.

**Not done:**
- no SES or SMTP setup;
- no Meta configuration;
- no DNS change;
- no Terraform apply;
- no new release;
- no commit or push.

**Secrets:** no secret value appears in this document, logs or command output.

## 1. Security hardening (nginx only; applied and verified)

### Changes

| File | Change |
| --- | --- |
| `deploy/nginx/fenwira-default.conf` (new) | Catch-all for every host name that isn't Fenwira's. **Port 80:** ACME challenges, otherwise `444`. **Port 443:** `ssl_reject_handshake on` for an unknown or missing SNI; `return 421` for a valid SNI with a foreign `Host` header. Needs no certificate |
| `deploy/nginx/fenwira-api.conf.template` | `location = /health/live` stays public. `location ^~ /health` returns 404 (summary and readiness) |
| `deploy/scripts/render-nginx.sh` | Also renders `sites-available/fenwira-default.conf` |
| `deploy/scripts/validate-templates.sh` | Fails if the catch-all or the health restriction is missing |
| `infra/terraform/templates/bootstrap.sh.tftpl`, `ec2.tf` | First boot installs the catch-all, replacing the old holding site (`user_data` changes are ignored for the existing instance: plan **No changes**) |
| `docs/deployment/NON_DOCKER_SETUP.md` | Enables `fenwira-default.conf`; removes the old holding site |

### Validation before applying

- `validate-templates.sh` in the Ubuntu 24.04 test container (nginx 1.24): `nginx -t` on the rendered set **valid**; static checks pass.
- Production render diffed against the live files: only the API site changed (the health block). App, snippets and `conf.d` are byte-identical.
- On production:
  - configuration backed up to `/root/nginx-backup-20261010T144914`;
  - `nginx -t` **successful**, then a graceful reload;
  - with an automatic restore if the test had failed.

### Results (external, `curl --resolve` to 15.252.206.15)

| Must keep working | Result | Must be refused | Result |
| --- | --- | --- | --- |
| `app /login` | 200, certificate verified, HTTP/2 | `api /health` | **404** |
| `app /api/health` | 200 | `api /health/ready` | **404** |
| `api /health/live` | 200 `{"status":"ok"}` | HTTPS by IP (no SNI) | **handshake refused** (TLS alert 112) |
| `api /api/v1/auth/me` | 401 | HTTPS, unknown SNI | **handshake refused** |
| Webhook handshake with a wrong token | 403 | Valid SNI + foreign Host, HTTP/1.1 | **421** |
| CORS preflight from `app.` | 204, only that origin | Valid SNI + foreign Host, HTTP/2 | **421** |
| Socket.IO handshake / WebSocket upgrade | OK / **101** | HTTP by IP | connection closed (`444`) |
| `http://app…` | 301 → HTTPS | | |

Local probes are unaffected: `127.0.0.1:4000/health/ready` returns 200, and `check-health.sh api|web` reports ready. `certbot renew --dry-run` succeeds.

## 2. Git commit plan (nothing committed)

**Branch:** `d1-native-runtime` (remote `ZenTeqk/fenwira_v2`). **Base:** `9471992`. **Files:** 78 (including this report).

**Checks:**
- **Secret scan:** clean. Checked for AWS keys, private keys, credentials in URLs, SCRAM verifiers, GitHub and Slack tokens.
- **Infrastructure identifiers:** the AWS account ID (README, variables, example tfvars, this report) and the EIP (3B/3C/3D reports) appear. They're not secrets, and the repository is private.
- **Code checks:** `pnpm lint` passes. Typecheck (api, worker) passes. Tests: `@fenwira/config` 18 passed; `apps/api/test/health.test.ts` 2 passed. Prettier is clean.
- **Formatting fix:** `packages/config/test/env.test.ts` had a Prettier whitespace issue, now fixed (formatting only).

**Never committed** (git-ignored, verified with `git check-ignore`):
- `infra/terraform/terraform.tfvars`;
- `*.tfstate`, `*.tfplan`, `.terraform/`;
- `.env*`, `deploy/env/*.env`;
- `__pycache__/` (the stray `.pyc` was deleted, and `__pycache__/` is now ignored).

**Commit 1: `feat(runtime): loopback binds, optional S3 keys, sanitised health errors (P1–P3)`**
```
apps/api/src/app.module.ts
apps/api/src/core/config/core-config.ts
apps/api/src/core/health/health.service.ts
apps/api/src/core/metrics/metrics.service.ts
apps/api/src/core/storage/storage.service.ts
apps/api/src/main.ts
apps/api/test/health.test.ts                (new)
apps/worker/src/main.ts
packages/config/src/env.ts
packages/config/test/env.test.ts
```

**Commit 2: `feat(deploy): native systemd/nginx/redis runtime, env templates and release tooling`**
```
.gitignore                                   (deploy/env/*.env, __pycache__/)
AGENTS.md                                    (Terraform exception: infra/terraform only, never applied by CI)
deploy/env/{api,migrate,web,worker}.env.example
deploy/monitoring/redis-metrics.sh
deploy/nginx/conf.d/fenwira-upgrade-map.conf
deploy/nginx/fenwira-api.conf.template
deploy/nginx/fenwira-app.conf.template
deploy/nginx/fenwira-default.conf
deploy/nginx/snippets/{fenwira-proxy,fenwira-security-headers,fenwira-tls}.conf
deploy/redis/fenwira-redis.conf
deploy/scripts/.shellcheckrc
deploy/scripts/{build-release,check-env,check-health,lib,migrate,render-nginx,validate-templates,verify-build}.sh
deploy/scripts/check-env.mjs
deploy/scripts/render-env-from-ssm.py        (mode 0755)
deploy/sql/{bootstrap-roles,verify-rds-privileges}.sql
deploy/systemd/fenwira-{api,web,worker}.service
deploy/systemd/fenwira-redis-metrics.{service,timer}
deploy/systemd/fenwira.target
```

**Commit 3: `feat(infra): Terraform for Fenwira v2 production (ap-south-1)`**
```
infra/terraform/.gitignore
infra/terraform/.terraform.lock.hcl          (aws 6.68.0; hashes for linux_amd64, darwin_arm64, darwin_amd64)
infra/terraform/.tflint.hcl
infra/terraform/README.md
infra/terraform/{backend,cloudwatch,data,ebs,ec2,iam,locals,networking,outputs,providers,rds,route53,s3,security_groups,ses,ssm,variables,versions}.tf
infra/terraform/templates/bootstrap.sh.tftpl
infra/terraform/terraform.tfvars.example
```

**Commit 4: `docs(deployment): runtime, setup, environment and phase reports`**
```
docs/deployment/{ENVIRONMENT_VARIABLES,NON_DOCKER_AUDIT,NON_DOCKER_SETUP,PRODUCTION_RUNTIME,RESOURCE_BUDGET,VALIDATION_REPORT}.md
docs/deployment/{PHASE_3A_REPORT,PHASE_3B_REPORT,PHASE_3C_READINESS,PHASE_3D_REPORT}.md
```

**Afterwards** (on approval): push the branch and open a PR to `main`. CI runs lint, typecheck, tests and build on the PR.

## 3. Production infrastructure status

All checks are from 10 October 2026, after the hardening.

| Component | Status |
| --- | --- |
| **EC2** `i-0c5a3e148c5a81b9f` | t3a.medium, running. Status checks ok/ok. IMDSv2 required. EBS 40 GiB gp3 **encrypted**. Termination protection on. SSH disabled and inactive. Only 80/443 public. Memory 800 / 3,844 MiB used. Disk 17%. Swap 2 GiB, unused |
| **SSM** | Agent online (3.3.4793.0). Parameters: 13 String (Terraform) + 8 SecureString (manual). The instance can't list or read parameters outside `/fenwira/prod` (denied). `smtp-url` absent (deferred) |
| **RDS** | PostgreSQL 16.15, db.t4g.micro, available. **Encrypted, not public, deletion protection on.** 7-day backups; latest restorable time current; 1 automated snapshot. Parameters in sync; no pending changes. CA `rds-ca-rsa2048-g1` |
| **Redis** | PONG. `noeviction`, `maxmemory` 512 MiB. Bound to `127.0.0.1 ::1`. `protected-mode yes`. `appendonly yes` |
| **S3** | media, imports, exports: **AES256 by default; public access fully blocked**. Instance role put/head/delete OK. Presigned GET 200; anonymous GET **403**. v1 bucket denied. Probe objects and versions removed (0 left) |
| **Next.js** (`fenwira-web`) | enabled/active, `127.0.0.1:3000`, `/api/health` 200 |
| **NestJS API** (`fenwira-api`) | enabled/active, `127.0.0.1:4000`. Readiness: postgres, redis and queue up |
| **Worker** | disabled/inactive by decision (SMTP is mandatory at startup) |
| **HTTPS** | Let's Encrypt, SAN `app.` + `api.fenwira.zenteqk.com`, valid until 2027-01-08. Renewal dry run succeeds |
| **nginx** | `nginx -t` OK. Sites: `fenwira-app`, `fenwira-api`, `fenwira-default` |
| **CloudWatch** | Agent running. Logs flowing: api, nginx and system (all had events in the last 20 minutes); web has none because Next.js is quiet after startup; worker is stopped. Alarms: 15 OK, 1 ALARM (`worker-down`, expected, notifications off). The RDS credits alarm has cleared |
| **Migrations** | 22 applied, 0 unfinished; latest `20261012000000_platform_security_binding`. Seeds: 5 roles, 35 permissions, 3 plans. No user or tenant data |
| **Terraform** | `plan`: **No changes** (76 resources) |

### Tenant isolation (functional)

The test ran as `fenwira_app` over TLS (BYPASSRLS false), in a single transaction that was **rolled back**.

| Test | Result |
| --- | --- |
| T1/T2: tenant B context, read | sees only `probe-b` and its own tenant |
| T3/T4: B updates or deletes tenant A's rows | **0 rows** affected |
| T5: B inserts a row for tenant A | `new row violates row-level security policy` |
| T6: tenant A context | sees only `probe-a` (unmodified) |
| T7: no tenant context | 0 tags, 0 tenants |
| T8: `SET row_security = off` | refused (`query would be affected by row-level security policy`) |
| T9: `SET ROLE fenwira_owner` | `permission denied` |
| T10: after rollback | 0 users and 0 tenants left |

Catalog check: all 58 tables with a `tenant_id` have RLS **enabled and forced**.

## 4. Deployment reproducibility

**Deployed release vs. working tree** (file by file):
- no file under `apps/` or `packages/`, nor `pnpm-lock.yaml`, differs;
- after the four commits, the deployed application code is reproducible from Git.

**What differs after this phase:**
- deploy tooling, nginx templates, Terraform and docs;
- `packages/config/test/env.test.ts` (whitespace only; a test file that isn't in the runtime).

**Verify-build improvements** (`deploy/scripts/verify-build.sh`). A release must now contain:
- `check-env.mjs` **with** the single-certificate `sslcert` check;
- `check-env.sh`, `migrate.sh`, `check-health.sh`, `render-nginx.sh`, `lib.sh`;
- an executable `render-env-from-ssm.py`;
- `deploy/nginx/fenwira-default.conf`;
- no `__pycache__`.

**Negative test:** the new script, run against the currently deployed release, **fails** on exactly the missing new tooling (`render-env-from-ssm.py`, `fenwira-default.conf`, the single-certificate check). That proves the gate works.

**Proof of reproducibility, after committing:**
1. Run `build-release.sh <commit>`, which uses `git archive` (committed files only), in the Ubuntu container.
2. Run `verify-build.sh`.
3. Diff the source trees against the deployed release. Expected: identical in `apps/`, `packages/` and the lockfile. Build outputs differ only in the Next.js build ID and timestamps.

**Configuration:** `terraform.tfvars` stays uncommitted by decision; `terraform.tfvars.example` documents it. Recreating the infrastructure from Git needs that file restored from a secure location. Record where it's kept.

## 5. GitHub Actions CD design (not created)

### Blocker found: protected `main` isn't available on the current GitHub plan

`ZenTeqk/fenwira_v2` is **private**, and the GitHub API refuses branch protection and rulesets: `403 Upgrade to GitHub Pro or make this repository public`. Without protection, anyone with write access can push to `main` directly, so "deploy only after approved merges" **can't be enforced**.

| Option | Gives |
| --- | --- |
| **GitHub Team for the organisation (recommended)** | Branch protection or rulesets on `main` (required PR, required approving review, required CI checks, no force push or deletion). Environments with **deployment branch policies** (only `main` can deploy) |
| GitHub Enterprise | Also **required reviewers** on the `production` environment (a manual approval per deploy) |
| Stay on Free | Not acceptable for this requirement. The OIDC trust can limit deploys to `main`, but can't require approval |

### Identity: GitHub OIDC, no stored AWS keys

The account already has the GitHub OIDC provider (`token.actions.githubusercontent.com`), shared with v1. The repo uses **immutable subject claims**:

`repo:ZenTeqk@304040444/fenwira_v2@1396213834`

Proposed new IAM role `zenteqk-internal-fenwira-v2-prod-github-deploy` (Terraform, plan reviewed first):
- **Trust:** `aud = sts.amazonaws.com`, **`sub = repo:ZenTeqk@304040444/fenwira_v2@1396213834:environment:production`** (exact match). Only jobs in the `production` environment can assume it, and its branch policy allows only `main`.
- **Permissions** (nothing else; no Terraform, IAM, RDS, Route 53 or SSM parameter access):
  - `s3:PutObject` on `zenteqk-internal-fenwira-v2-prod-releases/releases/*`;
  - `ssm:SendCommand` on the instance ARN **and** the two Fenwira SSM documents only (not `AWS-RunShellScript`);
  - `ssm:GetCommandInvocation` / `ListCommandInvocations`.

**Supporting infrastructure** (Terraform, later approval):
- a releases bucket: versioned, AES256, public access blocked, TLS-only, 90-day expiry of non-current versions;
- the instance role gets **read-only** access to the bucket's `releases/*`;
- SSM documents `Fenwira-Deploy` and `Fenwira-Rollback`, whose parameters are validated by regex.

### Workflows

**`ci.yml` (exists)** runs on PRs and on pushes to `main`: lint, typecheck, tests, build, OpenAPI check. It gets **no AWS credentials** (`permissions: contents: read`, no `id-token`). These checks become the required status checks.

**`deploy.yml` (new):**

```yaml
on:
  push:
    branches: [main] # merges only: protection forbids direct pushes
    paths-ignore: ['infra/**', 'docs/**', '**/*.md'] # Terraform/docs-only merges never deploy
  workflow_dispatch: {} # manual redeploy of main's HEAD
concurrency: { group: deploy-production, cancel-in-progress: false }
```

- **No `pull_request` trigger, and no feature-branch trigger.**
- A merge that touches **only** `infra/**` or docs triggers nothing.
- A mixed merge deploys the application only. **Terraform is never run by CI.**

| Job | Runner and permissions | Steps |
| --- | --- | --- |
| `build` | `ubuntu-24.04` (x86_64 = production platform, required for the Prisma engine); `contents: read` only, **no AWS** | Checkout the merge commit. Node 22, pnpm 10.34.5. `NEXT_PUBLIC_API_URL` from a repo variable. `deploy/scripts/build-release.sh $GITHUB_SHA` (committed ref, `git archive`). `verify-build.sh`. `tar --zstd` + SHA-256. Upload as a workflow artifact (7 days) |
| `deploy` | `needs: build`, `environment: production`, `id-token: write`, `contents: read` | `aws-actions/configure-aws-credentials` (OIDC, role above, 15-minute session). Upload the tarball and checksum to `s3://…-releases/releases/<sha>/`. `ssm send-command --document-name Fenwira-Deploy --parameters release=<sha>,sha256=<digest>`. Poll the invocation and print its output (names and statuses only) |
| `smoke` | `needs: deploy`, same role | `Fenwira-Deploy` already ran the local health gates. Then external checks: before DNS, through the SSM document's built-in curl `--resolve` checks; after DNS, plain `curl` against the public URLs |

All third-party actions are pinned to commit SHAs, with Dependabot updating them (`.github/dependabot.yml` exists).

### `Fenwira-Deploy` (SSM document, runs as root on the instance)

1. Validate the parameters: `release` matches `^[0-9a-f]{7,40}$`; `sha256` is 64 hex characters.
2. Download from the releases bucket with the instance role, then `sha256sum -c`.
3. Extract to `/opt/fenwira/releases/<sha>`, root-owned and immutable. Run `verify-build.sh`.
4. Run `render-env-from-ssm.py --release <sha>` and `check-env.sh` (api, web, migrate; worker once SMTP exists).
5. Run `migrate.sh <release>`. **Migrations must be backward compatible** (expand/contract), so the previous release still runs on the migrated schema; this is what makes rollback safe.
6. Record `previous=$(readlink current)`, then switch `current` atomically (`ln -sfn` + `mv -T`).
7. `systemctl restart fenwira-api fenwira-web` (and the worker if enabled), then `check-health.sh api|web 90`.
8. **On any failure after step 6:** switch back to `previous`, restart, health-check, and exit non-zero. The workflow fails and shows the output.
9. Keep the last 5 releases; delete older ones (never `previous` or `current`).

### Rollback

- **Automatic:** step 8.
- **Manual:** `rollback.yml`, triggered by `workflow_dispatch` with an input `release`. It uses the same `production` environment and role, and runs `Fenwira-Rollback`:
  - validate that the release directory exists and passes `verify-build.sh`;
  - switch `current`, restart, health-check.
- **Database:** migrations are never rolled back automatically (forward-only). A destructive "contract" migration ships only in a later release, once no deployed release needs the old schema.
- **Release retention:** releases stay in S3 (versioned) for 90 days, so an evicted release can be re-fetched by SHA.

### Configuration in GitHub (no secrets)

- Repo variables: `AWS_DEPLOY_ROLE_ARN`, `AWS_REGION=ap-south-1`, `RELEASES_BUCKET`, `INSTANCE_ID`, `NEXT_PUBLIC_API_URL`.
- No AWS keys, database URLs or application secrets in GitHub: the server reads its secrets from SSM.

## 6. Features without SMTP, Meta and the worker

**What the worker does.** It runs the **outbox relay**, which turns committed domain events into BullMQ jobs, and **all 25 BullMQ processors**.

**What works while it's stopped:**
- API reads and writes that complete inside a request: login and session management, the settings screens, CRUD on existing data, RBAC checks;
- the realtime socket connection;
- presigned S3 uploads;
- webhook *ingestion* (stored durably, but not processed).

| Area | Status | Needs |
| --- | --- | --- |
| Registration | Account is created; **verification email not sent** | SMTP + worker |
| **Workspace creation** | **Blocked** (`EMAIL_NOT_VERIFIED`, by design) | SMTP + worker |
| Password reset, invitations, notifications, ops alerts | Not delivered | SMTP + worker |
| Contact import / export | Upload works; **processing doesn't run** | Worker |
| Campaigns, automation flows, scheduled jobs | Not executed | Worker (+ Meta for sending) |
| Analytics roll-ups, billing usage, maintenance jobs | Not run | Worker |
| Outbound webhooks to tenant endpoints | Not delivered | Worker |
| WhatsApp: Embedded Signup, sending, templates, media, number sync | Unavailable | Meta credentials + worker |
| Inbound WhatsApp webhooks | Refused (401) until `META_APP_SECRET` is set (fail-closed) | Meta |

**Impact on testing.** Because verification can't be bypassed, **a new user can't reach any tenant feature** until email works. Ways to test without weakening security (decision needed; none applied):
- **(a) Loopback SMTP sink for pre-launch testing only.** Run Mailpit (or similar) on the instance, bound to `127.0.0.1`, with `SMTP_URL=smtp://127.0.0.1:1025`. The worker starts, and nothing leaves the server. Testers read the emails through an SSM port-forward and click the real verification links. Verification stays fully enforced. It must be removed before any public launch, and `check-env` would flag it in production unless explicitly allowed.
- **(b) An audited operator procedure** (Phase 3A §9). An operator marks specific internal test accounts as verified with a recorded, reviewed SQL statement. The worker stays stopped, so imports and campaigns remain untestable.
- **(c) Wait for the final domain and SES.**

## 7. Testing URL (proposal only; no record created)

Existing names in `zenteqk.com`:
- apex, `www`, `dev`;
- `activepieces`, `lead`, `server`, `lenz`, `api.lenz`, `hms`, `send`;
- `fenwira` (landing), `app.fenwira` (v1).

There are two constraints:
- the web bundle has `NEXT_PUBLIC_API_URL=https://api.fenwira.zenteqk.com/api/v1` compiled in;
- the API allows CORS only from `WEB_ORIGIN`.

| Option | DNS | Other changes | Assessment |
| --- | --- | --- | --- |
| **A. Hosts-file entries (recommended now)** | none | none: testers map `app.` and `api.fenwira.zenteqk.com` to 15.252.206.15 | Exact production configuration, valid certificate, zero risk. Desktop only (phones can't easily edit hosts) |
| B. `v2.fenwira.zenteqk.com` (app) + `api.fenwira.zenteqk.com` (API, the final name) | 2 **new** A records; nothing existing modified | `app_domain` → `v2.fenwira.zenteqk.com`, which changes `WEB_ORIGIN`/CORS, the S3 CORS origins, the ACME IAM condition and the nginx `server_name` (Terraform plan + env render). Reissue the certificate with the extra name. No rebuild needed. Switch back at cutover | Needed only for testers on phones or outside the team |
| C. A separate pair such as `app.v2.fenwira…` / `api.v2.fenwira…` | 2 new records | As B, **plus a rebuild** (the API URL is compiled in), and again at cutover | Not recommended |

## 8. Monitoring

- **Unchanged:** the existing CloudWatch monitoring; no SNS subscription.
- **Prepared, not applied:** `alarm_recovery_notifications` (default `false`) adds `ok_actions` to every alarm.
  - Plan with the default: **No changes**.
  - Plan with `true`: **0 to add, 16 to change, 0 to destroy** (all 16 alarms in place).
  - Enable it together with the SNS subscription later.

## 9. Remaining integrations (deferred by decision)

| Integration | Blocks | When |
| --- | --- | --- |
| Email (SES or other) | Worker start, verification, resets, invites, notifications, every background job | After the official Fenwira domain is final |
| Meta (app ID/secret, Embedded Signup, webhook subscription) | All WhatsApp features | After email and the domain; MI1 business milestone |
| DNS cutover (`app.`, `api.`) | Public access | After approval; v1 state stays the owner until then |
| SNS recipient + recovery notifications | Alarm delivery | With an ops mailbox |
| GitHub Team (protected `main`, environments) | Approved-merge CD | Before the CD workflow |

## 10. Recommended next action

1. **Approve the four commits (§2).** Then push the branch, open a PR to `main`, and let CI run. This makes the deployed release reproducible.
2. **Decide the GitHub plan** (Team recommended), so `main` can be protected and the `production` environment created.
3. **Decide a pre-launch testing path (§6)**, since without email no tenant feature can be reached. Option (a), a loopback mail sink, gives the most realistic testing without weakening verification.
4. Then implement the CD infrastructure (Terraform plan for review: releases bucket, deploy role, SSM documents) and the workflows, still disabled until approved.
