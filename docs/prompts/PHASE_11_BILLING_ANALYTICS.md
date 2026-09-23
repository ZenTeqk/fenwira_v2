# Phase 11 — Billing, Wallet, Analytics & Administration

**Goal:** a tenant can understand its usage, operational performance and billing from inside Fenwira.

**Read:** `AGENTS.md`, `docs/BILLING.md`, `docs/OBSERVABILITY.md`, `docs/API_SPEC.md`.

## Build

### Subscription and entitlements

- `Plan` (Free/Trial, Starter, Growth, Business), `Subscription` (tenant, plan, status, period, trial end) and `Entitlement` values per plan: `max_users`, `max_contacts`, `max_campaigns`, `automation_enabled`, `api_enabled`, `analytics_retention`.
- One `EntitlementService.check(tenant, key)` plus a `@RequireEntitlement()` guard. **Plan names are never hard-coded in feature code.**
- Limit breaches return a typed error, and the UI shows an upgrade prompt.
- A payment provider is **out of scope**. Plan changes are admin-driven, behind an interface ready for a provider later.

### Wallet (immutable ledger)

- `Wallet`, `WalletTransaction` (append-only: credit/debit, amount in minor units, currency, reason, reference, balance_after) and `UsageEvent` (billable messages by category/country, priced from a `PriceBook`).
- The balance is derived from the ledger, never set directly. UPDATE and DELETE are revoked on the transactions table.
- Debits happen when Meta confirms a billable message (from the status/pricing webhook), with idempotency on the message ID.
- A low-balance threshold sends a notification. Insufficient balance blocks new campaign launches (not inbox replies), per `BILLING.md`.
- UI: available credits, this month's spend, Add Credits (admin/manual for now), and transaction history with filters and export.

### Analytics

- `AnalyticsEvent` (append-only) for MESSAGE_SENT/DELIVERED/READ/FAILED, CAMPAIGN_STARTED/COMPLETED, CONVERSATION_OPENED and AUTOMATION_EXECUTED, emitted from domain events.
- Daily rollup tables are built by a scheduled job. Retention is enforced by the `analytics_retention` entitlement.
- Dashboard and Analytics pages: messages, delivery/read/failure rates, campaign performance, agent first-response and resolution time, conversation volume, automation executions, usage and cost. Date range and filters. The Dashboard landing page uses KpiCards plus trends.

### Administration

- Integrations → API: tenant API keys (shown once, stored hashed, scoped, revocable, last-used). Public API auth via `Authorization: Bearer`, gated by `api_enabled`.
- Integrations → Webhooks: outbound event subscriptions (HMAC-signed, retries, a delivery log).
- In-app notifications (bell): low balance, template decisions, campaign completion, connection problems.

## Acceptance criteria

- [ ] The wallet balance equals the sum of ledger entries in every test, and a concurrent debit test shows no double spend.
- [ ] Duplicate pricing webhooks debit once.
- [ ] Changing a plan's entitlements changes behavior with no code change (test flips `automation_enabled`).
- [ ] Dashboard numbers reconcile with raw message and campaign tables for a seeded dataset.
- [ ] API keys work for the public API, and revoking one takes effect immediately.
