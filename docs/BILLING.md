# Billing

## Scope

Subscription plans, entitlements, the prepaid wallet with its immutable ledger, message usage pricing, and the billing UI. A payment provider is **out of scope for v2** (decision B2): payments, top-ups and invoicing are manual operations, and plan changes and credits are admin-driven, behind interfaces a provider can implement when it's commercially needed.

## Decisions

### Plans (seeded configuration, global) — decisions P11-D2–D5, D15, D18

| Key | Name | Status |
| --- | --- | --- |
| `STARTER` | Starter | customer plan |
| `GROWTH` | Growth | customer plan; the trial resolves to its entitlements (P11-D5) |
| `BUSINESS` | Business | customer plan |

Plans, their names and entitlements are rows (decision B1), changed by a platform operator, never referenced by key in feature code. **Prices are not approved (P11-D4):** `plan_prices` holds no production value and the UI shows "Contact us". Monthly cadence at launch (P11-D3).

### Entitlements (launch defaults, configuration)

| Key | Type | STARTER | GROWTH | BUSINESS | Source |
| --- | --- | --- | --- | --- | --- |
| `max_users` | int | 3 | 10 | 25 | P11-D2 |
| `max_contacts` | int | 5,000 | 25,000 | 100,000 | P11-D2 |
| `max_active_flows` | int | 5 | 20 | 100 | P11-D2 |
| `automation_enabled` | bool | true | true | true | implied by P11-D2 (every plan has active flows) |
| `api_enabled` | bool | false | true | true | P11-D18 |
| `webhooks_enabled` | bool | false | true | true | P11-D18 |
| `analytics_retention` | days | 30 | 90 | 365 | P11-D15 |

Every other key (`max_phone_numbers`, `max_campaigns_per_month`, `automation_execution_limit`) is **unset**, which resolves to unlimited; values are not invented (P11-D2).

- **Resolution (Phase 11 Step 4, `SubscriptionEntitlementSource`):** an unexpired `tenant_entitlement_overrides[key]` wins; otherwise the subscription decides — `TRIALING` → the trial profile (`BILLING_TRIAL_PLAN`, default GROWTH); `ACTIVE` → its plan; `EXPIRED`/`CANCELLED` → the last plan's (or trial profile's) limits with `api_enabled` and `webhooks_enabled` forced off. An unset key is unlimited/enabled. `EntitlementsService` stays the only authority; feature code never names a plan. `BILLING_SUBSCRIPTIONS_ENFORCED=false` (default) keeps the allow-all source.
- **Limit checks are transactional:** `assertWithin(tx, tenantId, key, increment)` takes `pg_advisory_xact_lock(hashtext(tenant:key))`, counts, and refuses with 422 `LIMIT_EXCEEDED {key, limit, current}`; concurrent creates at limit−1 admit exactly one.
- `EntitlementService.check(key)` returns the value. `EntitlementService.assertWithin(key, currentUsage)` throws `LIMIT_EXCEEDED {key, limit, current}`. `@RequireEntitlement('api_enabled')` guards whole routes (`ENTITLEMENT_REQUIRED`).
- **Enforcement points:** invite/accept membership (`max_users`); contact create and import confirm (`max_contacts`, where the import checks the projected total); connect number (`max_phone_numbers`); campaign launch (`max_campaigns_per_month`); flow publish (`automation_enabled`, `max_active_flows`); API key auth (`api_enabled`); webhook endpoint create (`webhooks_enabled`); analytics queries clamp to `analytics_retention`.
- **Downgrades never delete data.** Over-limit resources keep working read-only where applicable (for example extra flows are paused, and new contacts are blocked until the tenant is under the limit).

### Subscription

