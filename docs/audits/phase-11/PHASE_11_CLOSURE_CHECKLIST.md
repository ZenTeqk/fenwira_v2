# Phase 11 closure checklist

Reconciled 2026-10-20. **NOT READY TO CLOSE** pending remote exact-SHA CI and staging runtime evidence, plus formal Phase 12 deferral acceptance. No unresolved confirmed P0/P1 code defect remains locally. Full matrix: 111 PASS, 3 PARTIAL, 0 FAIL, 1 UNVERIFIED /115; workstreams98/100 verified. Six scope exclusions do not count. Two partial V3 rows are Phase 12 measurements subject to owner acceptance; the third partial row is mandatory X-10. No acceptance waiver assumed.

## Requirement checks

### 11.1

- [x] **11.1-01 PASS** — One wallet initializes per workspace with one-time trial credit.
- [x] **11.1-02 PASS** — Immutable ledger and trigger maintain balance; no direct balance writes in reviewed core.
- [x] **11.1-03 PASS** — Authorized credits/debits preserve ledger totals in PostgreSQL.
- [x] **11.1-04 PASS** — Concurrent acceptance reserves no more than available funds.
- [x] **11.1-05 PASS** — Duplicate/concurrent settlement closes each reservation exactly once.
- [x] **11.1-06 PASS** — Settlement and release racing keep reserved cache equal to ACTIVE sum.
- [x] **11.1-07 PASS** — Threshold is configuration with approved 10000 minor-unit default.
- [x] **11.1-08 PASS** — Four wallet states obey approved available-funds rules.
- [x] **11.1-09 PASS** — Crossing events are written transactionally and notifications deduplicate.
- [x] **11.1-10 PASS** — Messaging sources share eligibility and billing acceptance boundary.
- [x] **11.1-11 PASS** — BILLING_ENFORCED off/FREE maps to NOT_ENFORCED.
- [x] **11.1-12 PASS** — Enforcement on blocks insufficient funds without blocking inbound/nonbillable.
- [x] **11.1-13 PASS** — Campaign pauses for funds and resumes without resending recipients.
- [x] **11.1-14 PASS** — Retries and duplicate Meta events preserve one debit and correct holds.
- [x] **11.1-15 PASS** — Ledger listing filters, pages and exports actual records.
- [x] **11.1-16 PASS** — CSV cells prevent formula injection; money formatting handles minor units.
- [x] **11.1-17 PASS** — Wallet UI renders backend state, balances and configured contact.
- [x] **11.1-18 PASS** — Wallet financial reads and mutations respect tenant isolation/audit.
- [x] **11.1-19 PASS** — Recovery settles recorded pricing or releases stale holds safely.
- [x] **11.1-20 PASS** — Daily ledger/hold drift check alerts without silent correction.

### 11.2

- [x] **11.2-01 PASS** — Overview API and frontend query wiring exist.
- [x] **11.2-02 PASS** — Messaging API and frontend query wiring exist.
- [x] **11.2-03 PASS** — Campaigns API and frontend query wiring exist.
- [x] **11.2-04 PASS** — Inbox API and frontend query wiring exist.
- [x] **11.2-05 PASS** — Automations API and frontend query wiring exist.
- [x] **11.2-06 PASS** — Usage API and frontend query wiring exist.
- [x] **11.2-07 PASS** — Events deduplicate by source ID and mark durable dirty work.
- [x] **11.2-08 PASS** — Scheduled rollups replace source-derived totals under tenant lock.
- [x] **11.2-09 PASS** — Filters, message delivery/read/failure denominators reconcile to source.
- [x] **11.2-10 PASS** — Workspace isolation holds for events, rollups and APIs.
- [x] **11.2-11 PASS** — Calendar day arithmetic respects workspace IANA zone and DST examples.
- [x] **11.2-12 PASS** — SQL date boundaries and timezone rebuilds reconcile in PostgreSQL.
- [x] **11.2-13 PASS** — Campaign recipient metrics, automation outcomes and inbox episodes reconcile.
- [x] **11.2-14 PASS** — Usage charges reconcile to ledger and obey billing.read visibility.
- [x] **11.2-15 PASS** — Promotional credit changes invalidate the displayed Usage rollup promptly.
- [x] **11.2-16 PASS** — Retention, history rebuilds and nightly reconciliation recover correctly.
- [x] **11.2-17 PASS** — UI has loading/empty/error/freshness components and no sample metrics in reviewed paths.
- [x] **11.2-18 PASS** — All six screens pass current browser/responsive/accessibility checks.
- [ ] **11.2-19 PARTIAL** — Source-day indexes and bounded queries exist; measured performance remains unverified.
- [x] **11.2-20 PASS** — All eligible workspaces eventually receive scheduler service.

