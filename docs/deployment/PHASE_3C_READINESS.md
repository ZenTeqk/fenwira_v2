# Phase 3C: readiness review

10 October 2026. **Preparation only.**
- **Nothing changed:** no Terraform apply, no DNS change, no new release, no Meta change, no commit or push.
- **Checks run:** read-only AWS queries; test requests against the server's IP with `curl --resolve`; a TLS handshake to SES SMTP from the instance (no authentication, no mail sent); nginx changes tested in the local Ubuntu test container (since restored).
- **Status:** every item below is a proposal awaiting approval.

| # | Item | Status | Approval needed |
| --- | --- | --- | --- |
| 1 | Transactional email | Recommendation ready: Amazon SES over SMTPS, sending from `fenwira.zenteqk.com` | Provider, sender address, new DNS records, IAM user |
| 2 | Meta production | Checklist ready; webhook verified fail-closed | Meta values; console changes after DNS |
| 3 | DNS cutover | Ownership mapped; plan and rollback ready | State ownership transfer; the cutover itself |
| 4 | Health endpoint / unknown hosts | Hardening tested in the container | nginx template change, in the next release |
| 5 | Uncommitted files | Deployed app source = base + current tree; **not yet reproducible from Git** | Commits |
| 6 | Updated scripts in the next release | Included **only once committed** | Commits; small `verify-build.sh` addition |
| 7 | Smoke-test checklist | Ready | — |
| 8 | SNS alarm recipient | Recommendation ready | Address; Terraform apply |

---

## 1. Transactional email (worker SMTP)

### What the code requires

- **The worker refuses to start without both variables** (`packages/config/src/env.ts`):
  - `SMTP_URL`, which must start with `smtp://` or `smtps://`;
  - `MAIL_FROM`, at least 3 characters.
- **The API needs no SMTP.**
- **Sending:** the worker sends through nodemailer 10 (`apps/api/src/modules/platform/email/mailer.ts`). It uses one transport built from the URL, connects lazily and has no SMTP health check.
- **What it sends:**
  - email verification (which workspace creation depends on);
  - password reset;
  - workspace invitations;
  - notifications;
  - ops alerts, only when `OPS_ALERT_EMAIL` is set.
- **Logging:** never the recipient or the body; only the message ID and subject.

Tested locally with the nodemailer version in use:

| `SMTP_URL` form | Result |
| --- | --- |
| `smtps://USER:PASS@host:465` | **Implicit TLS from the first byte**; certificate verified (Node default); the URL-encoded password decodes correctly |
| `smtp://…:587?requireTLS=true` | STARTTLS required |
| `smtp://…:587` | STARTTLS **opportunistic**: a downgraded server would receive credentials in clear text. **Don't use** |

### Recommendation: Amazon SES, SMTPS, sender `no-reply@fenwira.zenteqk.com`

Why SES:
- It's in the same AWS account, already **out of the sandbox** in ap-south-1 (50,000 a day, 14 a second), healthy, and marked `TRANSACTIONAL`.
- Account-level suppression of bounces and complaints is on.
- No new vendor or contract.
- From the instance, `email-smtp.ap-south-1.amazonaws.com:465` was reachable with TLS 1.3 and verified.

Why the **`fenwira.zenteqk.com` subdomain** as the sending domain:
- `zenteqk.com` already carries Zoho mail (MX, SPF) and a Resend setup (`resend._domainkey`, `send.zenteqk.com`).
- A separate subdomain keeps Fenwira's sending reputation, SPF and DMARC independent, and touches none of those records.

**Configuration (all new records; no existing record is modified):**

1. **Domain identity:** SES domain identity `fenwira.zenteqk.com` with Easy DKIM (RSA 2048). That creates 3 `CNAME` records: `<token>._domainkey.fenwira.zenteqk.com`.
2. **Custom MAIL FROM** `bounce.fenwira.zenteqk.com`:
   - `MX 10 feedback-smtp.ap-south-1.amazonses.com`;
   - `TXT "v=spf1 include:amazonses.com -all"`.

   This gives SPF alignment, so DMARC passes on both SPF and DKIM.
