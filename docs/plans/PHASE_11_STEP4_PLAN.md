# Phase 11 Step 4 — Plans, Entitlements and Subscriptions (plan, for review)

**Status:** proposed 2026-10-04; not approved; nothing implemented. Frozen inputs: P11-D2–D6, D9, D15, D16, D18, plus the Step 4 brief (plans STARTER/GROWTH/BUSINESS as data; launch defaults; monthly only; no prices; 14-day Growth-equivalent trial as a *state*; expiry never deletes; FREE/TRIAL/PREPAID modes independent of plan; downgrade never deletes; inbound never blocked; one entitlement authority; wallet separate; INR; no gateway; no GST rules).

## 1. What already exists (repository assessment)

| Piece | State | Reuse |
| --- | --- | --- |
| `EntitlementsService` (`apps/api/src/modules/entitlements`) | Single boundary with a pluggable `EntitlementSource` (`enabled(key)` / `limit(key)`); **never wired** — every tenant gets `ALLOW_ALL_ENTITLEMENTS` | **Keep as the one authority.** Step 4 replaces the source, not the service. |
| Keys defined | `automation_enabled`, `max_active_flows`, `automation_execution_limit`, `analytics_retention`, `api_enabled`, `webhooks_enabled` | Add `max_users`, `max_contacts`. |
| Consumers | Flow publish (`canPublishFlow`), automation execution (`canStartExecution`), analytics rollup/retention (`analyticsRetentionDays`), `ApiKeyGuard` (`apiEnabled`), `WebhooksService.create` (`webhooksEnabled`) | Work unchanged once the source is real. |
| `Tenant.billingMode` (FREE/TRIAL/PREPAID, default TRIAL) | Used only by wallet enforcement and trial credit (`wallet.core.ts`) | Stays independent of plan/subscription (P11-D9). |
| Wallet state machine (Step 1) | NORMAL/LOW_BALANCE/INSUFFICIENT_FUNDS/NOT_ENFORCED | Untouched; shown beside, never merged with, subscription state. |
| Error codes | `LIMIT_EXCEEDED`, `ENTITLEMENT_REQUIRED` exist | Add `SUBSCRIPTION_INACTIVE`. |
| Schema design | `plans`, `plan_entitlements`, `subscriptions`, `tenant_entitlement_overrides` are *documented* in `DATABASE.md` but **not built**; doc still lists `TRIAL` as a plan key | Build them; drop `TRIAL` as a plan (trial is subscription state). |
| Nav | `/billing/subscription` entry exists (permission `billing.read`); no page — falls to the catch-all 404 | Build the page. |
| Contact creation paths | `contacts.service` (manual + API key), `imports/import.processor`, `messaging/inbound.processor`, `messaging.service` (start conversation), automation webhook trigger + engine | Enforce only on user-initiated paths (§8). |
| Member creation paths | `tenancy/invitation.service` (invite, accept), `tenancy/workspace.service` (owner) | Enforce on invite and accept. |

## 2. Domain model

Five independent concepts, never one field:

```
Plan (global data)          STARTER | GROWTH | BUSINESS — name, sort, isPublic, entitlement rows
Subscription (per tenant)   planId?, status TRIALING | ACTIVE | EXPIRED | CANCELLED (PAST_DUE reserved),
                            interval MONTH (YEAR modelled, not exposed), trialEndsAt, currentPeriodStart/End
Entitlements (resolved)     capability flags + numeric limits, from plan/trial + overrides
Billing mode (tenant)       FREE | TRIAL | PREPAID — wallet enforcement only (unchanged)
Wallet state (tenant)       Step 1, unchanged
```

**Trial is a subscription status, not a plan.** `TRIALING` resolves entitlements from a configured *trial entitlement profile* (`billing.trial_entitlements_plan`, default GROWTH) without the tenant "having" Growth.

## 3. Schema (one migration + RLS + tenant-matrix fixtures)

