# Phase 11 test and validation results

Reconciled 2026-10-20. Baseline `675f7bc`; application changes `d638a41` through `d4541bd`; documentation `a16ac3c`; isolated acceptance harness `cb3ede3`; stable security listener `84950f9`. All results below are actual executions, with initial failures retained. No production execution is claimed.

## Environment and isolation

Host Darwin x86_64 / Node 25.2.1 / pnpm 10.34.5; supported engines permit >=24, but Linux production builds additionally used Node 22.23.3 / pnpm 10.34.5 in a disposable cached server-dev container. Approved frozen-lockfile downloads occurred only there; host dependencies and lockfile unchanged. Default Linux build used committed source through `cb3ede3`; the later listener edit affects tests only.

Dedicated cached-image PostgreSQL 16, Redis 7, Mailpit and MinIO containers `fenwira-p11-*`; loopback ports 53184, 53275, 53278/53279 and 53282. Databases `fenwira_acceptance` and `fenwira_e2e_test` were fresh; Redis1 integration / Redis2 browser. Earlier red/green fixture database was separate. All 23 migrations, post-migrate policies/privileges and seeds applied. Tests use non-superuser NOBYPASSRLS application transactions; privileged fixture setup is isolated. Existing unrelated `fenwira-local-*` services were not used or altered. Meta and HTTP webhook receivers were local simulators. Test env files under `/private/tmp` have restrictive permissions; credentials are omitted here.

Browser routing options used: `E2E_BASE_URL=http://127.0.0.1:4300`, `E2E_API_URL=http://127.0.0.1:4400/api/v1`, `E2E_MAILPIT_URL=http://127.0.0.1:53279`, `E2E_META_MOCK_URL=http://127.0.0.1:4420`, `E2E_REDIS_CONTAINER=fenwira-p11-redis`, `E2E_REDIS_DB=2`, `E2E_LOCAL_PROVISIONING=true`. Local operator provisioning rejects non-loopback or non-test database names; default Compose behavior is retained. Runtime logs were collected at info level.

## Commands and outcomes

Commands run from repository root; integration/browser commands source the appropriate test-only env file with export enabled. Logs named below are temporary diagnostics, not committed artifacts. This report preserves totals when those logs expire.

| Check | Command | Actual result |
|---|---|---|
| Uncached static/unit | `pnpm exec turbo run lint typecheck test --force --concurrency=2` | PASS 33/33 tasks; 325 tests / 46 files. |
| Module boundaries | `pnpm run lint:deps` | PASS; 814 modules / 2800 dependencies, no violation. |
| Design tokens | `pnpm run lint:design` | PASS. No product UI changes. |
| API production | `pnpm --filter @fenwira/api build` | PASS. |
| Worker production | `pnpm --filter @fenwira/worker build` | PASS. |
| OpenAPI | `node apps/api/scripts/openapi.mjs --check` | PASS, current generated contract. |
| Prisma | `pnpm --filter @fenwira/database exec prisma validate` | PASS. |
| Migration status | `pnpm --filter @fenwira/database exec prisma migrate status` | PASS, all 23 applied to fresh isolated acceptance DB; post-migrate/seeds/RLS also exercised. |
| Production audit | `pnpm audit --prod --audit-level high --json` | PASS, 464 dependencies; zero reported info/low/moderate/high/critical advisories. Explicit dependency metadata approval honored. Not an image scan. |
| Default host web | `pnpm --filter @fenwira/web build` | FAIL environmental: Turbopack process port binding EPERM, including authorized retry. Not marked passed. |
| Host production web alternative | `NEXT_PUBLIC_API_URL=http://127.0.0.1:4400/api/v1 pnpm --filter @fenwira/web exec next build --webpack` | PASS, compilation/TypeScript/route generation. Standalone static/public assembled for browser execution. |
| Default Linux production | In disposable container: `pnpm install --frozen-lockfile`, then `NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL=http://127.0.0.1:4400/api/v1 pnpm build` | PASS 8/8 tasks, zero cached; Next 16.3.8 default Turbopack, API, worker and packages. |
| Linux release assembly | Copy standalone static/public; create cache; `pnpm install --frozen-lockfile --prod --config.confirmModulesPurge=false`; `pnpm --filter @fenwira/database exec prisma generate`; `bash deploy/scripts/verify-build.sh /repo` | PASS including Linux Debian/OpenSSL3 Prisma engine and required runtime/deploy files, no secret env files. Assembly unversioned in disposable directory; exact Git export wrapper not run. |
| DB integration | `pnpm --filter @fenwira/database exec vitest run --config vitest.integration.config.mts --reporter=default --reporter=json --outputFile=/private/tmp/fenwira-p11-db-integration.json` | PASS 263 tests / 3 files. Forced RLS, runtime grants, immutable data, global/platform isolation and ID accessor restrictions. |
| API integration | Same Vitest arguments with `--filter @fenwira/api` and API output path | PASS 10 tests / 1 file. |
| Worker integration initial | Same arguments with `--filter @fenwira/worker` | All 28 files reported: 253 passed, 1 failed (security HTTP transport socket hang up), 2 optional performance tests skipped. Failure investigated, not ignored. |
| Security focused correction | Worker Vitest `test/security-matrix.int.test.ts` with integration config | PASS 13/13 after stable listener. Lint/types/format PASS; assertions unchanged, no retries. |
| Worker integration final | `pnpm --filter @fenwira/worker exec vitest run --config vitest.integration.config.mts --reporter=default --reporter=json --outputFile=/private/tmp/fenwira-p11-worker-final.json` | PASS 254 tests / 26 files; 2 optional performance tests/files skipped; all 28 files accounted for, zero failures (805.86 seconds) |
| Browser acceptance | `pnpm --filter @fenwira/web exec playwright test e2e/billing.spec.ts e2e/analytics.spec.ts e2e/subscription.spec.ts e2e/integrations.spec.ts e2e/platform-real.spec.ts e2e/platform.spec.ts e2e/billing-reconstruction.spec.ts e2e/analytics-reconstruction.spec.ts e2e/integrations-reconstruction.spec.ts --reporter=list,json` | PASS 19 tests / 9 specs; zero failed, skipped or flaky; 196.5 seconds. Chromium. |
| Live isolated smoke | `API_URL=http://127.0.0.1:4400 WEB_URL=http://127.0.0.1:4300 pnpm smoke` | PASS 3/3, including outbox round trip. Real API/worker, production standalone web, local mock provider. |