- One row per tenant (`subscriptions`, RLS). Status: `TRIALING`, `ACTIVE`, `EXPIRED` or `CANCELLED` (`PAST_DUE` reserved). **Trial is a status, not a plan** — there is no `TRIAL` plan key.
- Every new workspace starts `TRIALING` for `BILLING_TRIAL_DAYS` (14, P11-D5) with the entitlements of `BILLING_TRIAL_PLAN` (GROWTH); existing workspaces were backfilled with a fresh 14-day trial (P11-D25). FREE billing mode is not exempt (P11-D27); billing mode and wallet state stay independent of the subscription.
- **Activation (P11-D24):** the OWNER requests a plan (`POST /billing/subscription/request`, event `subscription.plan_requested` → operator alert); a platform operator activates it (`pnpm --filter @fenwira/worker subscription:activate`). Overrides: `entitlement:override`. Monthly periods roll in the `subscriptions-tick` job; `POST /billing/subscription/cancel` ends at period end.
- **Lifecycle job:** `billing.maintenance` `subscriptions-tick` every 15 min (X20 `system.subscriptions_due`): T-3 and T-1 trial notices, trial expiry → `EXPIRED`, period roll, cancel at period end. Idempotent (conditional status updates, notification dedupe keys).
- **Downgrade is immediate (P11-D26).** If analytics retention shrinks, a 30-day override keeps the old window (P11-D28).
- **Suspension after expiry:** template sends not from SYSTEM are refused (`SUBSCRIPTION_INACTIVE`); running campaigns pause (`PAUSED`, reason `SUBSCRIPTION_INACTIVE`, resumable after activation); webhook fan-out stops and pending retries close as `FAILED` `SUSPENDED_BY_PLAN` (not counted toward auto-disable); API keys get 403 `ENTITLEMENT_REQUIRED` but are never deleted. Inbound is never blocked.
- **Trial expiry (P11-D6):** status `EXPIRED`. Nothing is deleted; customer-initiated **billable** outbound sends are refused with `SUBSCRIPTION_INACTIVE`; gated capabilities (automations, API, webhooks) resolve off; inbound messages, status updates and non-billable processing continue; members can read and export, and the OWNER can review the workspace and choose a plan.
- **Downgrades (P11-D16):** no data is deleted; a resource above its new limit is reported **over limit**; only user-initiated growth of that resource is refused (`LIMIT_EXCEEDED`); inbound messages and contacts created by inbound messages are always accepted; active flows keep running and aren't disabled, but none can be published or resumed while over the flow limit. No grace period: the downgrade applies immediately (P11-D26).
- `BillingProvider` interface (`createCheckout`, `handleWebhook`, `cancel`). v2 ships `ManualBillingProvider`, where a platform admin changes plans through the API.

### Wallet (prepaid credits for WhatsApp messages)

- One wallet per tenant, in the tenant's currency (default INR).
- **The ledger is the truth.** `wallet_transactions` is append-only: UPDATE and DELETE are revoked from `fenwira_app`.
- `wallets.balance_minor` is a cache, maintained **only** by an `AFTER INSERT` trigger on `wallet_transactions` that sets it to the new `balance_after_minor`. The maintenance job verifies `balance_minor = SUM(amount_minor)` daily and alerts on drift.
- **Posting a transaction** (the only write path, `WalletService.post`):

```sql
BEGIN;  -- inside withTenant
SELECT balance_minor FROM wallets WHERE id = $w FOR UPDATE;          -- serialize per wallet
-- DEBIT: settles a reservation (B4), so the balance stays within the credit limit;
--        a reconciliation difference is recorded as-is
INSERT INTO wallet_transactions (..., amount_minor, balance_after_minor, idempotency_key) VALUES (...)
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;               -- replay-safe
COMMIT;
```

| Type | Sign | Created by |
| --- | --- | --- |
| `CREDIT` | + | A manual top-up recorded by an admin in v2 (a provider later, B2) |
| `DEBIT` | − | Usage pricing (`billing.usage` processor) |
| `ADJUSTMENT` | ± | Platform admin, with a required reason |
| `REFUND` | + | Reversal of a DEBIT (for example a message later marked non-billable) |