- `plans` (global): `id, key text unique, name, is_public, sort, created_at`. Keys are data, not a Postgres enum, so adding a plan needs no migration.
- `plan_prices` (global, empty at launch): `plan_id, currency, interval (MONTH|YEAR), amount_minor, active` — exists so pricing can be configured later; **no rows seeded** (P11-D4).
- `plan_entitlements` (global): `plan_id, key, value jsonb`; pk `(plan_id, key)`.
- `subscriptions` (tenant, RLS): `id, tenant_id unique, plan_id null, status, interval, trial_ends_at null, current_period_start/end null, cancelled_at null, provider/provider_ref null, created_at, updated_at`.
- `tenant_entitlement_overrides` (tenant, RLS): `tenant_id, key, value jsonb, reason, created_by, expires_at null`; pk `(tenant_id, key)`.
- Seeds (configuration, idempotent upserts in `db:deploy`): the three plans and their launch-default entitlements.
- New `system.*` function (X20): `subscriptions_due(now, limit)` → `(tenant_id, subscription_id, kind)` for trial expiry and period roll — IDs only.

## 4. Entitlement resolution and precedence

`SubscriptionEntitlementSource implements EntitlementSource`, registered as `ENTITLEMENT_SOURCE` app-wide (API and worker):

1. **Override** for `(tenant, key)` if present and unexpired — wins.
2. Else by subscription status:
   - `TRIALING` → trial profile plan's entitlements;
   - `ACTIVE` → subscribed plan's entitlements;
   - `EXPIRED` / `CANCELLED` / none → **expired profile**: capability flags off (`api_enabled`, `webhooks_enabled`, `automation_enabled` for *new* activation), numeric limits = last plan's (so nothing becomes "over limit" merely by expiring), `analytics_retention` = last plan's (data kept, never purged faster because of expiry).
3. Unknown/unset key → unlimited / enabled (current behaviour; no surprises for keys added later).

Resolution is per-request, cached for the transaction only (no cross-request cache, so changes apply on the next request). `billingMode = FREE` does **not** bypass entitlements (open decision F4).

## 5. Capability enforcement (existing call sites; only the source changes)

API keys → `ApiKeyGuard` already returns 403 `ENTITLEMENT_REQUIRED`. Webhook create → already 403. **New:** webhook *fan-out* skips tenants without `webhooks_enabled` (no delivery rows created; endpoints untouched). Automation publish/execute → existing checks. Billable outbound → new `SUBSCRIPTION_INACTIVE` check inside `MessagingService` eligibility (one place) for customer-initiated billable sends when status is EXPIRED/CANCELLED.

## 6. Quantitative limits — where and how (transactional)

`EntitlementsService.assertWithin(tx, tenantId, key, increment)` — one method, called inside the same `withTenant` transaction that inserts:

| Limit | Enforced at | Not enforced at |
| --- | --- | --- |
| `max_users` | invite create, invite accept (active members + pending invites) | owner bootstrap |
| `max_contacts` | manual create, API-key create, import confirm (projected total), user-started conversation to a new number | **inbound** messages, Meta status events, automation-created-from-inbound |
| `max_active_flows` | publish / resume (existing) | already-active flows |

**Race safety:** `pg_advisory_xact_lock(hashtext(tenant_id || ':' || key))` taken before count+insert, so two concurrent creates can't both pass at `limit-1`. Lock is per tenant per key, transaction-scoped; inbound paths never take it.

## 7. Over-limit state

Computed, not stored as a mode: `GET /billing/entitlements` returns per key `{limit, usage, overLimit}`. Over limit blocks only growth of *that* resource with 422 `LIMIT_EXCEEDED {key, limit, current}`; reads, edits, deletes, inbound, existing active flows all continue. A daily job records `over_limit_since` per key in `subscriptions` metadata (for the grace mechanism and notifications), never changes data.

## 8. Lifecycle