### 11.3

- [x] **11.3-01 PASS** — API key generator uses random 256-bit secret and unique public prefix.
- [x] **11.3-02 PASS** — Storage contains peppered hash; one-time response omits secret from list.
- [x] **11.3-03 PASS** — Key renewal uses create/revoke, with immediate revocation and optional expiry.
- [x] **11.3-04 PASS** — Granted scopes are bounded by catalog and creator permissions.
- [x] **11.3-05 PASS** — Bearer identity cannot change workspace via header or foreign resource ID.
- [x] **11.3-06 PASS** — Bearer authentication enforces scope and api_enabled.
- [x] **11.3-07 PASS** — Curated public routes exclude platform, billing and private administration.
- [x] **11.3-08 PASS** — Per-key rate limits return typed 429 with Retry-After.
- [x] **11.3-09 PASS** — API sends reuse eligibility, consent, subscription and wallet gates.
- [x] **11.3-10 PASS** — Endpoint subscriptions validate catalog and permissions and audit mutations.
- [x] **11.3-11 PASS** — External envelope has pinned version, event identity and stable payload.
- [x] **11.3-12 PASS** — HMAC signatures bind timestamp/body and receivers reject tampering/replay.
- [x] **11.3-13 PASS** — Webhook secrets encrypt at rest; rotation shows secret once with no grace.
- [x] **11.3-14 PASS** — SSRF-safe transport blocks private addresses and validates redirects.
- [x] **11.3-15 PASS** — Delivery retries recover after commit/queue gap or Redis loss.
- [x] **11.3-16 PASS** — Retry window, terminal failure and auto-disable counters operate correctly.
- [x] **11.3-17 PASS** — Duplicate domain delivery creates one durable row; receivers deduplicate eventId.
- [x] **11.3-18 PASS** — Delivery history and management UI show real states and permit recovery.
- [x] **11.3-19 PASS** — API key/webhook audits and delivery data remain tenant-isolated.
- [x] **11.3-20 PASS** — Generated OpenAPI/public contracts and prose route inventory match current implementation.

### 11.4

- [x] **11.4-01 PASS** — Workspace trial initializes/backfills once with configured 14-day duration.
- [x] **11.4-02 PASS** — Configured plan data drives features without plan-name authorization.
- [x] **11.4-03 PASS** — Live expired-trial resolution denies outbound capability before scheduler runs.
- [x] **11.4-04 PASS** — T-3 warning, T-1 warning and expiry notice exist (approved lifecycle).
- [x] **11.4-05 PASS** — Concurrent lifecycle runs produce one notice and status transition.
- [x] **11.4-06 PASS** — All due subscriptions are serviced without first-page starvation.
- [x] **11.4-07 PASS** — max_users invite/accept limit is transactional.
- [x] **11.4-08 PASS** — Contact create/import limits admit only one concurrent growth at limit-1.
- [x] **11.4-09 PASS** — Inbound contacts/messages continue at limit or after expiry.
- [x] **11.4-10 PASS** — Configured flow/phone/campaign/execution limits use shared entitlement service.
- [x] **11.4-11 PASS** — Expired/cancelled suspends API and webhooks while preserving records.
- [x] **11.4-12 PASS** — Template sends and running campaigns enforce subscription server-side.
- [x] **11.4-13 PASS** — BILLING_SUBSCRIPTIONS_ENFORCED off preserves allow-all behavior.
- [x] **11.4-14 PASS** — Status transitions include expiry, monthly period roll and period-end cancellation.
- [x] **11.4-15 PASS** — Operator activation restores existing keys/endpoints and permitted sends.
- [x] **11.4-16 PASS** — Immediate downgrade preserves resources; retention grace/overrides survive upgrade.
- [x] **11.4-17 PASS** — Unexpired explicit override has precedence and missing keys are unlimited.
- [x] **11.4-18 PASS** — Request/cancel endpoints use contract validation and billing.manage.
- [x] **11.4-19 PASS** — Subscription page/banner shows real plan/trial/limit states accessibly.
- [x] **11.4-20 PASS** — Subscription changes and notices are attributable and tenant-isolated.

### 11.5