- **Balance enforcement (decision B3).** Unlimited negative balances are not allowed.
  - **Available funds** = `balance_minor + credit_limit_minor − reserved_minor`. The credit limit is 0 by default, and per-tenant limits are configuration later.
  - Every **new billable outbound message**, from any source (an inbox template, a campaign, an automation or the API), must **reserve** its estimated cost before it is accepted (below). If the available funds can't cover it, it is refused with `INSUFFICIENT_BALANCE`.
  - **Never blocked by balance:** inbound messages, status webhooks, non-billable sends (for example freeform replies inside the service window), and essential processing such as consent keywords, sync and maintenance.
  - The final DEBIT posts from Meta's pricing in the status webhook, and it settles the message's reservation.

### Reservations (decision B4)

A simple balance check just before sending is **not** enough, because concurrent workers would spend the same funds. Billable messages use an atomic reservation:

```sql
BEGIN;  -- inside withTenant, in the same transaction that accepts the message
SELECT balance_minor, credit_limit_minor, reserved_minor FROM wallets WHERE id = $w FOR UPDATE;
-- available = balance + credit_limit - reserved; if available < estimate → INSUFFICIENT_BALANCE
INSERT INTO wallet_reservations (message_id, amount_minor, status) VALUES ($m, $estimate, 'ACTIVE')
  ON CONFLICT (message_id) DO NOTHING;                                -- idempotent per message
UPDATE wallets SET reserved_minor = reserved_minor + $estimate WHERE id = $w;   -- only if inserted
COMMIT;
```

The wallet row lock serializes reservations, so two workers can never reserve the same funds.

| Lifecycle event | Effect |
| --- | --- |
| Accepted billable message | Reserve the estimate (price book by category and recipient country) |
| Meta reports it billable (pricing in the status webhook) | **Settle**: post the DEBIT with the actual price, mark the reservation SETTLED, and subtract it from `reserved_minor` |
| Actual price differs from the estimate | **Reconcile**: the DEBIT uses the actual price, and the reservation is closed at its estimate, so the difference is recorded, never lost |
| Final non-billable outcome (permanent failure, or Meta reports it non-billable) | **Release**: mark it RELEASED with a reason, and subtract it from `reserved_minor` |
| Retryable failure | **Keep** the reservation through the retry lifecycle. It is released only when the message reaches a final state. |

- Reservations are keyed by message ID. Replays and retries never double-reserve, double-settle or double-release.
- **Stale-reservation recovery** (`billing.maintenance`, every 5 minutes, X17). An ACTIVE reservation older than `BILLING_RESERVATION_GRACE_MINUTES` (default 360) whose message is FAILED, SENT, DELIVERED or READ (or missing) is recovered, per message, idempotently:
  - if a `message.status.changed` event with Meta's pricing was recorded but never applied (a lost or dead-lettered `billing.usage` job), it is applied now: billable pricing **settles**, non-billable releases;
  - otherwise the hold is **released** with reason `recovered: no pricing received`, because nothing says Meta charged for the message.
  Any recovery raises an operations alert (O1) with counts and workspace IDs. Recurring alerts point at lost status webhooks or a failing consumer.
- **Daily ledger check** (`billing.maintenance`, 02:15 UTC, X18). Every wallet must satisfy `balance_minor = Σ wallet_transactions.amount_minor` and `reserved_minor = Σ ACTIVE reservations`. Drift raises an operations alert and the `billing_ledger_drift_wallets` gauge. Nothing is corrected automatically: drift is a bug to investigate, and a fix is an audited ADJUSTMENT.

### Wallet state (decisions P11-D1, P11-D12)

- **Threshold:** `billing.low_balance_threshold` = env `BILLING_LOW_BALANCE_THRESHOLD_MINOR`, platform-level, minor units of the wallet currency. Default **10 000 (₹100)**, the approved production default (P11-D12). Tenant-specific thresholds (`wallets.low_balance_threshold_minor`) stay unused unless requirements justify them.
- **State** (computed by the backend; the UI renders it and never compares amounts):

