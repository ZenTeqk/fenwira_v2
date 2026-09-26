# Billing

## Scope

Subscription plans, entitlements, the prepaid wallet with its immutable ledger, message usage pricing, and the billing UI. A payment provider is **out of scope for v2** (decision B2): payments, top-ups and invoicing are manual operations, and plan changes and credits are admin-driven, behind interfaces a provider can implement when it's commercially needed.

## Decisions

### Plans (seeded, global)

| Key | Name | Intended for |
| --- | --- | --- |
| `TRIAL` | Free trial (14 days) | Evaluation |
| `STARTER` | Starter | Small teams |
| `GROWTH` | Growth | Growing teams running campaigns and automations |
| `BUSINESS` | Business | Larger teams, API access, long analytics retention |

Prices live in `plans.price_minor`. **All prices, entitlement values and price-book entries are configuration data** (decision B1): seeded rows, changed by an admin, never hard-coded in the application. Final commercial pricing is decided before billing launch. **Plan keys are never referenced in feature code.** Only entitlements are.

### Entitlements

| Key | Type | TRIAL | STARTER | GROWTH | BUSINESS |
| --- | --- | --- | --- | --- | --- |
| `max_users` | int | 3 | 5 | 15 | 50 |
| `max_contacts` | int | 1,000 | 10,000 | 100,000 | 1,000,000 |
| `max_phone_numbers` | int | 1 | 1 | 3 | 10 |
| `max_campaigns_per_month` | int | 5 | 30 | 200 | unlimited (`-1`) |
| `automation_enabled` | bool | true | false | true | true |
| `max_active_flows` | int | 3 | 0 | 25 | 200 |
| `api_enabled` | bool | false | false | true | true |
| `webhooks_enabled` | bool | false | false | true | true |
| `analytics_retention` | days | 30 | 90 | 365 | 730 |

(These numbers are placeholder configuration. Final values are set before billing launch (B1). The mechanism is what's fixed.)

- **Resolution:** `tenant_entitlement_overrides[key]` ?? `plan_entitlements[plan][key]`.
- `EntitlementService.check(key)` returns the value. `EntitlementService.assertWithin(key, currentUsage)` throws `LIMIT_EXCEEDED {key, limit, current}`. `@RequireEntitlement('api_enabled')` guards whole routes (`ENTITLEMENT_REQUIRED`).
- **Enforcement points:** invite/accept membership (`max_users`); contact create and import confirm (`max_contacts`, where the import checks the projected total); connect number (`max_phone_numbers`); campaign launch (`max_campaigns_per_month`); flow publish (`automation_enabled`, `max_active_flows`); API key auth (`api_enabled`); webhook endpoint create (`webhooks_enabled`); analytics queries clamp to `analytics_retention`.
- **Downgrades never delete data.** Over-limit resources keep working read-only where applicable (for example extra flows are paused, and new contacts are blocked until the tenant is under the limit).

### Subscription

- One row per tenant. Status: `TRIALING`, `ACTIVE`, `PAST_DUE` or `CANCELLED`.
- New tenants get `TRIAL` with `TRIALING` and a 14-day `trial_ends_at`. When the trial expires, the tenant moves to read-only mode: sends are blocked (`SUBSCRIPTION_INACTIVE`), and viewing and exporting still work.
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
- The maintenance job releases reservations whose message is terminal but unsettled after a grace period, and alerts on any it finds (operator email, O1).
- `wallet.low_balance` is emitted when the balance crosses below `low_balance_threshold_minor` (on the crossing only, not on every debit).

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
| TRIAL (default) | Yes | `TRIAL_CREDIT_MINOR` granted once when the wallet is created |
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
