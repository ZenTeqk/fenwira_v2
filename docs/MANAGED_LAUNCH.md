# Managed Launch: operator runbook

How the operator onboards and runs customers in Managed Launch Mode (ADR-0027, decisions ML-D1–ML-D8 in `PRODUCT.md`). Customers don't use Embedded Signup or a card gateway. You connect their WhatsApp Business Account (WABA) from the operator console, and they pay by UPI, which you verify by hand.

**Operator console:** `https://app.fenwira.com/platform` (until the domain cutover: `app.fenwira.zenteqk.com/platform`). It needs a platform grant, 2FA, and a fresh authenticator code for every write.

> Nothing here has been tested against real Meta yet; only the Meta mock has. Treat the first customer as the first real test (step 6 of the brief).

## 0. Configuration (SSM, read on every deploy)

`deploy/scripts/render-env-from-ssm.py` reads these non-secret `String` parameters into the api and worker env:

| Parameter | Env | Notes |
| --- | --- | --- |
| `/fenwira/prod/config/managed-launch-mode` | `MANAGED_LAUNCH_MODE` | `true` or `false`; absent = `false`. Turns on Managed Launch Mode: Embedded Signup and tenant Meta-connection routes return 404, and manual UPI billing is enabled |
| `/fenwira/prod/config/upi-vpa` | `UPI_VPA` | UPI ID shown on invoices (e.g. `name@bank`). Without it and the payee name, invoices show no UPI QR |
| `/fenwira/prod/config/upi-payee-name` | `UPI_PAYEE_NAME` | Payee name on the UPI QR/link |
| `/fenwira/prod/config/billing-gstin` | `BILLING_GSTIN` | Optional. GST stays off unless configured (ML-D3) |
| `/fenwira/prod/config/billing-gst-rate` | `BILLING_GST_RATE_BPS` | Optional percentage, e.g. `18` (rendered as basis points). GST is added only when both this and the GSTIN are set |
| `/fenwira/prod/config/billing-grace-days` | `BILLING_GRACE_DAYS` | Days a PAST_DUE workspace keeps working before SUSPENDED. Production default **7** when unset |
| `/fenwira/prod/config/billing-invoice-lead-days` | `BILLING_INVOICE_LEAD_DAYS` | Days before the period end that the renewal invoice is issued. Production default **3** when unset |
| `/fenwira/prod/config/billing-payment-confirm-hours` | `BILLING_PAYMENT_CONFIRM_HOURS` | Optional, 1–168. Billing shows "we confirm payments within X hours"; unset hides the line. Only promise what you can meet |

The renderer always writes explicit grace and lead days (7 and 3 unless SSM overrides them), so production never uses the schema's development defaults. `BILLING_SUBSCRIPTIONS_ENFORCED` stays `false` (ML-D5 business decision). After changing a parameter, redeploy (or re-render the env and restart api and worker).

## 1. One-time Meta prerequisites (per customer app)

ML-D1: each customer usually has their own Meta app and system user. Before the call, the customer (or you, with their access) must have:

1. **Business verification** done for the customer's Meta Business portfolio.
2. **A Meta app** (type Business) with the WhatsApp product added, switched to **Live** mode.
3. **A WABA** with the phone number registered and its display name approved.
4. **A system user** (Business settings → Users → System users) with the app and the WABA assigned (full control). Generate a **permanent token** with `whatsapp_business_management` and `whatsapp_business_messaging`.
5. **A payment method** on the WABA in WhatsApp Manager. *Meta bills conversation charges to the customer directly, separately from Fenwira.*
6. **Webhook** in the app dashboard (WhatsApp → Configuration):
   - Callback URL: `https://api.fenwira.com/api/v1/webhooks/whatsapp`
   - Verify token: the value of `/fenwira/prod/secrets/meta-webhook-verify-token` (SSM). Read it with `aws ssm get-parameter --with-decryption`, and never paste it into chat or tickets.
   - Subscribe the field **messages** (Fenwira subscribes the app to the WABA itself).

## 2. What to ask the customer for

