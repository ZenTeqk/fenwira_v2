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

Final combined integration total: 527 passing tests / 30 passed files; 2 optional performance tests/files skipped (32 discovered files). Optional performance tests are not mandatory Phase 11 acceptance and are not counted as passes. The prescribed Docker Compose integration wrapper was not run; the same package suites ran natively against isolated PG/Redis/services. At the remediation audit, remote CI/full fresh Compose and live staging gates were unverified. The final release verification below supersedes the local Compose limitation; remote CI and staging remain open.

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

During the earlier remediation run, no remote CI, full clean Compose boot, staging/production inspection, production migration, external provider send, image scan, load benchmark or Phase 12 operation was performed. The new release verification below records the subsequent clean Compose run and read-only remote metadata discovery. Temp logs: `/private/tmp/fenwira-p11-{full-static-unit,linux-build,linux-release-verification,worker-final,browser,smoke}.log`; JSON totals available alongside integration/browser logs during this session.

## Cleanup

After all checks completed, stopped the four task-owned native acceptance processes and removed only the five `fenwira-p11-*` test/build containers and their disposable volumes. Existing seven `fenwira-local-*` containers remained running and untouched. Temporary test env files removed; diagnostic logs/results retained under `/private/tmp`. No production state was accessed.

## Final release verification

Verified source: **`5e08d58a6e6ab54e387f876e93123920e38a6f3b`**, local branch `main`, clean tree at start, 2026-10-20 Asia/Kolkata. This section adds release evidence; earlier 325 unit / 527 integration / 19 Chromium results were not rerun in this verification-only task. Application, CI, deployment and infrastructure source files were unchanged. The only working-tree changes are the six audit reports.

### Remote CI: BLOCKED

Read-only GitHub API access succeeded. `gh api repos/ZenTeqk/fenwira_v2/git/ref/heads/main --jq '.object.sha'` returned **`99060fa048a57f13957aff26d4ab98c79f22ec39`**. Its subject is “Merge PR #26: literal LIKE matching in search/filters; NUL → 400”. The comparison to remediation baseline `675f7bc` showed that baseline is two commits behind current remote main. Local main has eight unpublished remediation/report commits relative to the recorded baseline.

`gh api repos/ZenTeqk/fenwira_v2/commits/5e08d58a6e6ab54e387f876e93123920e38a6f3b --jq '.sha'` returned **HTTP422, No commit found for SHA**. `gh run list --repo ZenTeqk/fenwira_v2 --commit 5e08d58a6e6ab54e387f876e93123920e38a6f3b --limit 20 --json databaseId,headSha,name,status,conclusion,url,createdAt` returned **`[]`**. No remote CI execution/result is claimed. Evidence saved under `/private/tmp/fenwira-p11-release-{remote-main.txt,remote-commit.log,ci.json}`.

CI defines verify (lint/types/units/build/OpenAPI/format), release (Linux packaging/templates), integration, compose-boot and security (gitleaks/advisories). It triggers on main pushes and pull requests targeting main; it has no workflow_dispatch entry point. The production Deploy workflow independently triggers on application/deployment changes pushed to main; it does not wait for the CI workflow. A direct main push therefore is not an appropriate verification-only action. No push, PR, merge, workflow dispatch or deploy was performed.

Commands for a **subsequently authorized** publication of the exact verified source as a review branch (not executed):

```sh
git fetch origin
git branch verify/phase11-5e08d58 5e08d58a6e6ab54e387f876e93123920e38a6f3b
git push --set-upstream origin verify/phase11-5e08d58
```

That branch push alone will not trigger the existing CI. An authorized pull request to main triggers it, but default actions/checkout on pull_request builds the synthetic PR merge commit. Inspect its checkout logs and head SHA: do not label that an exact `5e08d58` checkout without proof. Obtain an approved CI checkout/publication path for the exact intended SHA, or explicitly designate and reverify a new candidate reconciled with current remote main. No force push or automatic merge is proposed. Any eventual main publication needs separate production-deployment authorization or an approved deployment hold.

### Clean Compose: PASS

Fresh checkout commands:

