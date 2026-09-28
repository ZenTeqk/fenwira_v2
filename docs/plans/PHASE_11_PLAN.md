# Phase 11 implementation plan: Billing, Analytics and Administration

**Status:** approved (2026-09-28) with decisions P11-D2–D19 (§10). Progress: Step 1 (wallet integrity and Wallet UI) implemented; see `BILLING.md` → Wallet state. Implementation proceeds in the §8 order. Production subscription prices, GST invoice issuance, a payment gateway and a permanent usage markup stay unbuilt until their values/rules are approved.
**Inputs:** `docs/prompts/PHASE_11_BILLING_ANALYTICS.md`, `docs/BILLING.md`, `docs/DATABASE.md` → Billing / Analytics & developer, `docs/API_SPEC.md` → P11, `docs/MULTI_TENANCY.md` (X7, X9, X10), `docs/DATA_RETENTION.md`, `docs/OBSERVABILITY.md`, the decision register in `docs/PRODUCT.md` (B1–B4, P9-D1, P9-D2, API1, O1), and the Design System v1 contract (`docs/design/FENWIRA_DESIGN_SYSTEM.md`, `docs/design/UX_PATTERNS.md`, `docs/design/UI_AUDIT.md`, `AGENTS.md`).
**Scope:** 11A Plans & Entitlements · 11B Wallet & Usage · 11C Billing Operations · 11D Analytics · 11E API, Webhooks & Administration.

## Principles

1. **No commercial decision is made in this plan or in code.** Plan names, prices, limits, trial terms, credits, markup, tax, top-ups, retention and API availability are product decisions (§10). Code reads them as configuration (decision B1); seeds used for development are labelled placeholders and never shipped as commercial values.
2. **Feature code asks about entitlements, never plans.** `EntitlementsService` (built in Phase 10, decision P10-D3) stays the single boundary; Phase 11 replaces its allow-all source with plan data.
3. **The ledger is the financial truth.** Balances, usage charges and invoices come from `wallet_transactions` and `usage_events`. Analytics aggregates never feed money.
4. **The backend owns every state the UI shows.** Wallet state, entitlement usage and limits are computed server-side and rendered, not re-derived in the browser (the same rule as the eligibility endpoint in Design System v1).
5. **Design System v1 is binding.** Every screen uses the shared page patterns and `packages/ui` components and passes the UI quality gate (`UX_PATTERNS.md` §13). No parallel components.
6. **Existing architecture is reused, not rebuilt:** outbox → queues, RLS/`withTenant`, `system.*` functions, `MessagingService`, the wallet core (reserve/settle/release), `safeFetch` (P10-D4) and the notifications module.

## Decided before planning

| # | Decision | Effect on this plan |
| --- | --- | --- |
| **P11-D1** | **Low balance is a billing-domain state, not a UI rule** (product owner, 2026-09-28). The threshold is configuration (`billing.low_balance_threshold`); development may keep ₹100 as a documented default; production must set it through configuration. The backend exposes the resulting wallet state and the frontend renders it. No tenant-specific thresholds unless Phase 11 requirements justify them. | §2.3. One source of truth drives the dashboard's Needs attention, the Billing UI, low-balance notifications and operational alerts. The current frontend constant (`LOW_BALANCE_MINOR` in `apps/web/lib/workspace-status.ts`) is removed in 11B. |
| DS-v1 | Design System v1 accepted (`ui-design-system-v1`, 9a0933d). Remaining UI debt is backlog, not Phase 11 scope (see `PRODUCT.md` → Product backlog). | §7. The Contact → Campaigns tab is revisited in 11D. |
| B1–B4, P9-D1, P9-D2 | Configuration-driven prices and entitlements; manual payments/invoicing; no unlimited negative balance; atomic reservations; billing modes FREE/TRIAL/PREPAID; price book separates provider cost and customer charge. | Binding throughout. |

## What already exists (reuse)