Final combined integration total: 527 passing tests / 30 passed files; 2 optional performance tests/files skipped (32 discovered files). Optional performance tests are not mandatory Phase 11 acceptance and are not counted as passes. The prescribed Docker Compose integration wrapper was not run; the same package suites ran natively against isolated PG/Redis/services. Current remote CI/full fresh Compose and live staging gates remain UNVERIFIED.

## Unit preservation

| Package | Passed tests | Files |
|---|---:|---:|
| config | 18 | 3 |
| contracts | 40 | 5 |
| ui | 55 | 6 |
| queue | 5 | 1 |
| database | 3 | 1 |
| whatsapp | 33 | 6 |
| web | 24 | 6 |
| api | 143 | 16 |
| worker | 4 | 2 |
| Total | 325 | 46 |

## Regression and acceptance boundaries

Wallet concurrency: eight actual PostgreSQL cases. Before correction 5/8 failed, including forced duplicate settle and negative reserved balance; after all pass. Existing wallet-state (9), campaigns billing and commercial lifecycle exercise acceptance/reservation/settlement/recovery, insufficient-funds pause/resume, audit/export and source reconciliation. Enforced test configurations are isolated only; production defaults remain false.

Webhook suite: 19 cases, including real ten-second receiver timeout, 400/503, deletion of delayed Redis jobs, repeated/concurrent recovery, transaction-crash claim release, terminal/disable behavior, signing/rotation and X19 restricted shape/grants. Redis job deletion satisfies loss simulation; no claim of an entire Redis service restart drill. External effects remain at-least-once.

Subscription fairness: 501-workspace real selector/lifecycle tests plus insertion/deletion between pages (2 cases), concurrent notices/expiry and repeated ticks. Original failing 501st trial now expires. Analytics recovery: five cases cover all-page pass/heal/retention, quiet ledger credit, duplicate and foreign events, posting timezone/late arrival; scale traversal spies expensive recomputation, while the separate 12-case analytics suite performs real source reconciliation, concurrent rollup, nightly drift repair, retention and timezone rebuild.

Security: API keys (10) scope/expiry/revoke/rate/tenant; platform (16) mandatory/replayed MFA, session/CSRF/revocation, all protected-route denial, independent financial correction/refund races, immutable audit rollback and previews; generated IDOR test covers 128 routes and 41 foreign IDs across 25 fixture tables, comparing 48/50 applicable table snapshots; generated RBAC/tenant/WebSocket matrix (13); CSRF/session tests (4); database matrices validate forced RLS and privilege boundaries. Coverage is bounded by those tests, not a penetration-test certification.

Browser tests use actual backend wallet funding/export, six analytics tabs/event appearance, key create/revoke, webhook one-time secret/test delivery, trial plan request, and operator identity without customer membership with real MFA/funding/revocation. Reconstruction fixtures cover permissions/loading/errors/confirmations, responsive widths 375/768/1024/1440 and axe accessibility; fixtures are not claimed as financial backend proof. Selected wallet 375 and analytics 1440 screenshots inspected; intended table scrolling remains. No UI redesign or manual design approval claimed.

Bounded runtime-log scan found no API/webhook secrets, passwords, customer email addresses or phone numbers in covered flows. Worker email-pattern matches were inspected SMTP Message-ID headers, not customer recipients. This is not an exhaustive historical secret scan.

## Failure history and limitations

The passing outbox test emitted Node MaxListenersExceededWarning for test HTTP Server error/close listeners. No limit was increased and no warning suppressed; it did not fail assertions. This is a test harness diagnostic, not established evidence of a production leak.

Initial wallet/subscription red tests intentionally reproduced defects. Header-case/void-SQL fixture issues and a typed analytics spy were corrected without weakening assertions. Host sandbox access can block loopback/Docker; approved local service runs were used. An unprivileged final worker rerun was interrupted before results, then restarted with authorized loopback access; only the completed final report counts. Frozen offline Linux install lacked a frontend tarball; online download initially rejected by automatic review, explicitly approved by user and then succeeded. No repository dependency/lockfile edits resulted. No unresolved permission request remains.

No remote CI, full clean Compose boot, staging/production inspection, production migration, external provider send, image scan, load benchmark or Phase 12 operation was performed. Temp logs: `/private/tmp/fenwira-p11-{full-static-unit,linux-build,linux-release-verification,worker-final,browser,smoke}.log`; JSON totals available alongside integration/browser logs during this session.

## Cleanup

After all checks completed, stopped the four task-owned native acceptance processes and removed only the five `fenwira-p11-*` test/build containers and their disposable volumes. Existing seven `fenwira-local-*` containers remained running and untouched. Temporary test env files removed; diagnostic logs/results retained under `/private/tmp`. No production state was accessed.