```sh
git clone --no-hardlinks --no-checkout /Users/ops/Documents/zenteqk/fenwira_v2 /private/tmp/fenwira-p11-release-5e08d58
git -C /private/tmp/fenwira-p11-release-5e08d58 checkout --detach 5e08d58a6e6ab54e387f876e93123920e38a6f3b
# In the clone:
node scripts/setup-env.mjs
```

The clone's tracked tree was clean before and after execution; no host node_modules/build output copied. Generated `.env` contains new disposable credentials and is ignored/0600. Resolved Compose was saved outside the clone as a 0600 scratch JSON file; only project/container/image/network/volume names and published port bindings were changed for isolation, plus test env values. No tracked Compose/Dockerfile change. Docker cached layers/package store were reused; this is fresh-clone/fresh-volume acceptance, not a no-cache rebuild. Normal repository Dockerfiles and production runtime targets built successfully on Docker 29.5.3/Compose 5.1.4, Node 22.23.3 (Linux).

Project: `fenwira-p11-release-5e08d58`; containers: `fenwira-p11-release-*`; image tags: `fenwira-p11-release/{api,worker,web,migrate,meta-mock}:5e08d58`; unique network and four fresh named volumes. All published ports loopback-only: API 54400, web 54300, MinIO 54900/54901, Mailpit 54825, Meta mock 54420. Postgres/Redis/worker health ports remain internal. All Meta URLs point at the local simulator; email uses local Mailpit. Both enforcement flags false; SYSTEM_PING_ENABLED true only in this disposable local stack.

Actual commands (scratch config contains disposable secrets; never commit or print it):

```sh
docker compose -f /private/tmp/fenwira-p11-release-config.json -p fenwira-p11-release-5e08d58 --profile meta-mock build
docker compose -f /private/tmp/fenwira-p11-release-config.json -p fenwira-p11-release-5e08d58 --profile meta-mock up -d --wait --wait-timeout 240 --pull never
API_URL=http://127.0.0.1:54400 WEB_URL=http://127.0.0.1:54300 bash scripts/smoke.sh
```

All exit 0. Five application image targets built; eight long-running services healthy; migration and bucket init completed exit 0. Container status snapshot:

| Service | Actual result |
|---|---|
| PostgreSQL | Healthy; PG 16.15; connectivity verified by psql and both application readiness probes |
| Redis | Healthy; PING → PONG; application queue readiness up |
| Migrate | Exit0; all 23 migrations applied, RBAC/plan seeds and RLS check passed |
| MinIO / bucket init | Healthy / exit 0; isolated buckets initialized |
| Mailpit | Healthy; synthetic local SMTP probe accepted and retained |
| Meta mock | Healthy; no real Meta/customer sends |
| API | Healthy; postgres/redis/queue up; reported intended full SHA |
| Worker | Healthy; postgres/redis/processors/outbox-relay up; same full SHA as API |
| Web | Healthy; health 200 and sign-in page renders |
| Smoke | **3/3 PASS**; includes API → PostgreSQL outbox → relay → BullMQ → worker, correlation retained |

API and worker both reported Node `v22.23.3`, APP_VERSION equal to the full intended SHA, BILLING_ENFORCED `false`, BILLING_SUBSCRIPTIONS_ENFORCED `false`. Fresh runtime-role inspection: fenwira_app and fenwira_owner both nonsuperuser/NOBYPASSRLS. Ledger count was **0 before and after probes**. No wallet/customer record fixture or financial mutation performed.

Additional bounded local runtime evidence from BullMQ read APIs (not staging proof):

| Queue | Consumers | Completed observed work | Schedulers |
|---|---:|---|---|
| system.ping | 1 | 1 successful smoke event | None required |
| webhooks.maintenance | 1 | 3 recover-pending jobs; each returned 0 on empty DB | 30-second recovery plus nightly retention |
| billing.maintenance | 1 | subscriptions-tick (0 subscriptions/notices); recover-reservations (0 settled/released) | 15-minute subscription tick, 5-minute reservation recovery, nightly ledger check |
| analytics.rollup | 1 | 2 rollups returning 0 on empty DB | Minute rollup plus nightly heal/retention |