| State | Condition |
| --- | --- |
| `NOT_ENFORCED` | Billable sends don't reserve funds for this workspace (FREE mode or the platform switch off) |
| `NORMAL` | available > threshold |
| `LOW_BALANCE` | 0 < available ≤ threshold |
| `INSUFFICIENT_FUNDS` | available ≤ 0 |

- `GET /billing/wallet` returns it with the amounts; `GET /workspace/status` returns it to every member (amounts only with `billing.read`). The same state drives the shell, the dashboard's Needs attention, the Wallet page and the notifications.
- **Crossings:** every wallet change (reserve, settle, release, ledger post) re-reads the locked wallet and compares its funds state with `wallets.funds_state`. On a change it stores the new state and writes, in the same transaction:
  - `wallet.funded {walletId, to, availableMinor, currency}` the first time an unfunded wallet (`funded_at` null) has available funds (P11-D21: initial funding, not a recovery; it notifies only if it is already LOW_BALANCE);
  - for a funded wallet, `wallet.low_balance {walletId, from, to, availableMinor, currency}` (into LOW_BALANCE or INSUFFICIENT_FUNDS) or `wallet.recovered {walletId, from, availableMinor, currency}` (back to NORMAL from INSUFFICIENT_FUNDS or LOW_BALANCE; "Wallet balance restored").
  The first recording for a wallet (row initialization, including a trial credit granted at creation) sets the state silently. A settlement records the state once, after both the debit and the release of the hold, so no intermediate state is emitted.
- **Notifications** (`notifications.dispatch`): members whose role has `billing.read` get an in-app notification per crossing (deduplicated per event) and, for LOW_BALANCE and INSUFFICIENT_FUNDS, an email (at most once per member and event). Nothing is sent when billing isn't enforced for the workspace, or when a later change already superseded the crossing. Operators get an operations alert when a campaign pauses for insufficient funds, because they make the top-ups (P11-D13).
- **Billing contact (P11-D20):** `BILLING_SUPPORT_EMAIL` / `BILLING_SUPPORT_URL` (`billing.support_email`, `billing.support_url`), returned as `support` by `GET /billing/wallet`. When set, the Wallet page shows "Contact billing" and billing emails name the contact; when unset, both show "Contact Fenwira to arrange a top-up" with no action. There is no self-service top-up (P11-D19).

### Fund types (decision P11-D7)

Ledger rows carry `fund_type` `PAID` (default) or `PROMOTIONAL` (trial and promotional credits; the Phase 9 trial credits were classified by the migration) and an optional `expires_at`. Expiry is metadata only: no expiry policy or spend order is applied until P11-Q23 is decided, and available funds are the single balance.

### Transactions API

- `GET /billing/wallet/transactions?type&from&to&cursor&limit` (`billing.read`): the ledger, newest first. `from`/`to` take a date (whole UTC day, inclusive) or a timestamp.
- `POST /billing/wallet/transactions/export {type?, from?, to?}` (`billing.read`): CSV (amounts in major units with the currency column; text cells guarded against spreadsheet formulas), synchronous up to 50 000 rows, else 422 `EXPORT_TOO_LARGE`. Audited as `billing.transactions.exported`.

### Usage pricing

- The trigger is `message.status.changed` carrying Meta `pricing { billable: true, category }`, which Meta sends with the `sent` or `delivered` status.
- `billing.usage` processor:
  1. Idempotent on `usage_events (tenant_id, type, message_id)`.
  2. Look up the price: `price_book_entries` by `(category, recipient country)`, falling back to `(category, null)`, effective at the event time. `unit_price_minor` already includes Fenwira's markup (`markup_bps` is stored for reporting).
  3. Insert `usage_events` and post a DEBIT with `idempotency_key = usage:{messageId}`.
