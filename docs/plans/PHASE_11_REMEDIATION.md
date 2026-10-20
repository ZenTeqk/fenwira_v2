# Phase 11 remediation checklist

Authorized 2026-10-20. Baseline: `675f7bc`. Existing `main` branch; no push, deployment or production flags/migrations. Audit reports are evidence to revalidate, not assumed passes. Preserve approved Experience V2 and the existing module/queue architecture.

- [x] Stage 1 / F01 / 11.1-03–06, 11.1-14, 11.1-19, X-04: reproduce with PostgreSQL; serialize settlement and ledger idempotency before reads; test competing settle/release, retry, rollback and tenant isolation; commit verified fix.
- [x] Stage 2 / F02 / 11.3-15–18: recover durable due PENDING deliveries, bound concurrent claims, enqueue after commit, preserve signatures/deadline/suspension; test job loss/recovery and receiver failures; commit.
- [x] Stage 3 / F03 / 11.4-04–06, 11.4-14: keyset traversal beyond 500 subscriptions; test notices/transitions/restarts; commit.
- [x] Stage 4 / F04/F05 / 11.2-07–09, 11.2-15–16, 11.2-20: fair analytics traversal and ledger-driven promotional-credit invalidation; test quiet tenants, deduplication, date boundaries and source reconciliation; commit.
- [ ] Stage 5 / F06 / 11.3-20, X-05: reconcile outdated API/database/deployment prose; classify every remaining matrix item against executable evidence; no invented scope.
- [ ] Stage 6 / V1: run existing Phase11 API/tenant/MFA/financial-security integration coverage and fix confirmed in-scope failures.
- [ ] Stage 7 / V1/V2: lint, types, unit/integration/schema/OpenAPI/audit and all production builds; record actual failures and totals.
- [ ] Stage 8 / V2/V4: isolated mock-provider full lifecycle, browser/responsive/accessibility and startup/smoke where feasible; never use customer data.
- [ ] Stage 9: update six audit reports, requirement IDs/status/counts, commits, remaining gates and separate review/merge/staging/production/enforcement/closure decisions; commit documentation.

Use disposable test-only PostgreSQL/Redis/Mailpit/MinIO services from cached images. No new production infrastructure/dependencies/queues. Do not weaken tests or infer runtime success from source inspection. Stage 1 implementation is first; if an environment gate blocks execution, record it and continue independent authorized work without claiming the stage exit.

## Stage 1 evidence

Isolated PostgreSQL16 initialized with existing roles/migrations/post-migrate/RLS/seeds. Before fix: 5/8 new tests failed, including a forced duplicate settlement and −13 reserved after a release race (failed run also had teardown timeout). After moving both financial state/idempotency reads behind the wallet row lock: 8/8 PostgreSQL regressions pass. No schema or feature-flag change. Original audit in-memory reproduction is superseded by this actual PostgreSQL evidence. Stage commit contains only wallet core, regression tests and this billing/checklist documentation. Logs: `/private/tmp/fenwira-p11-wallet-{before,after}.log`.

## Stage 2 evidence

Durable due-row recovery on existing maintenance queue; deterministic attempt job IDs; transaction advisory claims; enqueue/alerts after commit; terminal/error timestamps cleared. Additive due index and restricted X19 accessor/security review in ADR-0026. PostgreSQL/Redis/local-receiver suite passed 18/18 before the additional X19 privilege/shape assertion; final count recorded in acceptance results. First run found two test-harness issues (header case and void SQL deserialization), corrected without weakening behavior assertions. Real ten-second receiver timeout, 400/503 retry, Redis job deletion, concurrent scans, crash rollback, signing, rotation, auto-disable and manual retry exercised. No external receivers. API build, worker typecheck and affected lint passed.

## Stage 3 evidence

Original 501-workspace regression failed: final workspace stayed TRIALING. Fixed X20 keyset overload and bounded traversal now pass 2/2 PostgreSQL tests: all 501 receive lifecycle service, concurrent/restarted ticks do not duplicate notices, expiry reaches all rows, and insertion/deletion between pages does not skip later IDs. Existing 2-argument function retained for binary compatibility; no billing flag change. API build, worker typecheck and affected lint pass. Logs: `/private/tmp/fenwira-p11-subscriptions-{before,after}.log`.

## Stage 4 evidence

X10 keyset traversal now covers every page for minute/heal/retention. A new IDs-only billing.transaction_posted event on the existing outbox/analytics queue invalidates the actual posting day, including quiet promotional grants and initial trial credit; duplicate postings/events remain no-ops. No new queue/database service/financial policy. First focused run: 34/34 across analytics reconciliation, wallet state, wallet concurrency and five new analytics recovery cases. New >500 fixture tests use real selector SQL and loop with spies only for expensive per-tenant rollup calls; separate existing suite verifies actual source-derived rollups. Quiet credit, timezone/late event, duplicate and foreign tenant cases use real PostgreSQL state. A test spy type error was corrected; final types and finalized fixture cleanup are rechecked separately.

## Stage 5 scope reconciliation

F06 corrected in API_SPEC/DATABASE/DEPLOYMENT: obsolete tenant wallet-credit/plan-change/direct usage routes removed, Analytics schemas and price-book fields aligned to current schema, and historical MinIO closure state distinguished from current audit. Security docs describe internal event/ID-accessor boundaries. Existing PRODUCT/ADRs and ROADMAP remain the decision/status sources; nonexistent DECISIONS.md/PHASE_STATUS.md aliases are not invented. Remaining matrix items are acceptance evidence, not automatically missing features. No payment, developer-platform expansion, connectors or Phase 12 implementation added. Current OpenAPI/schema checks pass; final per-ID reconciliation follows the complete integration/browser results.

## Isolated browser acceptance

The 19 focused Chromium tests pass on the production standalone artifact built with Next webpack, real API/worker and a fresh browser-only PostgreSQL database/Redis2/local Meta simulator. Includes actual wallet funding/export, analytics event appearance/all six tabs, API key create/revoke, webhook one-time secret/test delivery, trial plan request and real membership-free operator MFA/funding/revocation; fixture-based presentation tests cover responsive/accessibility/permission/error/confirmation states without claiming backend behavior. Smoke passes 3/3. E2E helper options isolate Redis and operator CLI provisioning; all original assertions remain. Type/lint checks pass; analytics regression change in this commit is formatting only. Default Turbopack remains host-blocked. A cached Linux build lacks frontend packages; external locked-package download awaits explicit approval after automatic review rejection.