All four inspected queues reported zero failed jobs. These are actual executions/schedulers, not assertions that populated financial/workspace lifecycle scenarios were rerun; populated recovery/lifecycle coverage remains the earlier integration evidence. Nightly schedules were registered but not forced or observed to execute during this short run. SMTP probe used the existing nodemailer dependency and the worker's local SMTP_URL; one synthetic `example.invalid` recipient was accepted and found in Mailpit. This verifies local transport, not SES or external alert routing. No external mail sent.

Build/startup/runtime/migration/smoke/health/queue/SMTP evidence: `/private/tmp/fenwira-p11-release-*`. No failures in build/startup/smoke. Readiness version fields are supplied APP_VERSION metadata corroborated by clean checkout/build source; no cryptographic artifact-signing claim. Image IDs captured locally. Raw logs/configs are not committed; they can contain disposable credentials.

### X-12 staging runtime: UNVERIFIED

The default AWS identity belongs to configured account 569476542351. Read-only EC2 metadata lookups in configured region ap-south-1 used `aws ec2 describe-instances` filters `Name=tag:Name,Values=*fenwira*` and separately `Name=tag:Environment,Values=staging,stage`. The former returned only running instance `i-0c5a3e148c5a81b9f`, Name `zenteqk-internal-fenwira-v2-prod-app`, Environment `prod`; the latter returned `[]`. This bounded lookup does not rule out untagged staging resources, other regions or another account. A staging endpoint/profile/instance was requested; none supplied at report time. No production instance connection, SSM command, secret read, financial operation or external customer send performed.

| Required staging evidence | Actual status |
|---|---|
| Exact deployed SHA and matching API/worker versions | UNVERIFIED; no staging target |
| Active worker and BullMQ queue operation | UNVERIFIED |
| Outbox and webhook recovery work | UNVERIFIED |
| Subscription and analytics schedulers executing | UNVERIFIED |
| SMTP configuration and actual delivery | UNVERIFIED |
| Matched approved billing enforcement flags | UNVERIFIED; no runtime env read |
| Required secrets present and runtime permissions correct | UNVERIFIED; no secret retrieval |
| Readiness and monitoring operational | UNVERIFIED |

Repository production units, deploy scripts, env rendering and health procedures were inspected as configuration only. The documentation's historical disabled-worker/SMTP note is not used as a current production observation. Once a distinct staging target is authorized/identified, use read-only health/version/service status, queue/scheduler/completion metadata, secret-name/presence/permission checks without values, and existing non-customer delivery evidence. Do not run the mutating development system.ping smoke against production or enable it there.

### Phase 12 disposition and recommendation

11.2-19 analytics performance/load measurements and 11.5-19 external alert delivery/routing remain **PARTIAL**. They are documented Phase 12 follow-ups subject to formal owner acceptance. Owner and approval reference were requested and are not supplied; no formal deferral acceptance is inferred. See PHASE_12_DEPENDENCIES for acceptance fields.

Updated inventory: **111 PASS / 3 PARTIAL / 0 FAIL / 1 UNVERIFIED (115 applicable)**. X-10 is PARTIAL because clean Compose passes and remote CI is blocked; X-12 remains UNVERIFIED. Two PARTIAL workstream rows are proposed Phase 12 deferrals; the other PARTIAL row is a mandatory gate. **NOT READY TO CLOSE** until exact-SHA CI, staging runtime evidence and named owner acceptance all exist. No new application defect established, and no application remediation performed.

### Release-verification cleanup

After evidence collection, `docker compose -f /private/tmp/fenwira-p11-release-config.json -p fenwira-p11-release-5e08d58 --profile meta-mock down -v --remove-orphans` removes only this project. Existing seven `fenwira-local-*` containers are preserved. Disposable config/env files and the five uniquely tagged build images removed after shutdown; project containers/network/volumes confirmed absent. Build/runtime diagnostic logs retained with restricted permissions. No global prune or infrastructure/deployment change. No push, PR, merge, deploy, production secret change or enforcement activation.
