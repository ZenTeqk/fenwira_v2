# Phase 11 closure verification — 2026-10-05

> **Update 2026-10-19:** the remaining gate (fresh clean startup + CI) is cleared; see [§O](#o-closure-addendum-2026-10-19). Sections A–N below are the original 2026-10-05 record and are kept unchanged.

Status: local verification complete; Phase 11 BLOCKED by fresh startup/CI. No Phase 11 closure claimed. Starting branch `phase-11`, clean working tree, implementation baseline `54ac042` (nine Step 5 increments). The closure request accepts Step 5 and preserves Steps 1–4 decisions.

## A. Acceptance state

| Scope | State | Evidence |
| --- | --- | --- |
| Step 1 Wallet | CLOSED | Existing accepted wallet/reservation/reconciliation implementation; closure regression below |
| Step 2 Analytics | CLOSED | Existing accepted deterministic projection/retention/financial boundaries; closure regression below |
| Step 3 API/Webhooks | CLOSED | Existing accepted key catalog/authorization/signing/delivery implementation; closure regression below |
| Step 4 Subscription/Entitlements | ACCEPTED | Existing accepted domain plus reproduced, focused closure correctness fixes |
| Step 5 Platform Operations | ACCEPTED | Nine increments; accepted by closure request; STEP5_ACCEPTANCE.md and closure regression |
| Phase 11 | BLOCKED after local verification | Fresh CI/clean-run startup currently fails at the configured MinIO image pull |

## B. Repository and infrastructure assessment

- `phase-11`, baseline `54ac042`; no unrelated starting changes. Twenty dated migrations through `20261012000000_platform_security_binding`; closure adds no schema migration/backfill.
- Repository architecture remains Nest modular monolith, Next.js, PostgreSQL forced tenant RLS/non-bypass runtime, Redis/BullMQ and transactional outbox. Platform operations use separate global grants/session authorization and narrow system discovery, then `withTenant`.
- Reviewed Phase 11 plan/decisions, roadmap, architecture, billing, analytics, API specification, keys/webhooks, tenancy/security, deployment/observability, platform runbook and test/CI configuration. Reconciled stale billing claims (unimplemented provider checkout interface, paused-on-downgrade flows, optional threshold UI, already-implemented maintenance) and stable webhook delivery identity across retries.
- GitHub remote exists. Latest recorded CI run [37204245980](https://github.com/ZenTeqk/fenwira_v2/actions/runs/37204245980), older head `d62843c54430f7b6211068863d96dabdd31e4852`: verify and security jobs succeeded; integration and Docker startup failed with MinIO `unauthorized`. No current closure-commit CI result is claimed. Local cached MinIO permits testing but cannot prove fresh registry pulls. A current read-only manifest check for the configured tag also returned `no such manifest`; this is not just stale CI evidence.
- Production flags/defaults remain unchanged. No real Meta credentials/messages; local Compose uses the simulated Meta service and integration suites use loopback mock servers.

## C. Commercial lifecycle evidence map

New `apps/worker/test/commercial-lifecycle.int.test.ts` combines enforced subscription and wallet behavior using actual API/worker/domain services and an MFA-authenticated membership-free operator. Existing tests supply depth rather than duplicating every module.

| Scenario | Verification / authoritative suite |
| --- | --- |
| A Workspace creation | Concurrent entitlement reads produce one subscription, trial status/no paid plan, exact 14-day dates, Growth-configured limits, TRIAL mode. Workspace HTTP creation has no idempotency contract; repeated creation intentionally makes distinct workspaces, each with one subscription. |
| B Trial operation | Real contacts, synced templates, campaign, automation, analytics, API key and signed webhook receipt in combined lifecycle. |
| C Funding | Concurrent identical paid-credit requests produce one receipt/effect; promotional identity/expiry metadata retained. Platform suite proves atomic audit rollback and immutable receipts. |
| D Billable usage | Mock Meta sent/delivered pricing settles campaign/automation reservations once; 3 usage records/3 debits at configured placeholder test prices; ledger/analytics both 39 minor units. |
| E Campaign | Enforced trial/subscription and wallet in `campaigns-billing`: valid completion, insufficient-funds pause/resume, retained sent/pending recipients, no overspend, releases/recovery; `subscriptions` verifies inactive campaign pause. |
| F Automation | Combined lifecycle funds and completes billable automation; expiry fails billable action without losing inbound. Existing automation-billing suite enables both switches and checks failed/error-branch behavior with non-billable replies. |
| G API | Original scoped key works, denies after trial expiry/override, works after activation/override removal; remains stored. Existing API-key suite covers scope, nonrecoverable hashes, RLS, limits, expiry, revoke and audit. |
| H Webhooks | Signed real contact event; pending retry becomes SUSPENDED_BY_PLAN without failure count/auto-disable; endpoint retained, explicit retry restores the same delivery. Existing suites verify idempotent fan-out, rotation and delivery backoff. Suspended-period events are not replayed automatically. |
| I Analytics | Source/ledger/usage reconciliation; no provider-cost fields in tenant financial responses/CSV. Existing analytics tests verify projection dedupe/recompute/retention and billing visibility. Upgrade clears obsolete automatic grace; negotiated override and successive-downgrade regressions remain. |
| J Warnings | Eight concurrent steps each at T-3/T-1/expiry claim one notice each, 3 notifications and one expiry audit. Existing scheduler suite covers repeat ticks. |
| K Expiry | No deletion; API/template/automation restrictions, preserved keys/endpoints, owner billing access, inbound and read-status processing continue without additional debit. |
| L Plan request | Owner request records requested plan while EXPIRED; request alone never activates. Existing permission/audit coverage retained. |
| M Platform activation | Actual password/TOTP and platform session, 4 concurrent identical activations yield one receipt; no operator membership, original API key restored. |
| N PREPAID | Active plan/mode leaves empty wallet unfunded; send denied, manual funding admits send, one settlement exhausts funding and next send denied. |
| O Upgrade | Actual configured Business transition expands limits/365-day retention; existing data/flows retained. |
| P Downgrade | Actual Starter below 5,001 contacts/4 users/6 active flows: over-limit visible, user growth denied, counts/active flows retained, inbound creates contact 5,002. Business upgrade restores growth. |
| Q Override | Shared platform operation reasons/operator/expiry, atomic duplicate replay, effective capability denial, removal/restoration; existing typed/precedence tests. |
| R Correction | Combined negative correction reconciles; platform suite exercises active holds, same-key replay and independent concurrent corrections. |
| S Refund | Partial 5+8 and full 13 refunds on real usage debits, extra refund rejected; platform suite concurrent cap and immutable original-debit linkage. |
| T Cancellation | Shared operator cancellation plus lifecycle tick yields CANCELLED, billable/API denial, retained data and continuing inbound; existing campaign/webhook inactive cases complement it. |

## D. Financial reconciliation

Combined opening balance 0 + paid 1,000 + promotional 100 − settled customer charges 39 + usage refunds 26 − correction 100 = closing balance **987 INR minor units**. Ledger sum equals cached balance; active-reservation sum equals reserved cache (0 at final reconciliation); exactly three usage debits; receipt count equals commercial outbox count. No manual balance edits or history rewrites. Refunds do not rewrite usage analytics: gross customer charges remain authoritative; support refunds/adjustments are separate ledger effects.

Existing reservation/recovery and platform concurrency suites verify simultaneous reservations, duplicate status settlement/release, same-key funding, independent corrections/refunds, audit atomicity, currency checks and RLS/immutability.

## E. Subscription and entitlement authority

Existing EntitlementsService and subscription domain remain authoritative. Override → subscription/plan → defaults precedence unchanged. No plan-name authorization. Monthly, FREE/TRIAL/PREPAID, immediate downgrade, no deletion and no automatic flow disable preserved. Explicit negotiated retention overrides and greatest prior automatic downgrade window retain their Step 5 regressions. Closure fixes below correct concurrency and an obsolete automatic-grace cap; no commercial policy change.

## F. Security, audit and observability

- All five tenant roles explicitly denied platform authentication/detail access; OWNER is not an operator. API-key public catalog excludes platform/billing administration.
- Actual global operator has password/TOTP and short privilege; platform suite checks challenge purpose/concurrent replay, expiry/idle, backing-session/grant revocation, CSRF and MFA freshness.
- Narrow commercial allowlists exclude messages/conversations/contact content. Financial privilege separate from commercial read; tenant Wallet/Subscription/Analytics/API/export DTOs exclude internal provider cost and secrets.
- Tenant matrix covers wallet/reservations/analytics/keys/endpoints/deliveries/subscriptions/overrides/receipts; global grants/audit use explicit separate policies. No RLS bypass added.
- Immutable receipts + tenant/platform audit + outbox commit atomically; failure audit/redaction, deduplicated notifications after commit, bounded metrics and broad-access warnings retained. Review OBSERVABILITY.md for wallet drift/recovery, analytics errors, API auth/rate, webhook retry/failure, lifecycle and platform MFA/operation metrics.

## G. Test results

| Suite | Final result | Context |
| --- | --- | --- |
| Unit | **293 passed** | Complete uncached run, zero cached tasks, 43.8s; temporary idle-sleep guard |
| Database integration | **251 passed** | Forced-RLS/global-platform/append-only matrix |
| API integration | **10 passed** | Real PostgreSQL/Redis authentication flows |
| Worker integration | **215 passed, 2 opt-in skips** | Complete serial run in verified-empty `fenwira_p11_closure_serial` / Redis DB 5; command 12m4.7s |
| Targeted commercial suites within full worker run | **6 closure / 16 platform / 12 subscription passed** | Both enforcement flags ON only in isolated instances; prior retention regressions preserved |
| Existing performance probes | **2 passed, no skips** | Explicit PERF=1 in fresh `fenwira_p11_closure_perf` / Redis DB 6; 71.4s |
| Full browser | **72 passed, 1 existing optional visual skip** | Complete final run against patched runtimes, both Lighthouse flags enabled, 8.6m; CAPTURE_DIR is unset |

All lifecycle A–T scenarios in section C pass through the combined and existing suites. Enforcement OFF remains covered by the normal regressions; enforcement ON by isolated commercial/subscription/billing contexts. No failed full suite is replaced by an isolated rerun claim.

Performance: 300,000 analytics messages seeded in 29.5s; 90-day backfill 2,991ms; index-only day scan; two-day recompute 92ms; API queries 23–44ms with raw-count reconciliation. Automation: 200 events / 600 completed executions / 1,800 steps, 29.5s total (6.8 events/s, 20.3 executions/s, 61 steps/s). These local diagnostic timings are not a production SLA. Workspace discovery/audit reads remain bounded by their existing contracts and tests; no speculative optimization added.

## H. Quality gates

| Gate | Result |
| --- | --- |
| Formatting / lint / types | PASS, including module boundaries and design tokens; new banner test separately linted/typechecked |
| OpenAPI consistency | PASS after final uncached units |
| Production builds | PASS: API, worker, migrate and web; final runtime patch and mixed-case redaction included |
| Local Compose / smoke | All services healthy; all 3 checks PASS; actual production migration entrypoint succeeds without global npm |
| Dependency audit | PASS: production dependency audit reports no known vulnerabilities |
| Final image security | PASS: zero fixable HIGH/CRITICAL and detected secrets in all four images ([evidence](PHASE_11_IMAGE_SECURITY.json)) |
| Git-history secret scan | PASS: full Git history with redaction; final documentation commit also scanned |
| WCAG / Lighthouse | Final complete run: critical routes zero automated WCAG 2.2 AA violations across 375/768/1024/1440; controlled loading and banner states audited; all 15 authenticated Lighthouse routes score 100 ([sanitized results](PHASE_11_ACCESSIBILITY.json)) |
| Current closure-commit CI | NOT RUN; no current CI success claimed |
| Fresh/clean startup | BLOCKED: configured MinIO tag cannot be freshly pulled |

Representative tenant/platform screenshots have been visually reviewed. The banner fixtures cover T-3/T-1, EXPIRED and CANCELLED at 375/1024 with keyboard billing navigation and zero axe violations; these are controlled UI responses, while actual transitions are verified by integration. No rollout or production data is changed.

## I. Reproduced closure defects

| Defect | Reproduction / root cause | Fix and regression |
| --- | --- | --- |
| Concurrent trial notice duplication (`36b6ea2`) | 8 concurrent lifecycle transactions returned 8 T-3 claims; read-before-unconditional-array-push and recipient lookup lacked serialization. | Lock subscription row before lifecycle read; concurrent T-3/T-1/expiry test asserts one claimant each. |
| Automatic grace caps upgrade (`36b6ea2`) | Trial/Growth → Starter creates 90-day grace; Business activation still resolves 90 instead of configured 365. Old automatic override survived when the new plan no longer shrank retention. | Expire only obsolete system-generated grace when new configured window is equal/longer; actual downgrade/upgrade closure test asserts 365; explicit and successive-downgrade regressions preserved. |
| Production image vulnerabilities (`b6a3e65`) | Established Trivy scan found 11 fixable HIGH findings per image: Debian PCRE plus ten findings in bundled global npm dependencies; app dependency audit was clean. Disposable apt probe confirms patched PCRE candidate. | Runtime layers explicitly install the available PCRE patch and remove unused global npm; Node entrypoints and migration CLI remain unchanged. All four final production images pass Trivy fixable HIGH/CRITICAL and secret scans; builds, production migration startup and smoke pass ([image evidence](PHASE_11_IMAGE_SECURITY.json)). |
| Invitation credential in access logs (`80819da`) | Focused logger regression reproduced the live bearer token in invitation preview/accept paths. | Redact the credential path segment as well as query strings; all four logger tests pass. |
| Analytics loading ARIA (`fb9014c`) | The responsive full suite caught aria-prohibited-attr on the generic labelled loading div. | Give the shared loading container status semantics; controlled-response browser regression audits the loading state before releasing the API response. |
| Commercial table keyboard scrolling (`fb9014c`) | At 375px Wallet axe reports scrollable-region-focusable. DataTable did not pass the existing labelled focusable Table container option. | Shared DataTable supplies its label to the scroll region; visible focus ring, keyboard unit regression and real responsive axe test. |

Test execution note: the first uncached unit attempt was blocked by sandbox `listen EPERM` on a loopback receiver. The complete uncached suite was rerun with local-listener permission and passed 292 tests before the final redaction regression. A later concurrent-build run recorded an 84.95-second pause in a synchronous logger test and Vitest worker RPC timeout. The complete final uncached suite ran alone with a temporary idle-sleep guard and passed **293 tests in 43.8s** (zero cached tasks), with no timeout/assertion changes. OpenAPI consistency passed afterward; no test was skipped to work around the environment.

Fixture corrections: webhook retry assertion now follows documented 204 (no application change). The 5,001-contact setup is batched into bounded fixture transactions instead of exceeding Prisma's transaction timeout under load. The full suite also reproduced a duplicate synthetic phone in the 2,000-contact campaign: random eight-digit suffixes have a birthday collision risk. The shared test helper now uses a per-file sequence (fresh tenants per file); contact uniqueness and campaign assertions remain unchanged. No timeout increases or weakened behavioral assertions. The initial full integration run also missed the existing 240-second 50k-import deadline while overlapping a full browser run and uncached build; 31,000 rows were processed at timeout. Resource contention is a suspected cause, not a proven product result. The fresh serial full run passed the same 50k-import assertions in 87.8 seconds under the unchanged 240-second deadline, and the 2,000-recipient campaign completed in 112.1 seconds with all recipient/send assertions intact. The complete serial integration run passed, not merely isolated reruns.

## J. Known debt / blockers

Fresh MinIO pull/CI startup remains blocked by registry authorization. Resolving licensing/image distribution or approving a compatible storage change is outside this verification's frozen stack; no workaround/provider substitution is invented. Current local test evidence does not count as a clean-clone CI pass. Other non-blocking limitations: eventual analytics lag, historical price snapshots with missing/placeholder provider-cost classification, promotional remaining buckets unallocated pending consumption policy, optional visual-capture/performance tests as documented by their existing opt-in configuration. The many-application worker harness emits MaxListeners warnings; they are recorded rather than suppressed.

## K. Deferred commercial and production work

Unimplemented/unapproved: production subscription prices, customer price book, promotional consumption/expiry policy, GST/tax/invoices, gateways, POSTPAID, production subscription-enforcement rollout. SaaS Experience v2, Phase 12, AWS deployment, real Meta onboarding/MI1 are separate milestones. No work on these began.

## L. Feature flag

`BILLING_SUBSCRIPTIONS_ENFORCED=false`: config schema default, `.env.example`, Compose fallback and local API runtime. Development stack remains enforcement OFF; new lifecycle/campaign/automation/subscription tests enable it only for isolated app instances/databases. Production recommendation: keep false until a separate readiness/rollout approval. No real-user enforcement rollout.

## M. Documentation and repository result

Updated ROADMAP and Phase 11/Step 4/Step 5 plans, Step 5 acceptance/validation status, ARCHITECTURE, DATABASE, API_SPEC, MULTI_TENANCY, SECURITY, DEPLOYMENT, OBSERVABILITY, API_KEYS, WEBHOOKS, BILLING, ANALYTICS and design/UI_AUDIT. This report and sanitized accessibility/image-security JSON provide the closure evidence. AGENTS requires no change: no architectural exception was added.

Branch `phase-11`; baseline `54ac042`. Focused closure code commits: `36b6ea2` billing/lifecycle/regression, `80819da` credential redaction, `b6a3e65` runtime security, `fb9014c` accessibility/UI regression. The final documentation commit contains this report. No new migration; no financial history rewrite; no unrelated changes discarded. Local verification is complete; the repository does not claim fresh startup or current-commit CI success.

Reproduce the integration run using the existing Compose test image and the standard schema/role grants in a new empty database: override DATABASE_URL and MIGRATION_DATABASE_URL database suffixes, use a fresh Redis database, then run `db:deploy` and `pnpm turbo run test:integration --concurrency=1`. Run builds, browser and performance separately. Explicit probes use PERF=1 and the two existing performance files at their defaults. A temporary `caffeinate -i` guard prevents idle sleep during local commands; it is not application/CI configuration and changes no test deadline. Test databases and existing financial histories were preserved.

## N. Phase 11 verdict

**DO NOT CLOSE PHASE 11**

Local commercial lifecycle, financial reconciliation, security/isolation, regression, accessibility and image-security checks pass. Steps 1–3 remain CLOSED; Steps 4–5 remain ACCEPTED. Overall Phase 11 is BLOCKED because the configured MinIO image is unavailable to fresh pulls, preventing the required clean-clone startup and green CI acceptance. The recorded prior CI integration/Compose failures and current missing-manifest check are concrete evidence; cached local startup cannot replace that gate.

Remaining closure work is to resolve MinIO distribution/startup within the approved stack, then rerun fresh startup/smoke and CI on the final closure commits. Production enforcement remains false. No subsequent product/production milestone has begun.

## O. Closure addendum (2026-10-19)

Branch `phase-11-closure` from `main` at `e56c1ee` (CI and Deploy green on 2026-10-10, run 38069293866). No application code changed in this addendum.

### Root cause and fix of the §J blocker

`quay.io/minio/minio` stopped serving free community images (401/`no such manifest`). Commit `91d122f` moved `fenwira-minio` and `fenwira-minio-init` to Chainguard's build of the same AGPL MinIO server, pinned by digest (`cgr.dev/chainguard/minio@sha256:7df55d00…`, RELEASE.2026-09-22T19-25-18Z). On 2026-10-19 the digest and `postgres:16-alpine`, `redis:7-alpine`, `axllent/mailpit:v1.29` all resolved anonymously from their registries (`docker buildx imagetools inspect`).

### Fresh clean-clone startup

| Check | Result |
| --- | --- |
| Source | Fresh `git clone` of `origin/main` (`e56c1ee`), `cp .env.example .env`, `COMPOSE_PROFILES=meta-mock` |
| Isolation | Own Compose project and network with fresh, empty volumes (an override only unsets the fixed `container_name`s and network name); no existing local stack or volume reused |
| Images | `docker compose build --no-cache --pull`: api, worker, migrate, web, meta-mock built (exit 0, 1,057 s on a 4-CPU Docker VM) |
| Boot | `docker compose up -d --wait --wait-timeout 240`: exit 0 in 44 s. postgres, redis, minio, mailpit, meta-mock, api, worker, web **healthy**; minio-init and migrate **exited 0** |
| Init jobs | minio-init: `buckets ready`. migrate: all migrations applied, `post-migrate.sql applied`, `RBAC seeded: 5 roles, 35 permissions, 113 grants`, `Plans seeded: 3`, `RLS check passed` |
| `pnpm smoke` | **3/3 PASS**: api ready (postgres, redis, queue up); web healthy and sign-in page rendering; outbox round trip api → outbox → relay → queue → worker with correlation ID |
| Side services | Mailpit UI 200, MinIO console 200, meta-mock `/__mock/health` 200 |

The stack and its volumes were removed afterwards (`down -v` on the isolated project only).

### Quality gates on `phase-11-closure`

| Gate | Result |
| --- | --- |
| Lint (ESLint + module boundaries + design tokens) | PASS |
| Typecheck | PASS |
| Unit tests (uncached, `--force`) | **324 passed** (api 142, ui 55, contracts 40, whatsapp 33, web 24, config 18, queue 5, worker 4, database 3) |
| Production build | PASS (8/8 tasks) |
| OpenAPI document current | PASS |
| Prettier (changed files) | PASS |
| Integration, local | database **263 passed**, api **10 passed**. The worker suite could not complete on the local 4-CPU / 8 GB Docker VM shared with another running stack: the 50k-import and 2,000-recipient campaign tests exceeded their deadlines, later files timed out at the per-test limit and the container was killed (exit 137). This matches the contention note in §I; it is not counted as a pass or as a product regression. |
| Integration, CI | Authoritative: the `integration` job on this branch's pull request (same suite on a clean runner). On `main` at `e56c1ee` it passed: worker 21 files passed + 2 opt-in skips, 226 tests passed. |

### CI guard

`491b5da` had removed the Docker job. A new `compose-boot` job (`.github/workflows/ci.yml`) restores the clean-startup gate without the image scan and browser E2E: build with `--pull`, `up -d --wait`, `scripts/smoke.sh`, logs on failure, `down -v`.

### Documentation

ROADMAP: Phases 1 and 11 marked ✅; the CI/clean-startup backlog row resolved. ARCHITECTURE: frontend libraries corrected (React Hook Form and Zustand were never installed; forms are controlled components with API-side Zod validation, shared UI state is React context).

### Verdict

**PHASE 11 CLOSED**, on the condition that the pull request's `verify`, `release`, `integration`, `compose-boot` and `security` jobs pass. `BILLING_SUBSCRIPTIONS_ENFORCED` remains `false` in production; enabling it is a separate rollout decision. Section K's deferred commercial items are unchanged.

### Follow-up recorded for Phase 12

- In one local run the worker integration output stopped after 5 of 23 files with no Vitest summary while Turbo still reported success. It did not reproduce in a second run or in CI. Phase 12 should make the integration job assert the Vitest totals (for example a JSON or JUnit report checked for the expected file count) so a truncated run cannot pass silently.
- The 50k import and 2,000-recipient campaign returned `INTERNAL` 500s under heavy local contention rather than slowing down. Investigate during the Phase 12 k6 load and failure tests.

