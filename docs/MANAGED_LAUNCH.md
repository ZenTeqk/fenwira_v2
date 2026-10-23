# Managed Launch: operator runbook

How the operator onboards and runs customers in Managed Launch Mode (ADR-0027, decisions ML-D1–ML-D8 in `PRODUCT.md`). Customers don't use Embedded Signup or a card gateway. You connect their WhatsApp Business Account (WABA) from the operator console, and they pay by UPI, which you verify by hand.

**Operator console:** `https://app.fenwira.com/platform` (until the domain cutover: `app.fenwira.zenteqk.com/platform`). It needs a platform grant, 2FA, and a fresh authenticator code for every write.

> Nothing here has been tested against real Meta yet; only the Meta mock has. Treat the first customer as the first real test (step 6 of the brief).

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
3. Re-render nginx with `--site-domain fenwira.com` and the `--legacy-*` options (the old certificate), then `sudo nginx -t && sudo systemctl reload nginx`. Before that, fill in the company details in `deploy/site/*.html`; rendering refuses while they still say `FILL-IN`.
4. Set `use_primary_domains = true` and apply, then set the repository variables `APP_URL=https://app.fenwira.com` and `API_URL=https://api.fenwira.com`, and redeploy.
5. Update every customer app's webhook callback URL to `api.fenwira.com`. The old API host keeps serving until all are moved.
6. After 30 days, remove the legacy server blocks and records.