3. **DMARC:** `_dmarc.fenwira.zenteqk.com TXT "v=DMARC1; p=none; rua=mailto:<reports mailbox>"`. Move to `p=quarantine` after 2–4 weeks of clean reports. The parent `zenteqk.com` is `p=none` today.
4. **SMTP credentials, with nothing in Terraform state:**
   - Terraform creates an IAM user `zenteqk-internal-fenwira-v2-prod-ses-smtp` with **only** the policy below. **No `aws_iam_access_key` in Terraform**, because its secret would land in state.
   - The access key is created with the CLI. The SES SMTP password (SigV4, region-specific) is derived locally and written straight to SSM SecureStrings with `file://` input:
     - `/fenwira/prod/secrets/smtp-url` = `smtps://<AKID>:<url-encoded password>@email-smtp.ap-south-1.amazonaws.com:465`;
     - `/fenwira/prod/secrets/mail-from` = `Fenwira <no-reply@fenwira.zenteqk.com>`.
   - Nothing is printed. Temporary files are 0600 and deleted, the same way as the Phase 3A secrets.

   ```json
   {
     "Effect": "Allow",
     "Action": "ses:SendRawEmail",
     "Resource": "arn:aws:ses:ap-south-1:569476542351:identity/fenwira.zenteqk.com",
     "Condition": { "StringEquals": { "ses:FromAddress": "no-reply@fenwira.zenteqk.com" } }
   }
   ```

5. **Enforce TLS in validation (proposed `check-env.mjs` addition, deploy tooling):**
   - in production, reject an `SMTP_URL` that is `smtp://` without `requireTLS=true`;
   - reject a `MAIL_FROM` without an address.
6. **Activate:**
   - re-render the env files from SSM and run `check-env worker`;
   - `systemctl enable --now fenwira-worker`;
   - add `worker` to `app_alarm_services` (Terraform plan, then apply).

**Rotation:** create a second key, store the new URL, re-render, restart the worker, then delete the old key. This is an IAM user key, so it has no automatic expiry. Rotate every 90 days, with a reminder.