| Item | Where they find it |
| --- | --- |
| Business name, owner's name and email | — |
| WABA ID | WhatsApp Manager → Account tools / Business settings → WhatsApp accounts |
| Phone number ID and display number | App dashboard → WhatsApp → API setup |
| Permanent system-user token | Business settings → System users → Generate token |
| App ID and **app secret** | App dashboard → App settings → Basic |
| Business portfolio ID | Business settings → Business info |
| Meta billing set up? (yes/no) | WhatsApp Manager → Payment settings |

**Collect secrets safely.** Tokens and app secrets go straight into the console form. Never send them over email or chat in plain text: use a password manager share or a one-time secret link.

## 3. Onboard one customer, end to end

1. **Create the workspace.** In Workspaces, choose **Create workspace** and enter the business name, owner name and owner email. Copy the **setup link** (single use, 72 hours) and send it to the owner. Each workspace starts on a 14-day trial.
2. **Connect WhatsApp.** In the workspace, choose WhatsApp → **Connect WhatsApp number** and fill WABA ID, phone number ID, display number, token, app secret, app ID and business ID. Fenwira checks the token and the number, stores everything encrypted, subscribes the app to the WABA, and registers the number if needed. The display number must match Meta's.
3. **Verify.** Use **Verify connection**. All three checks (token, phone number, WABA) must be green. Note any error code.
4. **Sync templates** and **Sync status & quality**.
5. **Webhook check.** Ask the customer to send "hi" to the number. It must appear in their Inbox within seconds. If it doesn't, check the callback URL and verify token in their app, and that the app secret you entered is that app's.
6. **Test template.** From the owner's login, start a conversation with the customer's own phone using an approved template (for example `hello_world`), and confirm delivery and the read tick.
7. **Plan and invoice.**
   - Activate the plan: workspace → Commercial operations → *Activate / change plan*.
   - Then **Invoices → Create invoice**:
     - for the plan, choose plan renewal, the amount (prices are entered by hand, ML-D3) and a due date;
     - for message credits, choose wallet top-up.
8. **Payment.** The owner opens Billing → Invoices, pays with the UPI QR or link, and submits the **UTR** (and optionally a screenshot).
9. **Confirm the payment.** In **Payments**:
   - Match the UTR and amount against the bank statement, then **Approve** and enter the statement reference.
   - Approval is final. It renews or activates the plan, or credits the wallet, and issues a receipt.
   - If there's no match, **Reject** it with a reason; the customer can resubmit.
10. **Hand over logins.** The owner invites their team from Settings → Team and shares the invite links (72 hours each). If someone is locked out, use workspace → Team → **Password link** (1 hour, operators only).
11. **Checklist done** when all of the following are true:
   - [ ] the owner can sign in;
   - [ ] the connection is verified;
   - [ ] the webhook has been received;
   - [ ] the test template was delivered;
   - [ ] the first invoice is paid;
   - [ ] Meta billing is set up (the customer confirmed a payment method in WhatsApp Manager).

## 4. Billing operations

- **Lifecycle** (with `MANAGED_LAUNCH_MODE=true` and `BILLING_SUBSCRIPTIONS_ENFORCED=true`):
  - The renewal invoice is created automatically only for priced plans, `BILLING_INVOICE_LEAD_DAYS` before the period ends. Otherwise, create it yourself.
  - An unpaid period end moves the workspace to **PAST_DUE**, where everything still works for `BILLING_GRACE_DAYS`.
  - After that it becomes **SUSPENDED**: new outbound messages and campaigns are blocked, while inbound messages and all data are kept.
  - Approving the payment reactivates it.