| Piece | From | Phase 11 use |
| --- | --- | --- |
| `wallets`, `wallet_transactions` (append-only, trigger-maintained balance), `wallet_reservations`, `usage_events`, `price_book_entries` | Phase 9 | 11B builds read models, state and UI on top; no ledger redesign |
| `wallet.core.ts` reserve / settle / release / credit, `billing.usage` processor | Phase 9 | Unchanged semantics; 11B adds recovery, the daily ledger check and low-balance events |
| `tenants.billing_mode`, `BILLING_ENFORCED`, `billingEnforcedFor` | Phase 9 closure | Subscription status and billing mode stay distinct concepts (§10, P11-Q9) |
| `EntitlementsService` + `ENTITLEMENT_SOURCE`, checks at flow publish and execution start | Phase 10 | 11A plugs in the plan-backed source and adds the remaining enforcement points |
| Permissions `billing.read`, `billing.manage`, `analytics.read`, `integrations.manage` | Phase 3 | Guard the new routes; no new roles |
| Queues `analytics.events`, `notifications.dispatch`, `webhooks.deliver` (declared, unconsumed) | Phase 1 | Consumed in 11D / 11E |
| `system.resolve_api_key` (X7), `system.purge_expired` (X9), `system.tenants_with_activity` (X10) | Spec | Implemented in 11E / 11D |
| Notifications module (in-app bell), audit module | Phases 7, 3 | Low balance, template decisions, campaign completion, connection problems |
| `safeFetch` (SSRF-safe HTTP, P10-D4) | Phase 10 | Outbound webhook deliveries in 11E |
| Design System v1 patterns and components | DS v1 | Every screen in §7 |
| CLI `billing:mode`, `wallet:credit` | Phase 9 | Replaced by audited admin operations in 11C (kept for emergencies) |

---

## 11A — Plans & Entitlements

### Model

Tables as drafted in `DATABASE.md` (`plans`, `plan_entitlements`, `subscriptions`, `tenant_entitlement_overrides`), with these refinements:

- `plans.key` is **free text with a unique index**, not an enum: plan identities are data (B1), and an enum would hard-code the placeholder names `TRIAL/STARTER/GROWTH/BUSINESS` into the schema. Feature code never reads `plans.key`.
- `plans` carries `status (ACTIVE|RETIRED)` so a plan can stop being offered without breaking tenants on it, and `is_public` for the comparison table.
- Prices move to `plan_prices (plan_id, interval MONTH|YEAR, currency, amount_minor, effective_from, effective_to)` so monthly and annual pricing (P11-Q3) and price changes don't rewrite history. Whether annual pricing exists at all is a decision.
- `plan_entitlements.value jsonb` holds the typed value; the catalog of keys and their types lives in `packages/contracts` (`ENTITLEMENT_KEYS`) so unknown keys are rejected at seed time.
- `tenant_entitlement_overrides` exists for operations (for example a custom deal) but is **not surfaced** in the UI unless a decision requires it.

### Entitlement catalog (mechanism only; values are P11-Q4)

| Key | Type | Enforcement point (existing code path) | Error |
| --- | --- | --- | --- |
| `automation_enabled` | bool | Flow publish, execution start (built in Phase 10) | `ENTITLEMENT_REQUIRED` |
| `max_active_flows` | int | Flow publish / resume (Phase 10) | `LIMIT_EXCEEDED` |
| `automation_execution_limit` | int/month | Execution start → `SKIPPED_ENTITLEMENT` (Phase 10) | recorded on the trigger run |
| `max_users` | int | Invite, invitation accept | `LIMIT_EXCEEDED` |
| `max_contacts` | int | Contact create, inbound auto-create*, import confirm (projected total) | `LIMIT_EXCEEDED` |
| `max_phone_numbers` | int | Connect number | `LIMIT_EXCEEDED` |
| `max_campaigns_per_month` | int | Campaign launch | `LIMIT_EXCEEDED` |
| `api_enabled` | bool | API key authentication, key creation | `ENTITLEMENT_REQUIRED` |
| `webhooks_enabled` | bool | Webhook endpoint create; delivery dispatch | `ENTITLEMENT_REQUIRED` |
| `analytics_retention` | days | Analytics queries clamp; retention job | clamped range + notice |

\* An **inbound** message from a new number can never be refused (it already arrived at Meta). What happens to contacts created by inbound traffic above `max_contacts` is part of P11-Q16.

`-1` means unlimited. `EntitlementsService` gains `limit(key)`, `usage(key)` and `assertWithin(key, projected)`; usage counters are computed by one query per key inside the caller's transaction (no counters table in v2; revisit if a query is slow).

### Subscription lifecycle (mechanism; terms are decisions)

`subscriptions (status TRIALING|ACTIVE|PAST_DUE|CANCELLED, current_period_start/end, trial_ends_at, plan_id)`, one per tenant. A scheduled job (`billing.lifecycle`, every 15 min via `system.subscriptions_due(now)`, a new X-function) moves trials and periods on. What a new tenant gets (trial or not, which plan, how long) is **P11-Q5/Q6**; what an expired trial or a downgrade does is **P11-Q16**. The existing spec text ("14-day trial, then read-only") is treated as a placeholder until answered.

`SUBSCRIPTION_INACTIVE` blocks outbound sends inside `MessagingService` (the same gate position as the balance check), so campaigns and automations inherit it without their own logic.

### UI