**Alternative, not recommended now: SES API over the instance role.** It needs no long-lived credential at all. But it requires an application change (nodemailer's SES transport plus the `@aws-sdk/client-sesv2` dependency), so it needs separate approval. Worth doing later.

**Before the worker starts:** it runs the BullMQ schedulers (WhatsApp sync, template sync, billing and webhooks maintenance, analytics roll-ups). With no connected WhatsApp numbers, no campaigns and no webhook endpoints, none of them contacts Meta or sends messages. `SYSTEM_PING_ENABLED=false` stays.

---

## 2. Meta production configuration checklist

**Nothing in Meta was read or changed.** Fenwira runs **one Meta app as a Tech Provider**: each tenant connects its own WhatsApp Business Account (WABA) through Embedded Signup (`docs/META_INTEGRATION.md`). Production onboarding (MI1) is still an open business milestone.

### Values to provide (SSM SecureStrings, entered by you)

| SSM name | Env | Where in Meta | Notes |
| --- | --- | --- | --- |
| `secrets/meta-app-id` | `META_APP_ID` | App Dashboard → App settings → Basic | The **production** app, not the development or test app |
| `secrets/meta-app-secret` | `META_APP_SECRET` | same page | **Webhook signatures and the token exchange depend on it.** Until it's set, every webhook POST is refused (verified: 401) |
| `secrets/meta-es-config-id` | `META_ES_CONFIG_ID` | Facebook Login for Business → Configurations | An Embedded Signup configuration for WhatsApp |
| `secrets/meta-webhook-verify-token` | `META_WEBHOOK_VERIFY_TOKEN` | **already generated** (Phase 3A) | Paste it into the Meta webhook settings when subscribing |

Fixed in the env (no change): `META_GRAPH_API_VERSION=v23.0` and `META_GRAPH_BASE_URL=https://graph.facebook.com`. `WHATSAPP_DEV_CONNECT=false` is enforced in production.

### Settings to check in the Meta app (read-only now; change after approval)

**Business and app status:**
- [ ] Business portfolio **verified**.
- [ ] App type Business, in **Live** mode.
- [ ] App **Tech Provider** status / onboarding (MI1).

**Permissions** (approved through App Review, with Advanced Access):
- [ ] `whatsapp_business_management`.
- [ ] `whatsapp_business_messaging`.
- [ ] `business_management`.

**Facebook Login for Business:**
- [ ] An Embedded Signup configuration exists (its ID becomes `META_ES_CONFIG_ID`).
- [ ] Allowed domains for the JavaScript SDK: `https://app.fenwira.zenteqk.com`. The SDK loads from `connect.facebook.net`.
- [ ] Valid OAuth redirect URI and app domain: `app.fenwira.zenteqk.com`.

**Webhooks** (WhatsApp Business Account object):
- [ ] Callback URL **`https://api.fenwira.zenteqk.com/api/v1/webhooks/whatsapp`**, plus the verify token. This needs the `api.` DNS record first (§3).
- [ ] Fields subscribed: `messages`, `message_template_status_update`, `message_template_quality_update`, `template_category_update`, `phone_number_quality_update`, `account_update`.

**App settings:**
- [ ] Privacy policy URL, terms URL, data deletion URL and app icon set. App Review requires them.

**Payment and test numbers:**
- [ ] WhatsApp payment method on the platform's business, if Fenwira is billed.
- [ ] Tenants pay on their own WABA (`docs/META_INTEGRATION.md` → Pricing).
- [ ] Decide which number is used for the **first controlled test**: an internal test number, never a customer.

### Verified on the server today

| Check | Result |
| --- | --- |
| `GET /api/v1/webhooks/whatsapp` with a wrong verify token | **403** |
| `POST` without a signature | **401** `Invalid signature`, nothing stored |
| `POST` with a bad `X-Hub-Signature-256` | **401** |

### Activation order

1. `api.` DNS record (§3).
2. Store the Meta SecureStrings.
3. Re-render the env files, run `check-env api`, restart the API.
4. Subscribe the webhook in Meta. The handshake must return 200.
5. Send one test event from the Meta dashboard ("Test" button). Expect a 200 and an `inbound`/`status` log line, with no message sent.
6. Embedded Signup with an internal test WABA.
7. **One** template message to an internal number, only after separate approval.

---

## 3. DNS ownership, cutover and rollback

### Current ownership (Route 53 zone `zenteqk.com`, `Z015108329JYWELDKHFGM`)

| Record | Value today | Owner |
| --- | --- | --- |
| `fenwira.zenteqk.com` A/AAAA | alias → `d3tb5a6wrsc07s.cloudfront.net` (landing) | landing state. **Never touched** |
| `app.fenwira.zenteqk.com` A | alias → `d30ptm7ef7jfv7.cloudfront.net` (v1) | **v1 state** `internal/fenwira/prod` (us-east-1 bucket), `aws_route53_record.site_a` |
| `app.fenwira.zenteqk.com` AAAA | alias → same (v1) | **v1 state**, `aws_route53_record.site_aaaa` |
| `_e6b2…app.fenwira.zenteqk.com` CNAME | ACM validation for the v1 CloudFront certificate | v1 state. **Keep**: v1 certificate renewal needs it |
| `api.fenwira.zenteqk.com` | **no record** | — |
| `_acme-challenge.{app,api}.fenwira.zenteqk.com` | none (certbot cleans up) | v2 instance role may change only these TXT records |

v2 Terraform (`route53.tf`):
- `aws_route53_record.app` and `.api` (A → EIP, TTL 300, `allow_overwrite = false`) both sit behind one switch, `manage_dns`, which is `false` today.
- Turned on now, Terraform **would fail** on `app` because the v1 record exists. That's the intended safety.
- **The v2 instance has no IPv6**, so the v1 AAAA record must be **deleted**, not repointed. Otherwise IPv6 clients would keep reaching v1.

The SOA negative-cache TTL is 900 s. So the cutover must never leave `app.` without a record, even briefly: a delete-then-create could be cached as "no such record" for up to 15 minutes.

### Plan (zero downtime)

**Phase A: `api.` record (no user impact, needed for Meta).**
1. Split `manage_dns` into `manage_api_dns` and `manage_app_dns` (a Terraform code change).
2. Plan: **1 to add** (`api` A → 15.252.206.15, TTL 300). Apply after approval.
3. Verify:
   - `dig @ns-1143.awsdns-14.org api.fenwira.zenteqk.com`;
   - `curl https://api.fenwira.zenteqk.com/health/live` without `--resolve`.

**Phase B: release `app.` from the v1 state** (a **state ownership change**: requires your explicit approval). In the v1 repo (`fenwira/terraform`), replace the two `aws_route53_record.site_a/site_aaaa` resources with:

```hcl
removed {
  from = aws_route53_record.site_a
  lifecycle { destroy = false }
}
removed {
  from = aws_route53_record.site_aaaa
  lifecycle { destroy = false }
}
```

Plan must show **2 to forget, 0 to change, 0 to destroy**. Apply. Live DNS is unchanged, v1 keeps its CloudFront distribution, certificate and S3 bucket (the rollback target), and v1's GitHub Actions role can't change DNS.

**Phase C: the flip** (one atomic Route 53 change batch, reviewed JSON). Before it:
- the smoke tests (§7) pass against the server's IP with `--resolve`;
- the worker is running with SMTP (§1).

```json
{ "Comment": "Fenwira v2 cutover: app → EC2",
  "Changes": [
    { "Action": "UPSERT", "ResourceRecordSet": { "Name": "app.fenwira.zenteqk.com.", "Type": "A", "TTL": 60,
        "ResourceRecords": [{ "Value": "15.252.206.15" }] } },
    { "Action": "DELETE", "ResourceRecordSet": { "Name": "app.fenwira.zenteqk.com.", "Type": "AAAA",
        "AliasTarget": { "HostedZoneId": "Z2FDTNDATAQYW2", "DNSName": "d30ptm7ef7jfv7.cloudfront.net.", "EvaluateTargetHealth": false } } }
  ] }
```

- **Why it's safe:** Route 53 applies the batch atomically, so a record exists at every moment. Old answers (CloudFront alias, 60 s) expire into v1, which keeps serving. Clients move to v2 within about a minute, and both sides serve valid HTTPS for the name throughout.
- **TTL:** 60 s during the cutover window, raised to 300 s after 24 stable hours.

**Phase D: hand the record to v2 Terraform.**
1. Set `manage_app_dns = true`, `ttl = 60`.
2. Add `import { to = aws_route53_record.app[0], id = "Z015108329JYWELDKHFGM_app.fenwira.zenteqk.com_A" }`.
3. Plan must show **1 to import, 0 to change**. Apply.
4. After 24 h, change the TTL to 300 (1 to change).

**Observe for the first hour:**
- nginx access log (`/fenwira/v2/prod/nginx`);
- API errors (`/fenwira/v2/prod/api`);
- the api, web and worker down-alarms;
- `curl` checks from outside without `--resolve`;
- a real browser login on `app.`.

### Rollback (≤ 2 minutes, any time)

**Triggers:**
- readiness failing;
- 5xx rate above 2% over 5 minutes;
- login, registration or email verification broken;
- the WebSocket not connecting.

**Action:** one atomic batch, the mirror of Phase C:
- `UPSERT` A → alias `d30ptm7ef7jfv7.cloudfront.net` (`Z2FDTNDATAQYW2`);
- `CREATE` AAAA → the same alias.

Clients return to v1 within the 60 s TTL. v1 needs no deploy, because nothing in it was changed.

**Afterwards:**
- If Phase D had run, put a `removed` block (`destroy = false`) on the v2 record.
- Optionally re-import the records into v1, to restore the original state ownership.
- `api.` can stay: it serves only the API.

**Notes:**
- **Data:** v1 is a static demo with no shared data, so no data migration or session continuity is needed.
- **Cookies:** v2 sets cookies on `.fenwira.zenteqk.com`, so the landing host will also receive them. They're `Secure`, `HttpOnly` and `SameSite`, and harmless to a static site. Narrowing them to `app.` would be an application change.
- **Certificate renewal:** Let's Encrypt renews by DNS-01, so it's unaffected by the cutover.

---

## 4. Health endpoint and unknown-host hardening (tested, not deployed)

### Findings on production today

| Request | Response | Issue |
| --- | --- | --- |
| `GET https://api…/health` and `/health/ready` | 200 with the release version and Postgres/Redis/queue latency | Discloses the version and dependency status; **each unauthenticated request runs a database and Redis round-trip** (cheap load amplification) |
| `GET https://api…/health/live` | `{"status":"ok"}` | Fine for external uptime checks |
| `GET https://app…/api/health` | `{status, service, checks.api}` | No version or details; one loopback call. Acceptable |
| `/metrics` | 404 | Not exposed: the API serves metrics on a loopback listener. Fine |
| HTTPS, unknown or no SNI (for example, scanning the IP) | API block answers 404 **and presents the Fenwira certificate** | Reveals the host names; inconsistent catch-all |
| HTTPS, valid SNI with a foreign `Host` header | would fall to a server with no rules | Domain-fronting surface |
| HTTP, unknown host | connection closed (`444`) | Already correct, but only from the bootstrap holding site, not from `deploy/nginx` |

### Proposed changes (nginx templates only; no application change)

**(a) New `deploy/nginx/fenwira-default.conf`**, replacing the bootstrap holding site as the catch-all:

```nginx
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_tokens off;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 444; }
}
server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    ssl_reject_handshake on;   # unknown/missing SNI: no certificate shown (nginx ≥ 1.19.4)
    server_tokens off;
    return 421;                # valid SNI, foreign Host header
}
```

**(b) `fenwira-api.conf.template`:** only liveness is public. `check-health.sh` calls `127.0.0.1:4000` directly, so local probes and systemd are unaffected.

```nginx
location = /health/live {
    proxy_pass http://fenwira_api;
    include /etc/nginx/snippets/fenwira-proxy.conf;
    proxy_set_header Connection "";
    access_log off;
}
location ^~ /health { return 404; }
```

**Test results** in the local Ubuntu 24.04 container (nginx 1.24, same templates; the container was restored afterwards):

| Check | Result |
| --- | --- |
| `nginx -t` | OK, no warnings (after adding `http2` to the default listener) |
| api `/health/live` | 200 |
| api `/health`, `/health/ready` | 404 |
| api `/api/v1/auth/me` | 401 (routing unchanged) |
| WebSocket upgrade `/ws` | 101 |
| Unknown SNI or IP-only HTTPS | TLS handshake refused (curl 35) |
| Valid SNI + foreign Host (HTTP/1.1 and HTTP/2) | **421** |
| Port 80 unknown host / ACME path / api redirect | 444 / 404 (no token) / 301 |

**Rollout with the next release:**
1. `render-nginx.sh` renders the default site.
2. The bootstrap template drops `fenwira-bootstrap.conf` in favour of it.
3. `nginx -t`, then reload, with the configuration backed up first.

**Option for later (application change):** have `/health/ready` omit `version` and `latencyMs` unless the request comes from loopback.

---

## 5. Uncommitted files and reproducibility

**Branch:** `d1-native-runtime`. **Base:** `9471992`.

**Tracked and modified (11):**
- `.gitignore` (ignores `deploy/env/*.env`);
- `AGENTS.md`;
- the approved P1/P2/P3 app changes: `apps/api/src/{app.module.ts, main.ts, core/config/core-config.ts, core/health/health.service.ts, core/metrics/metrics.service.ts, core/storage/storage.service.ts}`, `apps/worker/src/main.ts`, `packages/config/src/env.ts`, `packages/config/test/env.test.ts`.

**Untracked (65 files):**

| Path | Files |
| --- | ---: |
| `apps/api/test/health.test.ts` | 1 |
| `deploy/` | 32 |
| `docs/deployment/` | 8 |
| `infra/terraform/` | 24 |

**Release vs. current tree** (deployed tarball extracted and compared file by file):
- **No file under `apps/` or `packages/`, nor `pnpm-lock.yaml`, differs.** The deployed application code is exactly base `9471992` plus today's P1–P3 modifications and `health.test.ts`.
- Changed since the build (deploy, infra and docs only):
  - `deploy/scripts/check-env.mjs` and `deploy/env/*.example` (TLS fix);
  - `infra/terraform/{cloudwatch.tf, variables.tf, README.md, terraform.tfvars.example, templates/bootstrap.sh.tftpl}`;
  - three deployment docs.
- New since the build: `deploy/scripts/render-env-from-ssm.py`, `PHASE_3B_REPORT.md`, this report.

**Today the deployed release can't be reproduced from Git:**
- `HEAD` contains **none** of `deploy/`, `infra/` or the P1–P3 changes.
- `build-release.sh <ref>` uses `git archive`, so a committed-ref build now would have **no deploy scripts** and the old runtime configuration.

**Hygiene before committing:**
- Delete `deploy/scripts/__pycache__/` and add `__pycache__/` to `.gitignore`. Today it **isn't ignored**, and a WORKTREE build would ship it.
- Commit `infra/terraform/.terraform.lock.hcl` (provider pinning; trackable today).
- `infra/terraform/terraform.tfvars` is git-ignored but holds **no secrets** (domains, sizes, `manage_dns`, `app_alarm_services`). **Decision:** either track it (recommended, so the infrastructure is reproducible from Git) or keep it out and document it.
- Secret scan of everything that would be committed (AWS keys, private keys, credentials in URLs, Slack tokens): **none found**.

**Proposed commits** (on approval):
1. `feat(runtime): bind hosts, optional S3 keys, sanitised health errors` (P1–P3, the 11 tracked files, `health.test.ts`).
2. `feat(deploy): native systemd/nginx/redis runtime, env templates and scripts`.
3. `feat(infra): Terraform for Fenwira v2 production`.
4. `docs(deployment): runtime, setup and phase reports`.

Then tag `deploy-2026-10-10`.

**Reproducibility proof** after committing:
- `build-release.sh <commit>` in the Ubuntu container;
- compare the source trees with the deployed release (expected: identical);
- compare the build outputs: identical apart from the random Next.js build ID and timestamps.

---

## 6. Updated scripts in the next release

| Build mode | `check-env.mjs` (single-certificate check) | `render-env-from-ssm.py` |
| --- | --- | --- |
| `WORKTREE` (today) | included (new version) | included, plus a stray `.pyc` (see §5) |
| committed ref (production rule) | **only after commit 2** | **only after commit 2** |

`migrate.sh` and `check-env.sh` call `check-env.mjs` from the release itself, so the next release enforces the new check automatically.

**Proposed additions:**
- **`verify-build.sh`:** require `deploy/scripts/{check-env.mjs, check-env.sh, migrate.sh, check-health.sh, render-env-from-ssm.py, render-nginx.sh}`. Also fail if `check-env.mjs` lacks the single-certificate check (grep for `sslcert`), so a release without the TLS fix can't ship.
- **Docs:** `NON_DOCKER_SETUP.md` doesn't describe the SSM render step yet. Add `sudo /opt/fenwira/current/deploy/scripts/render-env-from-ssm.py --release <name>`.
- **Cleanup:** after the next release, the separately installed `/usr/local/lib/fenwira/render-env-from-ssm.py` can be removed.

---

## 7. Production smoke-test checklist

**When to run:**
- **Before DNS:** from outside, with `curl --resolve <name>:443:15.252.206.15`, or a hosts-file entry for browser tests.
- **After DNS:** again, without `--resolve`.

**Rules:** use only internal test accounts and mailboxes. **No campaigns. No WhatsApp message to anyone outside the internal test number, and only with approval.**

**API**
- [ ] `GET /health/live` 200. After §4 is deployed, `GET /health/ready` from outside: 404; from the instance: 200 with postgres, redis and queue up.
- [ ] `GET /api/v1/auth/me` without a cookie: 401 JSON with a `correlationId`.
- [ ] CORS preflight from `https://app.fenwira.zenteqk.com`: 204 with only that origin; from another origin: no `Access-Control-Allow-Origin`.
- [ ] Rate limit: repeated failed logins hit the documented limit, `429`.
- [ ] Security headers on the API (helmet) and on the app (HSTS, nosniff, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`).

**Frontend**
- [ ] `/login`, `/register`, `/forgot-password`: 200 with no console errors. Static assets come from `/_next/static/` with `immutable`.
- [ ] The browser shows a valid certificate (Let's Encrypt, `app.` in the SAN). HTTP redirects with 301 to HTTPS.
- [ ] `/api/health` 200.

**Accounts and email verification** (needs §1)
- [ ] Register `smoke+<date>@<internal mailbox>`. The verification email arrives within 60 s.
- [ ] In the received email's headers: `spf=pass`, `dkim=pass` (`d=fenwira.zenteqk.com`), `dmarc=pass`. The link points to `https://app.fenwira.zenteqk.com/…`.
- [ ] The link verifies the account. Creating a workspace succeeds. A second use of the link is refused.
- [ ] Password reset: the email arrives, the reset works, and the old sessions are revoked.
- [ ] Invite a second internal user. The invitation arrives, and accepting it gives the right role.
- [ ] Logout, then log in again. The session cookie is `Secure`, `HttpOnly` and `SameSite`, on the domain `.fenwira.zenteqk.com`.

**Database and tenancy**
- [ ] The new workspace's rows are visible only to that tenant. With the second workspace, a cross-tenant ID returns 404, not data.
- [ ] `pg_stat_ssl`: every `fenwira_app` connection uses TLS. Connections stay within the role limits (app 40, owner 10).
- [ ] RDS automated backup exists for today. Point-in-time restore is available (confirm only; don't restore).

**Redis and the worker** (after `systemctl enable --now fenwira-worker`)
- [ ] `fenwira-worker` active. `/health/ready` on `127.0.0.1:4100`: 200.
- [ ] The worker's procstat `pid_count` is 1, and `worker-down` is OK after `worker` is added to `app_alarm_services`.
- [ ] BullMQ: the job schedulers are registered once (no duplicates after a restart). The outbox relay drains (no growing backlog). The `failed` count is 0 for `identity.events` and `notifications.dispatch`.
- [ ] Redis `used_memory` and the `redis-down` alarm are fine. Persistence is on per `fenwira-redis.conf`.

**S3**
- [ ] Contacts import: request an upload URL, `PUT` a 5-row CSV straight to S3 (CORS from `app.`), confirm, and 5 contacts are created (worker).
- [ ] Export: the job completes, and the presigned download works and expires.
- [ ] A media upload (avatar or attachment, if exposed) is stored in the media bucket. No public object URL works without a signature.

**WebSockets**
- [ ] The browser connects to `wss://api.fenwira.zenteqk.com/ws` (101). The inbox receives a realtime event: the internal test number, or the Meta "Test" webhook below.
- [ ] Restart the API, and the socket reconnects automatically.

**Meta webhooks** (after §2 values and the `api.` DNS record)
- [ ] The verify handshake from the Meta dashboard succeeds. A wrong token gives 403.
- [ ] A Meta "Test" event: 200, and an ingest log line with no payload or PII.
- [ ] An unsigned or badly signed POST gives 401.
- [ ] *(Approval required)* Embedded Signup with an internal test WABA: the number shows `CONNECTED`, and `subscribed_apps` is set.
- [ ] *(Approval required)* One template message to the internal test number: delivered and read statuses arrive by webhook.

**Operations**
- [ ] CloudWatch logs arrive for api, web, worker, nginx and system. The alarms are OK, and a test notification reaches the SNS recipient (§8).
- [ ] `certbot renew --dry-run` succeeds.
- [ ] Reboot test (in a maintenance window): every service comes back, with no manual step.

---

## 8. SNS alarm recipient

**Current state:**
- Topic `zenteqk-internal-fenwira-v2-prod-alarms`: 0 subscriptions, not encrypted.
- All 16 alarms publish to it.
- None has an `OKActions` entry, so there are no "recovered" emails.
- `alarm_email` exists in Terraform (empty).

**Recommendation:**

1. **A shared operations mailbox**, not a personal inbox; for example `ops@zenteqk.com` on the existing Zoho domain. Alarms must reach whoever is on call, and the address appears in Terraform state, which is acceptable for a non-secret address.
2. Set `alarm_email` in `terraform.tfvars`. **Plan: 1 to add** (`aws_sns_topic_subscription.alarm_email`). Apply after approval.
3. **Confirm safely.** By default, the "Unsubscribe" link in every SNS email lets **anyone** who gets the email (forwarded, or another recipient on a list) silently stop all alarms with one click. Instead of clicking the confirmation link:
   - copy the `Token` from the confirmation URL;
   - run:

     ```sh
     aws sns confirm-subscription --topic-arn <arn> --token <token> --authenticate-on-unsubscribe true
     ```

   After that, unsubscribing requires AWS credentials.
4. **Add `ok_actions = local.alarm_actions`** to the alarms (a Terraform change: 16 in-place updates), so recoveries are reported too.
5. **Leave the topic unencrypted.** With `aws/sns` encryption, CloudWatch can't publish (it needs a customer-managed KMS key with a key policy, and the project avoids KMS). Alarm messages hold no secrets.
6. **End-to-end test** after confirming: `aws cloudwatch set-alarm-state --alarm-name …-web-down --state-value ALARM --state-reason "SNS test"`. The email arrives, and the alarm returns to OK on its next evaluation (within about 3 minutes).

**Later:** a second channel (SMS or chat via AWS Chatbot) for the critical availability alarms.

---

## Current production state (unchanged by this phase)

- **Services:** API and web running and healthy. The worker is stopped (SMTP).
- **Alarms:** two are in ALARM, both expected:
  - **`worker-down`:** the worker is stopped on purpose, and its notifications are off.
  - **`rds-cpu-credits-low`:** a new t4g instance starts with 0 credits. The balance is now about 14.8 and rising by about 6.7 an hour at roughly 4% CPU, so it clears on its own within about an hour.
- **DNS:** `app.` still serves v1; `api.` has no record.

## Decisions requested

1. Email: SES over SMTPS from `no-reply@fenwira.zenteqk.com` (§1), and the new DNS records plus IAM user.
2. Meta: production app values and the timing of console changes (§2).
3. DNS: Phase A (`api.`) now, or together with the cutover; approval of the v1 state ownership transfer (Phase B); a cutover window (Phase C/D).
4. nginx hardening (§4) and the `verify-build.sh` and `check-env.mjs` additions (§1, §6), for the next release.
5. The commit plan (§5): track `terraform.tfvars` or not; branch and remote.
6. SNS recipient address and `ok_actions` (§8).
