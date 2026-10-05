# Platform Operations — provisioning and commercial support

Step 5 prepares internal commercial operations. No tenant membership or API-key scope grants platform access. Production subscription enforcement remains separately rollout-controlled; this runbook does not enable it.

## Provisioning

Create and verify a normal global identity through the existing authentication flow. With a regular authenticated session, enroll TOTP using POST `/api/v1/me/2fa/setup` and `/me/2fa/enable` (global identity routes, no workspace membership required). Keep backup codes offline. Never create a customer membership for an operator merely to enroll.

Restricted infrastructure staff, using the migration-role connection, run:

```sh
pnpm --filter @fenwira/database platform:operator -- --user <verified-user-uuid> --actor <authorized-founder-reference> --reason "Approved commercial operator"
pnpm --filter @fenwira/database platform:operator -- --user <uuid> --actor <authorized-reference> --reason "Operator access revoked" --revoke
```

The runtime database role cannot write grants. Provisioning requires verified/enabled identity and enrolled MFA; revocation remains possible if the account is disabled or MFA unavailable. Grant version changes invalidate existing privilege. Immutable audit details preserve authorizing reference and reason. There is no HTTP grant endpoint or self-grant UI.

## Privilege and recovery

Visit `/platform/login`; enter password, then a fresh six-digit authenticator code. Separate HttpOnly SameSite=Strict cookies are scoped to `/api/v1/platform`; Secure follows deployment cookie configuration. Production cookie configuration must be secure. Privilege lasts at most 30 minutes, idle limit 10 minutes, and writes/previews need MFA within five minutes. Verify identity again in the workspace action card; this never extends absolute expiry.

For recovery: restricted revoke first; recover the verified global account through existing password/backup-code mechanisms; disable/re-enroll TOTP after revocation; restricted staff grant access again after verifying enrollment. Backup codes alone cannot enter Platform Operations. User/account session revocation and password reset invalidate the backing family, including pending platform challenges. Sign out revokes the platform family. Do not print, persist or share platform session/CSRF credentials.

## Commercial operations

Search by workspace name, exact ID or slug. Confirm workspace identity, currency, available funds after reservations, subscription state and configured/enforced entitlements. Select operation, amount/value, reason and funding/support reference. Keep credentials and customer message content out of notes.

Preview validates the same domain operation in a transaction that rolls back. Review before/after state and effective configured entitlements, then confirm impact. A changed state requires a fresh review. Record the immutable receipt/correlation reference. If a response is uncertain, retry the same payload/key; inspect receipts before starting a new operation. Editing a command is a new logical operation and needs a new key.

Allowed launch operations: paid funding, promotional funding with optional expiry metadata, signed corrections that leave available funds nonnegative, full/partial message-usage refunds capped cumulatively at the original debit, configured plan activation/change, period-end cancellation, FREE/TRIAL/PREPAID mode and typed expiring entitlement overrides/removal. Wallet and subscription stay separate. No paid-credit withdrawal, cash repayment, promotional clawback, expiry consumption policy, gateway or POSTPAID policy.

Promotional amounts shown are grants, not remaining paid/promotional buckets. Provider costs are internal recorded snapshots with coverage; missing costs stay unknown. Contribution on known costs is recorded gross usage charge less known provider cost; it is not an invoice-verified profit calculation. Tax metadata is not tax calculation or an invoice.

## CLI adapters

`wallet:credit`, `subscription:activate`, `billing:mode`, `entitlement:override` use the same authenticated HTTP/domain services. They require `PLATFORM_API_URL` including `/api/v1`, `PLATFORM_SESSION_TOKEN`, `PLATFORM_CSRF_TOKEN` from current MFA privilege, plus `--tenant`, `--reason`, `--reference`, `--idempotency-key`. Use HTTPS except localhost. No runtime database CLI shortcut remains for these writes.

Funding accepts exact positive decimal `--amount`, `--fund-type PAID|PROMOTIONAL`, optional `--expires-at`. Activation accepts configured `--plan KEY` or `--plan-id UUID`. Overrides accept `--key`, typed `--value true|false|null|integer`, optional positive `--days`, or `--remove`. Removal requires reason/reference/key too. Never change an idempotency key merely to retry.

## Investigation and boundaries

Receipts, tenant audit, platform audit and the ledger are immutable. Financial mutation, receipt, successful audit and outbox commit atomically. Billing readers receive deduplicated in-app updates after commit. No operator gains conversation/message access. Internal finance is never a tenant Billing/Usage/API-key response.

Investigate failed operations by correlation/receipt, grant/session status, ledger reconciliation and reserved funds. Existing wallet maintenance raises ledger/hold drift through configured OpsAlerts. Platform metrics and broad-access warnings are documented in OBSERVABILITY.md. Do not correct drift by editing balances or historical entries.

Phase 11 closure is a separate checkpoint after Step 5 acceptance; do not declare it closed from these checks.