- [x] **11.5-01 PASS** — Separate operator grant exists; tenant role and API scopes cannot grant authority.
- [x] **11.5-02 PASS** — Grant provisioning uses restricted migration-role CLI; app cannot self-grant.
- [x] **11.5-03 PASS** — Password plus enrolled fresh TOTP establishes privilege; replay denied.
- [x] **11.5-04 PASS** — 30-minute absolute, 10-minute idle and 5-minute write-MFA limits hold.
- [x] **11.5-05 PASS** — Backing-family, grant/password/MFA revocation invalidates privilege.
- [x] **11.5-06 PASS** — Every protected /platform endpoint rejects ordinary workspace roles.
- [x] **11.5-07 PASS** — Platform endpoints require independent session/CSRF and platform permission.
- [x] **11.5-08 PASS** — Bounded workspace discovery/detail excludes conversations and unrelated PII.
- [x] **11.5-09 PASS** — Wallet paid/promotional funding respects currency, metadata and available holds.
- [x] **11.5-10 PASS** — Corrections cannot overspend; cumulative refunds cannot exceed original debit.
- [x] **11.5-11 PASS** — Activation, cancellation, modes and typed overrides share subscription domain.
- [x] **11.5-12 PASS** — Receipt identity/fingerprint precision independent of property ordering.
- [x] **11.5-13 PASS** — Mutation, immutable receipt, tenant/platform audit and outbox commit atomically.
- [x] **11.5-14 PASS** — Identical idempotency retries replay; changed payload and stale version reject.
- [x] **11.5-15 PASS** — Preview rolls back state and confirmation reviews workspace/reason/reference.
- [x] **11.5-16 PASS** — Cross-workspace selection conflict and foreign target IDs fail safely.
- [x] **11.5-17 PASS** — Nested credential/customer-content redaction rejects unsafe metadata.
- [x] **11.5-18 PASS** — Separate UI exposes real commercial operations, errors and receipts.
- [ ] **11.5-19 PARTIAL** — Operational metrics/access warnings exist; actual delivery/routing not demonstrated.
- [x] **11.5-20 PASS** — Operator recovery runbook and authenticated CLI adapters exist.

### X

- [x] **X-01 PASS** — Tenant tables have forced RLS and matrix fixtures; isolated runtime-role privileges proven.
- [x] **X-02 PASS** — Schema validates without connecting; migration history covers Phase 11 entities.
- [x] **X-03 PASS** — Fresh/additive migrations, post-migrate policies and seeds work on PG16.
- [x] **X-04 PASS** — Financial bigint and idempotency/FK indexes exist; cash/reservation invariants hold.
- [x] **X-05 PASS** — Architecture/API/database prose matches current implementation.
- [x] **X-06 PASS** — Cookies/CORS/CSRF/security failure behavior and tenant IDOR matrices pass live.
- [x] **X-07 PASS** — Secrets encrypted and redacted primitives pass current unit suite.
- [x] **X-08 PASS** — Covered isolated workflow logs contain no customer PII or credentials.
- [x] **X-09 PASS** — CI defines verify/release/integration/fresh-compose/security jobs.
- [ ] **X-10 PARTIAL** — Audited commit CI job results and fresh clean-clone smoke gate observed.
- [x] **X-11 PASS** — API/worker configuration includes Phase 11 flags, jobs and required secrets.
- [ ] **X-12 UNVERIFIED** — Actual staging/production worker, SMTP, scheduler and flags verified.
- [x] **X-13 PASS** — Lint, typecheck, all unit tests, backend and worker builds pass.
- [x] **X-14 PASS** — Production frontend and Linux release packaging build successfully.
- [x] **X-15 PASS** — Production dependency advisory scan reports no current findings.

## Mandatory closure gates

- [x] F01 real PostgreSQL duplicate settle/release/retry/rollback/tenant regressions pass.
- [x] F02 durable due delivery recovery after Redis job loss and interrupted transaction verified; at-least-once semantics documented.
- [x] F03 all 501 eligible subscriptions serviced; duplicate notices and concurrent ticks safe.
- [x] F04/F05 analytics quiet-ledger invalidation and complete tenant traversal verified; actual source rollups reconcile.
- [x] F06 API/database/security/deployment prose reconciled; schema/OpenAPI current.
- [x] Existing 325 unit tests preserved; local integration/security/browser coverage executed; default Node 22/Linux build and release assembly pass.
- [x] X-10 clean-clone full Compose build/startup/smoke at exact 5e08d58 SHA: eight healthy services, successful migrations/init, smoke 3/3.
- [ ] X-10 remote CI against exact intended SHA: unpublished commit, no Actions runs; main has advanced and direct push can trigger production deploy.
- [ ] X-12 staging worker/outbox/scheduler/SMTP/matched-flag/secret-permission/monitoring evidence. Read-only AWS metadata identified production only; no staging runtime inspected.
- [ ] Named owner approval/reference formally accepting 11.2-19 and 11.5-19 Phase 12 deferrals.
- [ ] Independent review/acceptance of the above evidence before formal closure.

Production deployment, production data assessment/repair, commercial pricing and enforcement activation require separate explicit operational decisions. Both enforcement flags retain default false. No push, PR, merge, deployment or Phase 12 implementation occurred. Final decisions and smallest next actions: [audit report](PHASE_11_AUDIT_REPORT.md).