| Screen | Route | Pattern | Components |
| --- | --- | --- | --- |
| Subscription | `/billing/subscription` | `DetailPage` | `SummaryItem` strip (plan, status, renewal/trial end), entitlement usage as a `DataTable` ("Users 4 / 5" with a `StatusBadge` at ≥ 80 % / 100 %), plan comparison table, "Contact us to change plan" (manual, B2) |
| Upgrade prompt | wherever `LIMIT_EXCEEDED` / `ENTITLEMENT_REQUIRED` occurs | `Alert` + `PermissionState`-style panel | Names the limit and current usage; the action is permission-aware (`billing.manage` sees "View plans") |

---

## 11B — Wallet & Usage

### 2.1 Stale-reservation recovery (production-readiness, High)

A recovery pass (`billing.maintenance`, every 5 min, new X-function `system.stale_reservations(older_than, limit)`, IDs only) finds ACTIVE reservations whose message is terminal, or missing, beyond a grace period, and settles or releases them through the existing idempotent paths keyed by message id. It alerts the operations address (O1) with counts. Tests: crash between accept and send; message FAILED without a status event; replay of the recovery pass.

### 2.2 Daily ledger check

`balance_minor = SUM(amount_minor)` and `reserved_minor = SUM(ACTIVE reservations)` per wallet, daily; drift raises an operational alert and never auto-corrects.

### 2.3 Wallet state (P11-D1)

- Configuration `billing.low_balance_threshold` (platform-level, minor units, in the wallet currency), env `BILLING_LOW_BALANCE_THRESHOLD_MINOR`. Default 10 000 (₹100), which P11-D12 approved as the production default, so production doesn't need to override it.
- `wallets.low_balance_threshold_minor` (already in the schema) stays unused unless tenant-specific thresholds are approved.
- The backend computes and returns **`state`** with the wallet:

| State | Condition | Shown as |
| --- | --- | --- |
| `NOT_ENFORCED` | billing not enforced for the tenant (FREE mode or platform switch off) | "Messages aren't billed" |
| `NORMAL` | available > threshold | amount |
| `LOW_BALANCE` | 0 < available ≤ threshold | warning status |
| `INSUFFICIENT_FUNDS` | available ≤ 0 (no billable message can reserve) | danger status |

  `available = balance + credit_limit − reserved` (B3/B4). The state is returned by `GET /billing/wallet` and by a new small `GET /workspace/status` summary for the shell and dashboard (members without `billing.read` get the state without amounts), so the frontend renders `state` and deletes its own threshold comparison.
- **Event:** `wallet.low_balance` (catalog entry exists) is emitted in the posting transaction **on the crossing** into `LOW_BALANCE` or `INSUFFICIENT_FUNDS`, not on every debit; `wallet.recovered` on crossing back. Consumers: `notifications.dispatch` (bell + email to members with `billing.read`), and the operations alert for `INSUFFICIENT_FUNDS` when a campaign pauses.

### 2.4 Usage read models