- **Void** a wrong invoice from the workspace's Invoices section (only while no proof is pending).
- **Watch:** the Payments dashboard (pending, overdue, revenue), and Email (every email attempt; *skipped* means SMTP is off).
- **Billing operations page** (`/platform/billing-operations`): cards for MRR, pending payments, overdue, trials ending in 7 days and unpaid invoices, then one table each with its next step: **Approve** a submitted UTR, **Remind** (copies a ready-to-send reminder; no email is sent), **Create invoice** for a trial that is ending. Charts show revenue by month and workspaces by status.
- **Create invoice** (Billing operations or a workspace's Invoices): pick the workspace, the plan, the plan price or a custom amount and the due date → **Preview invoice** → **Create invoice**. The result shows the **payment link** (Billing → Invoices for that invoice) with **Copy payment link** and **Copy message for customer**. Creating it again with the same form never makes a second invoice.
- **Workspaces list**: search by name, owner email, slug or ID; filter by status, plan and customer/internal. Each row shows plan, status, trial end, next due date, owner, WhatsApp health, last message and open invoices; click a row to open the workspace. Its **Next steps** card lists what is left (owner setup, WhatsApp, plan, invoice, payment). **Billing adjustments (rare)** sits at the bottom of the workspace page.

## 4a. Internal workspace (Zenteqk Internal)

Fenwira's own demo and test workspace. `tenants.is_internal` is operator-only, and changing it is an audited commercial operation (`internal_flag`, recorded in `commercial_operations` and the platform audit):

```sh
pnpm --filter @fenwira/worker workspace:internal -- --tenant <workspace-id> --internal true \
  --reason "Fenwira internal demo workspace" --reference "<ticket>" --idempotency-key <uuid>
```

(Same platform session variables as the other operator CLI commands.) While it is set, the workspace:

- resolves to the **Business** plan's limits with every feature on (overrides are ignored) and always reports ACTIVE;
- gets no trial or renewal invoices, no trial or lifecycle emails, and is never expired, moved to PAST_DUE or SUSPENDED;
- has no wallet charges (billing is never enforced for it);
- shows no billing prompts (no trial or payment banner).

**Never connect the internal workspace to a customer's WABA or phone number.** It is for Fenwira's own test number only. Its demo data is fake, and anything sent from it would go out under the customer's business name, unbilled.

Demo data (operator-run; only for the internal workspace "Zenteqk Internal": it refuses a workspace that is not internal or whose name differs from `--name`; safe to re-run):

```sh
cd /opt/fenwira/current && DATABASE_URL="$(grep '^DATABASE_URL=' /etc/fenwira/api.env | cut -d= -f2-)" \
  node apps/worker/dist/cli/demo-seed.js --tenant <workspace-id> --name "Zenteqk Internal"
```

It adds 12 `[DEMO]` contacts tagged "Demo data" (fictional +1 555-555-01xx numbers), 6 conversations whose messages start with `[DEMO]`, 3 approved `demo_*` templates and one `[DEMO]` DRAFT campaign. They sit on a fake WhatsApp account and number that are DISCONNECTED, so nothing syncs with Meta or sends. The demo number is never the workspace default, so it can sit next to a real connected number. A re-run adds only missing items (prints "nothing changed" when complete); a failure changes nothing (one transaction) and prints the masked first line of the error. Add `--dry-run` to run everything and roll back (to check first or reproduce a failure).

## 5. Deploy and rollback

- **Deploy:** merging to `main` builds the release, copies it through SSM, runs migrations, switches `/opt/fenwira/current` and restarts the enabled units (`.github/workflows/deploy.yml`). Watch the run, then:
  `curl -fsS https://api.fenwira.com/health/live` and `https://app.fenwira.com/api/health`.
- **Rollback (code):** `git revert` the merge on `main` and merge, which redeploys. For an immediate switch on the server (SSM session):
  `sudo ln -sfn /opt/fenwira/releases/<previous-sha> /opt/fenwira/current && sudo systemctl restart fenwira.target`.
- **Migrations are forward-only.** Our migrations add tables and columns only, so the previous release runs on the newer schema. Never roll a schema back by hand.

## 6. Restore (RDS)

Automated backups: 7-day retention, daily window 20:30–21:00 UTC, point-in-time restore, encrypted, deletion protection on (checked 2026-10-23).

**Drill (to a new instance; production is untouched):**

1. `aws rds restore-db-instance-to-point-in-time --region ap-south-1 --source-db-instance-identifier zenteqk-internal-fenwira-v2-prod-db --target-db-instance-identifier fenwira-restore-drill --use-latest-restorable-time --db-instance-class db.t4g.micro --no-publicly-accessible --db-subnet-group-name <same as prod> --vpc-security-group-ids <prod RDS SG>`
2. Wait: `aws rds wait db-instance-available --db-instance-identifier fenwira-restore-drill`.
3. From the EC2 host (SSM session), connect with the migration credentials and check row counts: `tenants`, `messages`, `invoices`, `wallet_transactions`. Also run `SELECT max(created_at) FROM messages;` and confirm it's close to the restore time.
4. Record the duration and results here, then **delete** the drill instance: `aws rds delete-db-instance --db-instance-identifier fenwira-restore-drill --skip-final-snapshot`.

**Real restore:**
1. Stop the app: `sudo systemctl stop fenwira.target`.
2. Restore to a new instance as above.
3. Point `config/rds-endpoint` (Terraform `rds.tf` / SSM) at it and re-render the env.
4. Start the app and verify.

Ask the owner before any real restore.

## 7. Worker down

**Symptoms:** the alarms `…-worker-no-heartbeat` or `…-queue-backlog-age`; messages stuck in "Sending"; no inbound messages in the inbox (webhooks are stored but not processed).

1. In an SSM session: `systemctl status fenwira-worker` and `journalctl -u fenwira-worker -n 200`.
2. If it's in a restart loop: `sudo systemctl reset-failed fenwira-worker && sudo systemctl restart fenwira-worker`.
3. Redis: `redis-cli ping` (AOF on, `noeviction`; writes fail at `maxmemory`). If memory is at 100%, find the queue with `redis-cli --bigkeys` before freeing anything.
4. **Nothing is lost while the worker is down.** Webhook events and outbox rows are in Postgres, and the worker catches up when it starts.

Auto-start: `systemctl is-enabled fenwira-api fenwira-worker fenwira-web nginx redis-server` must all print `enabled`.

## 8. Email: moving to real SES

The SES account already has production access in ap-south-1 (no sandbox; 50,000 emails per day).

1. Apply `infra/terraform` with `manage_ses = true` (identity fenwira.com, DKIM, `bounce.fenwira.com`, DMARC `p=none`, bounce/complaint SNS and alarms, SMTP user). Wait until `aws sesv2 get-email-identity --email-identity fenwira.com` shows `VerifiedForSendingStatus: true`.
2. Mint the SMTP credentials straight into SSM (nothing is printed):
   `deploy/scripts/ses-smtp-credentials.py --user zenteqk-internal-fenwira-v2-prod-ses-smtp --mail-from 'Fenwira <no-reply@fenwira.com>'`
3. Redeploy (or re-render the env), then `sudo systemctl enable --now fenwira-worker`.
4. Test: send an invitation to your own address. Operator console → Email shows `sent`, and the message arrives with DKIM and SPF passing.
5. Bounces and complaints are suppressed by SES and emailed to the alarm address. Keep the bounce rate under 4%.

## 9. Domain cutover (app.fenwira.zenteqk.com → app.fenwira.com)

1. `terraform apply` creates the `app`, `api` and apex A records and the certbot permission for fenwira.com.
2. On the server: `sudo certbot certonly --dns-route53 -d app.fenwira.com -d api.fenwira.com -d fenwira.com`.
3. Re-render nginx with the `--legacy-*` options (the old certificate), then `sudo nginx -t && sudo systemctl reload nginx`. The apex `fenwira.com` and `www` are the marketing site (fenwira_marketing, CloudFront `E1NPM6L6RF4KJZ`); their records alias to it (`aws_route53_record.site`). The certificate keeps `fenwira.com` so DNS-01 renewals stay unchanged.
4. Set `use_primary_domains = true` and apply, then set the repository variables `APP_URL=https://app.fenwira.com` and `API_URL=https://api.fenwira.com`, and redeploy.
5. Update every customer app's webhook callback URL to `api.fenwira.com`. The old API host keeps serving until all are moved.
6. After 30 days, remove the legacy server blocks and records.
