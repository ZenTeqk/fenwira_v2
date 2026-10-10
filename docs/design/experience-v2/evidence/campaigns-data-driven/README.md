# Campaigns — API-driven reconstruction review

This checkpoint follows `06-Campaign-studio.png` as a layout specification. The application renders actual customer-created campaigns, tenant-authorized media/catalogs and domain statistics. Screenshot sample names/counts/dates are not application constants. Ready for visual review; this document does not declare visual approval or authorize another module.

## Review artifacts

[Reference/implementation comparison](compare.html), [before](before-1440.png), [first pass](first-pass/campaigns-populated-1440.png), final [desktop](campaigns-populated-1440.png), [1024px](campaigns-populated-1024.png), [768px](campaigns-populated-768.png), [375px](campaigns-populated-375.png), [history page 2](campaigns-history-page-2.png).

All current captures use a 1000px-high viewport and full-page output when content grows. First-pass review found dates wrapping into several lines in narrow history columns. The final pass preserves one-line dates within the locally scrollable table, tightens rows and strengthens campaign identity. Cards show actual artwork/message context, wrapping category/audience/recipient metadata, successful RUNNING treatment, real progress/results and explicit View schedule navigation. The approved shell scale remains unchanged.

## Repository assessment and changed files

- `apps/web/app/(app)/campaigns/page.tsx`: existing query/filter/state orchestration, safe retry copy and explicit filtered-empty copy; reduced from approximately 640 lines to 289.
- `apps/web/components/campaigns/campaign-card.tsx`, `campaign-history.tsx`, `campaign-identity.tsx`, `campaign-filter.tsx`: focused feature presentation, reusing shared UI primitives, existing stats/sample queries, actual DTOs and supported detail routing. No duplicate domain logic.
- `apps/web/lib/campaign-presentation.ts`: typed collection selection and view mapping, separated from data access.
- `packages/ui/src/components/status-badge.tsx`: scoped campaign context for RUNNING; existing success tokens, actual status/label, unchanged default in other modules. No new palette.
- Focused presentation/status unit tests, Campaigns browser state/permission/200-record tests, and existing filter expectations. Design-system, Campaign Engine, Experience V2 and reconstruction documentation updated.

The existing GET collection is capped at 200 records. Search/status/date/audience filters and five-row history pagination describe that loaded collection; this task adds no server pagination or global search. Friendly audience names come from authorized current catalogs and do not rewrite snapshots. Artwork is the frozen template IMAGE sample, with an icon fallback. Drafts/missing snapshots/rates remain unavailable. The stats contract has no attributed replies or bulk selection operation; neither is fabricated. No generic dashboard/KPI panels.

## Data and scope

[Sanitized local demo account/campaign snapshot](demo-workspace.json) identifies the final synthetic review workspace. Sign in locally using the existing public E2E PASSWORD fixture in `apps/web/e2e/support.ts`. Twelve persisted campaigns are created through the existing API: two featured campaigns and ten additional demo campaigns. Uploaded original banner samples, consenting synthetic contacts and localhost Meta simulation provide real domain records/results. The application contains no demo-specific rendering branch. Running/scheduled records continue evolving normally after capture.

A separate controlled 200-record browser response stresses long names/audiences, missing snapshots and collection pagination. It is a test fixture, not persisted financial/send history. The populated visual fixture uses persisted API data, not response mocks. No secrets, cookies, signed URLs, browser profiles or raw logs are retained in this evidence directory.

No API/controller, contracts, schema, database, worker, subscription, entitlement, wallet, billing flag, RLS or platform authorization changes. Create Campaign's existing persistence, preview, confirmation, eligibility, schedule, launch idempotency and unsaved-draft protection are preserved. No production Meta calls, pricing, gateways or Phase 11 closure.

## Validation

Earlier approved-screen regression captures: [Home](regression/home-1440.png), [Inbox](regression/inbox-1440.png), [Contacts](regression/contacts-1440.png), [Templates](regression/templates-1440.png). These use synthetic test records and retain the approved shell/layout.


Concrete validation on 2026-10-07:

- Campaigns/Studio suite: **11 passed (4.8m)** — real creation/launch/results, read-only UI/API denial, loading/first-use/error redaction/retry, filtered empty, 200 records/long names/audiences/missing snapshots, scheduled/paused recovery, recipient preview, unsaved navigation, same-key lost launch retry, populated visual fixture and Lighthouse.
- Final build recapture/recheck: **6 passed (3.1m)** — Campaigns permissions/states/200-record layout, populated persisted visual fixture, unchanged Templates library/sync regression and protected-route Lighthouse.
- Home/Inbox/Contacts/Templates: **11 distinct checks passed across runs**. The initial combined regression run passed 10 and timed out after 5 seconds waiting for Templates' sync feedback during the concurrent production build. That unchanged Templates test passed on the final quiet run in 13.5s. No expectation, timeout or unrelated product code was weakened.
- Populated fixture: **12 persisted campaigns**, real running/scheduled states, both history pages, loaded images/results, keyboard action-menu focus return, media failure fallback, zero page overflow and **zero Axe violations** at 1440/1024/768/375. All final widths and history page 2 visually inspected. The controlled 200-record fixture separately passed all four widths.
- Lighthouse 12.8.2: **100** for `/campaigns`, `/campaigns/new` and authenticated draft detail; **zero failed audits**, authenticated final URLs verified. [Sanitized scores](accessibility.json).
- Web unit tests **18 passed**; shared UI unit tests **55 passed**, including default RUNNING preservation and campaign status semantics. The UI suite emitted an existing Tabs `act(...)` warning; no failing tests.
- Web/UI ESLint and typecheck, design tokens and dependency boundaries **passed** (768 modules / 2,643 dependencies).
- Final Docker production web build **passed**, 51 pages generated; local web **healthy**. Repository formatting and `git diff --check` **passed**.
- Local smoke **passed**: API/Postgres/Redis/queue readiness, sign-in rendering and outbox → relay → queue → worker round trip.

Commands: `EV2_CAMPAIGNS_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test campaigns.spec.ts campaigns-reconstruction.spec.ts campaigns-visual-fidelity.spec.ts experience-v2-batch-2.spec.ts --grep 'Campaign|Batch 2 primary'`; foundation regression used `experience-v2.spec.ts experience-v2-batch-2.spec.ts --grep 'Home|Inbox|Contacts|Templates' --grep-invert Lighthouse`. After the responsive history refinement, final recapture used `campaigns-reconstruction.spec.ts campaigns-visual-fidelity.spec.ts experience-v2-batch-2.spec.ts --grep 'Campaigns (read-only|loading|adapt|populated)|Templates are a real|Batch 2 primary'` with the Lighthouse flag. Raw test outputs remain ignored; only intended screenshots and sanitized review metadata are versioned.

No full backend/Phase 11 closure suite was executed for this frontend checkpoint. Existing domain/closure evidence remains authoritative. Stop at Campaigns visual review; no push, external deployment or next-module implementation.