Usage is read from `usage_events` (the ledger's source), never from analytics:

- `GET /billing/usage?from&to&groupBy=day|category|country|campaign|phoneNumber` → rows of `{key, messages, customerChargeMinor, providerCostMinor?}`. Provider cost is returned only if P11-Q10 allows showing it to tenants; otherwise it stays internal (margin reporting for operators).
- `GET /billing/wallet/transactions?type&from&to&cursor` and `POST /billing/wallet/transactions/export` (CSV, streamed like contact exports).

### UI

| Screen | Route | Pattern | Components |
| --- | --- | --- | --- |
| Wallet | `/billing/wallet` | `DetailPage` | `MetricCard`s: available (state as `StatusBadge`), held for sends in progress, this month's spend, promotional credits remaining (if P11-Q7 introduces them); banner for `LOW_BALANCE`/`INSUFFICIENT_FUNDS` with the top-up instructions (P11-Q13); transaction history `DataTable` (type, reason, reference link, amount right-aligned, balance after) with `FilterBar` (type, date) and CSV export |
| Usage | `/billing/usage` | Analytics pattern (§4) | Date range → metrics (messages, charge) → one chart (daily charge by category) → breakdown tables (category, country, campaign, number) |
| Dashboard / shell | existing | — | Render backend `state`; Needs attention uses it (removes the frontend constant) |

---

## 11C — Billing Operations

### 3.1 Who operates billing (P11-Q17, architecture)

The specs say "platform admin" for credits, adjustments and plan changes, but **no platform-operator identity exists** today (only CLI scripts). Options:

| Option | Description | Trade-off |
| --- | --- | --- |
| A. CLI only (status quo) | Extend the audited CLIs (`wallet:credit`, `billing:mode`, new `plan:change`, `wallet:adjust`) | Cheapest; no UI; operators need shell access |
| **B. Platform operator role (recommended)** | `users.platform_role (NONE|OPERATOR)` set only by CLI; a separate `/platform` area in the API and web, outside tenant RLS, using new `system.*` functions for the few cross-tenant reads; every action audited with the operator id; 2FA required | A real back-office; needs its own security review and tests |
| C. Separate admin application | Its own app and auth | Heaviest; not justified at v2 scale |

### 3.2 Operations (whichever option)

All are idempotent (Idempotency-Key), audited (actor, reason, before/after), and post through `WalletService`/the subscription service, never by direct table writes:

| Operation | Effect |
| --- | --- |
| Record a top-up | `CREDIT` with payment reference (method per P11-Q13) |
| Grant promotional credit | `CREDIT` with type metadata `PROMOTIONAL`, optional expiry if P11-Q7 introduces expiry (then a `promotional_credit_grants` table and an expiry job posting `ADJUSTMENT`s) |
| Adjustment | `ADJUSTMENT` ± with a required reason; confirmation dialog shows amount and resulting balance (UX_PATTERNS → Confirmation) |
| Refund | `REFUND` referencing a DEBIT |
| Change plan / extend trial / cancel | Subscription change with effective date; downgrade behavior per P11-Q16 |
| Change billing mode | Replaces the `billing:mode` CLI (P9-D1) |

### 3.3 Invoices and tax (P11-Q11, P11-Q14)

`BillingProvider` stays the seam (B2). Whether v2 issues invoices, which document types (tax invoice for top-ups, statement for usage), GST treatment (GSTIN capture, CGST/SGST vs IGST, HSN/SAC codes, rounding), numbering series and storage are decisions. The plan reserves: `billing_profiles (tenant legal name, address, GSTIN, state code)`, `invoices`/`invoice_lines` generated from ledger rows (never recomputed from usage), PDF rendering in the worker and storage in MinIO. **None of this is built until P11-Q11/Q14 are answered.**

### UI

| Screen | Route | Pattern |
| --- | --- | --- |
| Billing profile (tenant) | `/billing/profile` (if invoicing approved) | `SettingsPage` |
| Invoices (tenant) | `/billing/invoices` (if approved) | `ListPage` + download |
| Platform: tenants, wallet operations, plan changes (option B) | `/platform/*` | `ListPage` / `DetailPage` with `useConfirm` impact lists; visually marked as the operator area |

---

## 11D — Analytics

### 4.1 Events and rollups

- The `analytics.events` queue subscribes to existing domain events: `message.outbound.requested` / `message.status.changed` (sent, delivered, read, failed, by category, source, phone number, campaign, flow), `message.inbound.received`, `conversation.opened` and `conversation.assigned` (first-response and resolution times are read from the conversation row when the rollup runs; no new event is needed), `campaign.launched` / `campaign.completed`, and automation terminal states (the reserved `automation.execution.finished` event is emitted from `finishExecution`).
- It appends `analytics_events` (append-only, per-tenant) idempotently by source event id, then updates `analytics_daily_rollups` (tenant, day in the workspace timezone, metric, dims_key) in the same transaction.
- A nightly `analytics.rollup` job (X10, per tenant) rebuilds the last 2 days from events to heal late or missed events; the maintenance job (X9) deletes events and rollups past retention (P11-Q15).
- **Reconciliation test** (acceptance criterion): for a seeded dataset, rollups equal counts computed directly from `messages`, `campaign_recipients` and `automation_executions`.

### 4.2 Views (UX_PATTERNS → Analytics)

One module with tabs (`ModuleTabs`): **Overview · Messaging · Campaigns · Inbox · Automations · Usage**. Every view uses the same pattern: date range (and filters such as phone number) → up to four `MetricCard`s with deltas → one primary chart → breakdown → detail `DataTable`.

| View | Metrics | Primary chart | Breakdown / table |
| --- | --- | --- | --- |
| Overview | Messages sent, delivery rate, open conversations, spend | Daily messages (sent/delivered/read) | Top campaigns, top flows |
| Messaging | Sent, delivered %, read %, failed % | Daily volume by status | By category, source, phone number; failure reasons |
| Campaigns | Campaigns run, recipients, delivery %, read % | Per-campaign results | Campaign table (links to campaign detail) |
| Inbox | Conversations opened, median first response, median resolution, unassigned now | Daily conversations | Per-agent table (assigned, first response, resolved) |
| Automations | Executions, completed %, failed %, stopped by takeover | Daily executions by outcome | Per-flow table |
| Usage | Billable messages, charge | Daily charge by category | Same data as Billing → Usage (§2.4), from the ledger |

Charts: one charting dependency, pinned (ADR-0019), themed through tokens; every chart has a table equivalent for screen readers. Choice of library is an implementation detail recorded as an ADR.

Also in 11D:
- **Dashboard** gains the Messages metric and trends from rollups, and the Needs-attention items that need analytics (failed messages, automation failures).
- **Contact → Campaigns tab** (DS v1 placeholder) lists the contact's campaign recipients via a per-contact query.
- Retention is clamped to `analytics_retention` with a visible notice when the range is cut.

---

## 11E — API, Webhooks & Administration

### 5.1 Public API (decision API1)

- API keys: `api_keys` per `DATABASE.md` (prefix + SHA-256 hash with a server pepper, shown once, scoped to permission keys, last-used, expiry, revocation). Auth `Authorization: Bearer fw_<prefix>_<secret>` via X7; revocation takes effect on the next request (no caching beyond the request).
- Gated by `api_enabled` (P11-Q18 decides per plan) and the key's scopes; requests act as a synthetic principal recorded in audit logs.
- **Surface for v2:** a documented subset of the existing `/api/v1` routes (contacts, messages send, templates read, campaigns read, conversations read) rather than a second API, with its own rate limits per key, published as a public OpenAPI document generated from the same controllers (`x-public: true`). Which routes are public is part of P11-Q18.

### 5.1a Public route allowlist v1 (required by P11-D18 before implementation)

The public API is the existing `/api/v1` routes below, reachable with an API key. Everything else answers 404 to an API key (never 403, so the surface isn't discoverable). The allowlist lives in one place in code (`PUBLIC_API_ROUTES`) and each route is flagged `x-public` in the OpenAPI document; a test asserts the two agree.

| Resource | Method and path | Scope (permission key) |
| --- | --- | --- |
| Contacts | `POST /contacts/search` · `GET /contacts/:id` | `contacts.read` |
| Contacts | `POST /contacts` · `PATCH /contacts/:id` | `contacts.write` |
| Consent | `GET /contacts/:id/consents` | `contacts.read` |
| Consent | `POST /contacts/:id/consents` | `contacts.write` |
| Messaging | `POST /conversations` (start a conversation, usually with a template) · `POST /conversations/:id/messages` | `inbox.reply` |
| Messaging | `GET /messages/:id` (status) · `GET /conversations/:id` | `inbox.read` |
| Templates | `GET /templates` · `GET /templates/approved` | `templates.read` |
| Campaigns (read) | `GET /campaigns` · `GET /campaigns/:id` · `GET /campaigns/:id/stats` | `campaigns.read` |

Rules:
- Sends made with an API key use message source **`API`**: they pass MessagingService's eligibility, window, balance and entitlement checks like any other send, carry the caller's `Idempotency-Key` (required), and **do not** trigger human takeover (only an agent reply does).
- A key's scopes are a subset of the permission keys above and of its creator's permissions at creation time.
- Not exposed: billing, platform, workspace/team/roles, WhatsApp connections, imports/exports, automations administration, audit logs, webhook management, notifications, and every mutation of campaigns and templates.
- Per-key rate limits reuse the existing rate-limit service (values are operational configuration).

### 5.2 Outbound webhooks

- `webhook_endpoints` / `webhook_deliveries` per `DATABASE.md`; events chosen from a public catalog (message status, inbound message, conversation assigned, campaign completed, contact created, automation finished).
- Delivery by the `webhooks.deliver` queue using `safeFetch` (P10-D4: HTTPS, SSRF protection, redirects re-validated, timeouts, size caps), HMAC `X-Fenwira-Signature`, exponential retries for 24 h, then the endpoint is disabled after sustained failure with a notification. Deliveries are at-least-once with an `Idempotency-Key`/event id.
- Delivery log retention 30 days (X9).

### 5.3 Notifications

The bell (Phase 7) gains: low balance / insufficient funds, template approved/rejected, campaign completed or paused, number disconnected or flagged, webhook endpoint disabled. Email copies go to members with the relevant permission. Operational alerts (stale reservations, ledger drift, webhook disablement spikes) go to the operations address (O1).

### UI

| Screen | Route | Pattern | Components |
| --- | --- | --- | --- |
| API keys | `/integrations/api` | `ListPage` | `DataTable` (name, prefix, scopes, last used, status) with `RowActions` (revoke → `useConfirm` impact: "requests with this key stop immediately"); create dialog shows the secret once with copy |
| Webhooks | `/integrations/webhooks` | `ListPage` | Endpoints table, status badges, create/edit dialog (URL, events, secret shown once) |
| Webhook endpoint | `/integrations/webhooks/:id` | `DetailPage` | Summary strip, delivery log `DataTable` with `FilterBar` (status), redeliver action, test event |

---

## 6. Cross-cutting

- **Tenant isolation:** every new tenant table gets RLS, tenant-matrix fixtures (append-only where applicable) and security-matrix coverage. New `system.*` functions (`subscriptions_due`, `stale_reservations`, `tenants_with_activity`, `resolve_api_key`, plus platform-operator reads if option B) need ADR amendment and review per `MULTI_TENANCY.md`.
- **Contracts and OpenAPI:** all new DTOs in `packages/contracts`; `docs/openapi.json` regenerated; the public subset flagged.
- **Errors:** `LIMIT_EXCEEDED {key, limit, current}`, `ENTITLEMENT_REQUIRED {key}`, `SUBSCRIPTION_INACTIVE`, existing `INSUFFICIENT_BALANCE`.
- **Observability:** metrics for entitlement denials by key, wallet state transitions, recovery actions, analytics lag, webhook delivery outcomes; no tenant labels.
- **Data retention:** analytics per P11-Q15; invoices and ledger per legal retention (`DATA_RETENTION.md`, T3 financial records).

## 7. Screens and the design system

Navigation (already defined): **Analytics** (module with the six tabs above), **Billing** (Subscription · Wallet · Usage, plus Invoices/Profile only if approved), **Integrations** (WhatsApp · API · Webhooks). They appear when `SHIPPED_PHASE` reaches 11 and only with the right permission (`analytics.read`, `billing.read`, `integrations.manage`).

Every Phase 11 screen:
- uses `ListPage`, `DetailPage`, `SettingsPage` or the analytics composition of `DashboardLayout`/`MetricCard`/`DataTable`; no page-specific layout systems;
- renders statuses through `StatusBadge` presets (new presets added centrally: subscription `TRIALING`/`PAST_DUE`/`CANCELLED`, wallet `LOW_BALANCE`/`INSUFFICIENT_FUNDS`/`NOT_ENFORCED`, webhook `DISABLED`);
- has loading, first-use empty, filtered-empty, error and permission states; confirms high-impact actions with impact lists (adjustments, API key revoke, endpoint delete, plan change);
- formats money only from minor units with `Intl.NumberFormat` and aligns amounts right with tabular figures;
- passes the UI quality gate: axe WCAG 2.2 AA, keyboard operation, responsive at 375/768/1024/1440, Lighthouse accessibility ≥ 95.

Mobile priority for Phase 11: wallet state and balance, dashboard summary, notifications. Analytics tables scroll inside their cards; charts keep a table alternative.

## 8. Sequencing

| Step | Content | Blocked by decisions |
| --- | --- | --- |
| 1 | 11B foundations that need no commercial input: stale-reservation recovery, daily ledger check, wallet `state` with the development threshold, transactions API and Wallet UI, low-balance events/notifications | P11-Q12 (production value only) |
| 2 | 11D analytics pipeline, rollups, reconciliation, Analytics module, dashboard Messages metric, Contact → Campaigns | P11-Q15 (retention values only; the mechanism can run with placeholder config) |
| 3 | 11E API keys, public API subset, webhooks, notifications | P11-Q18 (public route list and plan gating) |
| 4 | 11A plans/subscriptions/entitlements with placeholder seed data flagged `is_placeholder`; Subscription UI | P11-Q1–Q6, Q16 before production values are loaded |
| 5 | 11C operations (per P11-Q17), promotional credits, top-up recording | P11-Q7, Q13, Q17 |
| 6 | Invoicing / GST | P11-Q11, Q14 (may move out of Phase 11 if deferred) |
| 7 | Full Phase 0–11 regression, docs, OpenAPI | — |

Steps 1–3 can start as soon as this plan is approved; steps 4–6 wait for the listed answers.

## 9. Test strategy

- **Unit:** entitlement resolution (override ?? plan), usage counting, wallet state boundaries (exactly at threshold, zero, negative with credit limit), money formatting, webhook signature, API key hashing.
- **Integration (worker, against the meta-mock):**
  - ledger = Σ entries in every billing test; concurrent sends never over-reserve;
  - duplicate pricing webhooks debit once; stale-reservation recovery settles/releases once;
  - `wallet.low_balance` fires once per crossing;
  - flipping `automation_enabled` / lowering `max_contacts` changes behavior with no code change;
  - dashboard/analytics numbers reconcile with raw tables for a seeded dataset;
  - API key works, revocation is immediate, cross-tenant key use is impossible;
  - webhook delivery retries, disablement and SSRF refusals;
  - tenant isolation for every new route and table.
- **E2E + accessibility:** Wallet, Usage, Subscription, Analytics tabs, API keys, Webhooks: create/revoke/confirm flows; axe WCAG 2.2 on each; Lighthouse on the new top-level pages; visual capture at the four widths.
- **Regression:** the full Phase 0–10 + DS v1 suite.

---

## 10. Decisions (approved 2026-09-28)

| # | Decision | Implementation consequence |
| --- | --- | --- |
| P11-D2 | Plans STARTER, GROWTH, BUSINESS as data. Launch defaults: users 3/10/25, contacts 5,000/25,000/100,000, active flows 5/20/100. Other limits stay configurable and are not invented. | Seeded as configuration rows; keys not referenced in code. Unset limits resolve to unlimited. |
| P11-D3 | Monthly subscriptions at launch; the model may support annual; no annual discount. | `plan_prices.interval` supports YEAR; only MONTH is exposed. |
| P11-D4 | Subscription prices not approved. | No prices seeded as production values; UI shows "Contact us" instead of a price. |
| P11-D5 | 14-day trial with Growth-equivalent entitlements unless configured otherwise. | Config `billing.trial_days` (14) and `billing.trial_entitlements_plan` (GROWTH); resolved through entitlements, no plan-name checks. |
| P11-D6 | At trial expiry: no data deleted; customer-initiated billable outbound and gated paid capabilities off; inbound and status processing continue; the OWNER can review and choose a plan. | Subscription status `EXPIRED`; `SUBSCRIPTION_INACTIVE` on billable sends; capability entitlements resolve off; everything readable. |
| P11-D7 | Configurable promotional/trial credits in the ledger, auditable, distinguishable from paid funds; expiry metadata designed, no expiry policy invented. | Ledger rows carry `fund_type PAID|PROMOTIONAL` and optional `expires_at` (unused until a policy exists). |
| P11-D8 | INR at launch; currency-aware schema; no conversion. | Currency columns kept; single-currency checks. |
| P11-D9 | Modes FREE, TRIAL, PREPAID (POSTPAID later), never derived from plan name. | `tenants.billing_mode` stays independent of the plan. |
| P11-D10 | Provider cost tracked separately from the customer charge. | Usage events and reports carry both; neither is derived from the other. |
| P11-D11 | No permanent markup approved; customer charge stays configuration-driven. | Price book unchanged (placeholders flagged); no markup code. |
| P11-D12 | Low-balance production default ₹100 via `billing.low_balance_threshold`; backend states NORMAL / LOW_BALANCE / INSUFFICIENT_FUNDS / NOT_ENFORCED. | §2.3. |
| P11-D13 | Manual top-ups by platform operators with reason/reference, idempotency and immutable audit. | §3, Step 5. |
| P11-D14 | No final GST/invoice rules; design for tax metadata and invoices; don't block wallet/usage. | No invoices issued; tax metadata kept. |
| P11-D15 | Analytics retention defaults 30/90/365 days via entitlements; financial/audit retention separate. | `analytics_retention` entitlement; purge touches analytics tables only. |
| P11-D16 | Downgrades never delete data; over-limit state; inbound-created contacts always accepted; flows preserved, no activation that increases usage; configurable grace mechanism. | Over-limit reported per key; enforcement only on user-initiated growth; grace configuration recorded (see open items). |
| P11-D17 | PLATFORM_OPERATOR, separate from tenant roles; CLI-granted; mandatory 2FA; separate protected area; short privileged sessions; audited financial operations; least privilege; no separate app. | Step 5. |
| P11-D18 | API and webhooks for GROWTH and BUSINESS via entitlements; scoped keys; smallest public surface; signed webhooks with retries, history, SSRF-safe delivery. | §5.1a allowlist; `api_enabled`/`webhooks_enabled` data. |
| P11-D19 | Payment gateway deferred; gateway-neutral domain. | `BillingProvider` stays manual. |

### Still open (not blocking Steps 1–5)

| # | Question | Where it matters |
| --- | --- | --- |
| P11-Q20 | Subscription prices per plan (P11-D4) | Subscription page shows "Contact us"; no charge is computed |
| P11-Q21 | Permanent usage markup / customer price book values (P11-D11) | Production price book (placeholders flagged today) |
| P11-Q22 | GST and invoice rules (P11-D14) | Invoice issuance (not built) |
| P11-Q23 | Promotional credit consumption order (before or after paid funds) and any expiry policy (P11-D7) | Promotional funds are recorded and shown as granted; spend order and expiry are not applied |
| P11-Q24 | Downgrade grace duration and what happens when it ends (P11-D16) | Over-limit state is recorded and shown; no automatic change to live capabilities |
| P11-Q25 | Whether tenants see Meta/provider cost (P11-D10) | Tenant usage shows the customer charge; provider cost is visible to platform operators |

## 11. Original decision register (historical)


Nothing below is decided by this plan. Where the specs contain values today (the plan table and entitlement numbers in `BILLING.md`, the 14-day trial, the price-book paise values), they are **placeholders** and stay flagged until answered.

| # | Decision needed | Why it matters / what's in the specs today | Options (no recommendation on commercial values) | Blocks |
| --- | --- | --- | --- | --- |
| **P11-Q1** | Plan names and the set of plans | `BILLING.md` lists TRIAL/STARTER/GROWTH/BUSINESS as placeholders | Product owner provides the list and names; code needs none of them | Step 4 production data, Subscription UI copy |
| **P11-Q2** | Subscription prices | None set; `plans.price_minor` placeholder | Product owner provides per plan and currency | Step 4 |
| **P11-Q3** | Monthly and/or annual pricing | Schema supports both via `plan_prices` | Monthly only · monthly + annual (discount?) · annual only | Step 4 |
| **P11-Q4** | Limits per plan: users, contacts, phone numbers, campaigns/month, active flows, automation executions/month | Placeholder numbers in `BILLING.md` | Product owner provides values; `-1` = unlimited is supported | Step 4 enforcement values |
| **P11-Q5** | Trial strategy | Spec assumes every new tenant starts on a trial plan | Trial for all · trial on request · no trial (free plan instead) · trial only with a sales contact | New-tenant onboarding, lifecycle job |
| **P11-Q6** | Trial duration and end behavior | Spec says 14 days then read-only (placeholder) | Duration value; at end: read-only · downgrade to a free plan · grace period | Lifecycle job, `SUBSCRIPTION_INACTIVE` rules |
| **P11-Q7** | Promotional credits | `TRIAL_CREDIT_MINOR` exists (default 0) | None · one-time at signup (amount?) · campaign-based grants; expiring or not; spent before or after paid credit | Wallet UI, grants table, expiry job |
| **P11-Q8** | Currency scope | INR default; wallet has a currency column | INR only in v2 · multi-currency later | Price book, plan prices, formatting |
| **P11-Q9** | Relationship between plans and billing modes (FREE/TRIAL/PREPAID, P9-D1) | Two concepts exist; a paid plan could still be FREE mode for a partner | Plan implies mode · independent (operator sets both) | Subscription service, admin operations |
| **P11-Q10** | Meta/provider cost treatment | Price book stores `provider_cost_minor` and `customer_price_minor` (P9-D2) | Pass-through at cost · cost + markup · bundled per plan; whether tenants ever see provider cost | Usage API fields, invoices |
| **P11-Q11** | Fenwira message markup | `markup_bps` metadata exists; placeholder prices | Markup value(s) per category/country, or fixed customer prices | Production price book |
| **P11-Q12** | Low-balance threshold (value) | P11-D1 decides the mechanism; development default ₹100 | Production value; later, whether tenants may customize | Production config only |
| **P11-Q13** | Top-up model | Manual (B2); CLI today | Bank transfer/UPI recorded by an operator · minimum/fixed top-up amounts · prepaid packs; payment reference requirements | Top-up recording UI and copy |
| **P11-Q14** | GST and invoicing | B2 manual invoicing; tax metadata columns exist | No invoices in v2 (statements only) · tax invoices per top-up · monthly usage invoices; GSTIN capture; place-of-supply rules; numbering; who issues | 11C invoicing (may move to a later phase) |
| **P11-Q15** | Analytics retention | Placeholder days per plan in `BILLING.md` | Retention per plan (values) · one platform-wide value; raw events vs rollups kept differently | Retention job values |
| **P11-Q16** | Downgrade and over-limit behavior | Spec: never delete data; over-limit resources read-only; extra flows paused | Confirm or change: which resources become read-only, how inbound-created contacts above the limit are handled, grace periods, whether sends stop | Step 4 enforcement design |
| **P11-Q17** | Who operates billing (architecture) | No platform-operator identity exists | A. CLI only · **B. platform operator role (recommended)** · C. separate admin app | Step 5 |
| **P11-Q18** | API availability by plan, and the public route list | `api_enabled` placeholder per plan; API1 requires a public API in Phase 11 | Which plans get the API and webhooks; which routes are public in v2; per-key rate limits | Step 3 gating (the mechanism can be built with a placeholder) |
| **P11-Q19** | Payment gateway timing | B2: no provider in v2 | Confirm "not in Phase 11" · schedule a provider (which) for a later phase | Confirms `BillingProvider` stays manual |

When a question is answered it moves to `PRODUCT.md` → Decision register (and to an ADR where it changes architecture: P11-Q17, and P11-Q14 if invoicing is built), and this table records the answer.