- Non-billable messages (for example service messages, or utility messages inside the service window, per Meta's current pricing model) produce no usage event.
- **Meta's pricing model changes over time.** The price book and the category mapping are data, not code. Updating them needs no deploy.

### Blocking rules

| Condition | Blocks | Doesn't block |
| --- | --- | --- |
| Available funds below a message's estimated cost | That billable outbound message, from any source (`INSUFFICIENT_BALANCE`). A running campaign moves to `PAUSED_INSUFFICIENT_FUNDS` (`CAMPAIGN_ENGINE.md`). | Inbound messages, delivery/read status updates, non-billable sends, essential processing |
| Balance < campaign estimate | Warning in the Review step only | |
| Subscription inactive (trial expired or CANCELLED) | All outbound sends (`SUBSCRIPTION_INACTIVE`) | Reading, exporting |

### Billing modes (decision P9-D1)

| Mode | Enforced (platform switch on) | Wallet |
| --- | --- | --- |
| FREE | Never | Untouched |
| TRIAL (default) | Yes | `TRIAL_CREDIT_MINOR` granted once when the wallet is created (a PROMOTIONAL ledger row) |
| PREPAID | Yes | Manual top-ups (B2) |

`BILLING_ENFORCED` is the platform switch: false in development and tests, true in production. POSTPAID is not part of v2. Operators change modes with `pnpm --filter @fenwira/worker billing:mode -- --tenant <id> --mode PREPAID` until the Phase 11 admin UI.

### Price book structure (decision P9-D2)

`customer_price_minor` is what the tenant is charged. `provider_cost_minor` is Meta's cost (reporting and margin), `markup_bps` and `tax_code`/`tax_bps` are metadata for Phase 11 invoicing, and `is_placeholder` plus `note` flag values that aren't commercial pricing. Usage events store the charge and the provider cost. Commercial pricing, markup, plans and GST are Phase 11.

### Implemented in Phase 9 (the wallet core B3/B4 needs)

- `wallets`, the append-only `wallet_transactions` (the trigger maintains `balance_minor`), `wallet_reservations`, `usage_events` and `price_book_entries`. The price book is seeded with **placeholder** INR prices (MARKETING 88, UTILITY 13, AUTHENTICATION 13, SERVICE 0 paise), which are configuration, not code (B1).
- `apps/api/src/modules/billing/wallet.core.ts`: reserve (in MessagingService's accept transaction, under the wallet row lock), settle (a DEBIT at the price for Meta's pricing category and the recipient's country, closing the reservation at its estimate), release (a final failure or non-billable) and credits. All are idempotent. `billing.usage` settles from `message.status.changed`, and every failure path of the outbound worker emits that event.
- **`BILLING_ENFORCED`** (env, default `false`) is the platform switch; each tenant's billing mode then decides (above).
- Manual top-ups (B2): `pnpm --filter @fenwira/worker wallet:credit -- --tenant <id> --amount 500`. `GET /billing/wallet` shows the balance, credit limit, held and available funds.
- **Not yet built (Phase 11):** plans, subscriptions and entitlements, the billing UI, the low-balance notification and the daily ledger check. **Stale-reservation recovery** is a high-priority production-readiness item (ROADMAP).

### Billing UI

- **Subscription:** current plan, status, renewal or trial end, an entitlement usage table (for example "Users 4 / 5"), and a plan comparison with "Contact us to upgrade" (manual in v2).
- **Wallet:** Available Credits (large, formatted `₹4,827.42`), This Month's spend, a low-balance threshold setting, Add Credits (shows the manual top-up instructions in v2), and Transaction History (DataTable: date, type, reason, reference link, amount, balance after; export CSV).
- **Usage:** billable messages by category and country per day, cost per campaign, cost per phone number.

### Money formatting

Always format from minor units with `Intl.NumberFormat(locale, {style:'currency', currency})`. Never do float arithmetic. Sums use `bigint` on the server and strings in JSON when the value is above `Number.MAX_SAFE_INTEGER` (not expected in v2; contracts use `number` with a `.int().safe()` check).

## Open questions

None. Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.
