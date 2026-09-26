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
-- DEBIT: the balance may not go below -credit_limit_minor (0 by default) → INSUFFICIENT_BALANCE,
--        except as the in-flight accounting rule allows (open question B4)
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
  - **Usable balance** = `balance_minor + credit_limit_minor`. The credit limit is 0 by default, and per-tenant limits are configuration later.
  - Every **new billable outbound message**, from any source (an inbox template, a campaign, an automation or the API), is checked before it is accepted. If the usable balance can't cover its estimated cost (price book by category and recipient country), it is refused with `INSUFFICIENT_BALANCE`.
  - **Never blocked by balance:** inbound messages, status webhooks, non-billable sends (for example freeform replies inside the service window), and essential processing such as consent keywords, sync and maintenance.
  - The final DEBIT still posts from Meta's pricing in the status webhook, because the message was sent and its cost must be recorded. How in-flight sends are accounted, so concurrent sends can't push the balance past the credit limit, is open question B4.
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
| Usable balance below a message's estimated cost | That billable outbound message, from any source (`INSUFFICIENT_BALANCE`). What a running campaign does next is part of B4. | Inbound messages, status updates, non-billable sends, essential processing |
| Balance < campaign estimate | Warning in the Review step only | |
| Subscription inactive (trial expired or CANCELLED) | All outbound sends (`SUBSCRIPTION_INACTIVE`) | Reading, exporting |

### Billing UI

- **Subscription:** current plan, status, renewal or trial end, an entitlement usage table (for example "Users 4 / 5"), and a plan comparison with "Contact us to upgrade" (manual in v2).
- **Wallet:** Available Credits (large, formatted `₹4,827.42`), This Month's spend, a low-balance threshold setting, Add Credits (shows the manual top-up instructions in v2), and Transaction History (DataTable: date, type, reason, reference link, amount, balance after; export CSV).
- **Usage:** billable messages by category and country per day, cost per campaign, cost per phone number.

### Money formatting

Always format from minor units with `Intl.NumberFormat(locale, {style:'currency', currency})`. Never do float arithmetic. Sums use `bigint` on the server and strings in JSON when the value is above `Number.MAX_SAFE_INTEGER` (not expected in v2; contracts use `number` with a `.int().safe()` check).

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| B4 | How in-flight billable sends count against the usable balance, so concurrent sends can't exceed the credit limit (a hold at accept time, or a check against an estimate), and what a running campaign does when a send is refused (pause, or fail the remaining recipients). | Eng/Business |

B1, B2 and B3: Resolved in the specification freeze (2026-09-26); see `PRODUCT.md` → Decision register.