- **New workspace:** subscription `TRIALING`, `trial_ends_at = now + billing.trial_days (14)`, `plan_id = null`. `billingMode` unchanged (still TRIAL by default; independent).
- **Trial expiry (job):** → `EXPIRED`; notification + email to OWNER/ADMIN at T-3 days, T-1 day and on expiry; audit `subscription.expired`. In-flight campaigns pause with new reason `PAUSED_SUBSCRIPTION_INACTIVE` (resumable after activation, same pattern as `PAUSED_INSUFFICIENT_FUNDS`); active flows stay ACTIVE but their *billable* sends fail through the same eligibility check (free in-window replies continue); inbound, status, and OWNER access continue.
- **Plan selection/activation:** see decision F1 (no gateway, no prices). Mechanically: `ACTIVE`, `plan_id` set, `current_period_*` = monthly; audit `subscription.activated`.
- **Upgrade:** effective immediately; limits rise, capabilities turn on; nothing to migrate. Analytics retention increases forward only (already-purged history doesn't return).
- **Downgrade:** effective immediately (or at period end — F3); no data touched; over-limit as §7; analytics retention shrinks at the next nightly retention run (data older than the new window is purged by the existing job — **this is the one place a plan change removes data**; flagged F5).
- **Cancel:** `CANCELLED` at period end → behaves as EXPIRED.

## 9. API / webhook data after entitlement loss

Nothing deleted. API keys remain listed, still revocable, authenticate to 403 `ENTITLEMENT_REQUIRED`. Webhook endpoints remain, UI shows a derived "Suspended — not in current plan" state (not the auto-disable `DISABLED` state, so regaining the entitlement resumes delivery without user action); events during suspension are not queued for later delivery.

## 10. Jobs

`billing.maintenance` (existing queue) gains: `subscriptions.tick` (every 15 min, X20: trial-ending notices, expiry, period roll) and `entitlements.usage_snapshot` (daily, over-limit tracking). Both idempotent (conditional updates on status; notification dedupe keys).

## 11. Audit events

`subscription.trial_started`, `subscription.activated`, `subscription.plan_changed {from,to}`, `subscription.expired`, `subscription.cancelled`, `entitlement_override.set/removed`. Limit refusals are not audited (they're 422s), but counted in metrics.

## 12. Notifications

Trial ending (T-3, T-1), trial expired, over limit (once per key per crossing), API/webhooks suspended by plan. To members with `billing.read` (bell + email), deduped like wallet crossings.

## 13. REST API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/billing/plans` | `billing.read` — public plans + entitlement summaries; `price: null` until prices exist |
| GET | `/billing/subscription` | `billing.read` — status, plan, trial end, period |
| GET | `/billing/entitlements` | `workspace.read` — resolved limits/usage/overLimit (every role needs limits to explain a 422) |
| POST | `/billing/subscription/change` | `billing.manage` — behaviour per F1 |
| POST | `/billing/subscription/cancel` | `billing.manage` |
| — | `/workspace/status` | adds `subscription {status, trialEndsAt}` for the shell banner |

Operator-side override endpoints wait for Step 5 (Platform Operator); until then overrides via a worker CLI like `wallet:credit`.

## 14. Frontend

`/billing/subscription` (SettingsPage pattern, Design System v1, no new tokens): one plan summary (name or "Trial", days left, renewal), a **Limits** list (usage vs limit with a single progress indicator per key and an over-limit StatusBadge), capabilities list (API, webhooks, automations), and the plan comparison only when choosing (cards, "Contact us" in place of price). Wallet stays on `/billing/wallet`, cross-linked with one line explaining the difference. Shell: persistent trial/expired banner for members with `billing.read`. 422 `LIMIT_EXCEEDED` everywhere shows "Your plan allows N … — see Subscription". API/Webhooks pages show the suspended state from §9.

## 15. Permissions, isolation, idempotency, observability

- OWNER/ADMIN via existing `billing.read`/`billing.manage` (ADMIN lacks `billing.manage` today — OWNER-only change, matches current matrix).
- RLS + tenant-matrix fixtures for `subscriptions`, `tenant_entitlement_overrides`; global tables read-only to `fenwira_app`.
- `subscription/change` takes `Idempotency-Key`; state transitions are conditional updates.
- Metrics: `entitlement_denials_total{key}`, `subscription_transitions_total{to}`, `tenants_over_limit{key}` gauge.

## 16. Migration / backfill (no developer lockout)

Existing tenants get `subscriptions` rows: `TRIALING`, `trial_ends_at = deploy + 14 days`. New env `BILLING_SUBSCRIPTIONS_ENFORCED` (default **false** in `.env.example`/dev, true in production): when false, the source resolves every tenant as BUSINESS-equivalent so local work and existing e2e tests never hit limits; the test suite sets it true where it tests Step 4. Mirrors the existing `BILLING_ENFORCED` pattern.

## 17. Implementation order (small, independently green increments)

1. **Schema + seeds + RLS tests** (plans, plan_entitlements, plan_prices, subscriptions, overrides; X20; backfill). No behaviour change.
2. **SubscriptionEntitlementSource** behind `BILLING_SUBSCRIPTIONS_ENFORCED`; unit tests for precedence; existing consumers now read real data.
3. **Quantitative limits** (`assertWithin` + advisory lock) on users/contacts; concurrency tests; inbound exemption tests.
4. **Lifecycle jobs** (trial start/expiry, notifications, campaign pause reason, `SUBSCRIPTION_INACTIVE` in eligibility).
5. **Webhook fan-out suspension + API/Webhooks UI suspended state.**
6. **REST endpoints** (`plans`, `subscription`, `entitlements`, change/cancel per F1) + OpenAPI.
7. **Subscription UI + shell banner + 422 messaging.**
8. **Docs + full regression + e2e/a11y/Lighthouse.**

## 18. Test strategy and E2E scenarios

Integration: precedence (override > status > plan); trial → expiry with an active campaign (pauses, resumes after activation) and an active flow (in-window reply still sent, template blocked); downgrade BUSINESS→STARTER with 60 active flows (all stay active, publish refused, unpausing one refused); contact limit: manual/API/import refused at limit, 20 concurrent creates at limit-1 → exactly one succeeds, inbound at limit still creates contact and message; API key → 403 after expiry, works again after activation, never deleted; webhook fan-out stops/resumes; analytics retention follows plan; tenant isolation for new tables/routes; idempotent subscription change. E2E: trial banner and Subscription page; over-limit message on contact create; expired workspace — OWNER can still sign in and reach Subscription. a11y (axe WCAG 2.2 AA) + Lighthouse on `/billing/subscription`; responsive at 1440/1024/375.

## 19. Performance

Resolution is ≤ 2 indexed reads per transaction (subscription + overrides; plan entitlements cached in-process, they're global config). Count queries use existing tenant indexes (`contacts(tenant_id, deleted_at)`, `memberships(tenant_id, status)`); advisory lock held only for count+insert.

## 20. Documentation

`BILLING.md` (subscriptions, precedence, trial, expiry, downgrade), `DATABASE.md` (tables; drop TRIAL plan key), `MULTI_TENANCY.md` (X20), `API_SPEC.md`, `ARCHITECTURE.md` (jobs, events), `OBSERVABILITY.md`, `DEPLOYMENT.md` (new env vars), `API_KEYS.md`/`WEBHOOKS.md` (suspended-by-plan behaviour), `ROADMAP.md`, `PHASE_11_PLAN.md`.

## 21. Risks

Developer/e2e lockout (mitigated by the enforcement flag); analytics data loss on downgrade (F5); confusing `billingMode=TRIAL` vs subscription `TRIALING` naming (documented, surfaced separately in UI); activation without gateway depends on F1; campaigns paused at expiry might surprise customers (notices at T-3/T-1).

## 22. Decisions requiring product approval

See the completion message (F1–F6); everything else above follows frozen decisions.
