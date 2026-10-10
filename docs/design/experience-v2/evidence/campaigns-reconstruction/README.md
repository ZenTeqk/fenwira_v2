# Campaigns and Campaign Studio — review evidence

Ready for visual review. This checkpoint implements Campaigns operations and Create Campaign together, validates them separately, and stops before Automations. Templates and its mobile recipient preview are already visually approved.

## Module

Campaigns list, existing campaign detail entry, and Create Campaign / Studio. Domain services and contracts are unchanged.

## Reference decomposition

`06-Campaign-studio.png` depicts the operations list: status views, toolbar, active/scheduled cards and compact history. `05-Campaign.png` depicts Create Campaign: connected steps, campaign/template identity, Personalize configuration, recipient preview, audience/charge/wallet summary and footer actions. Follow their composition using the approved Home/Inbox/Contacts scale and palette. [Detailed assessment](../../../EXPERIENCE_V2_CAMPAIGNS_RECONSTRUCTION.md).

## Product differences

No persisted campaign artwork/subtitle, friendly audience snapshot names or campaign-attributed reply counts exist. Semantic icons and actual frozen template/audience sources replace unsupported reference content. History shows actual sent/delivered/read results. Draft/scheduled recipients are not final before launch. Missing customer charge or wallet information is explicitly unavailable. Status counts, date/audience filters and sorting cover the loaded API collection, not a fabricated server-wide search.

## Visual changes

Compact operational cards, a coherent history surface and filter toolbar replace spacious repeated metadata. Campaign analytics remains a header link. Studio has one working surface, explicit contextual identity, connected steps, the approved mobile recipient preview and a separate action footer. First-pass Studio height was excessive: the final pass reduces decorative wallpaper, joins configuration sections and moves desktop save status alongside the steps. Complete message content remains visible.

## Geometry and density

Approved 224px navigation and 56px header. Two operational card columns and a 3:2 Studio configuration/preview split at xl; stacked below xl. Cards use 16px interiors; Studio sections use 12px. The compact phone option is Studio-only; approved Templates defaults are unchanged. Full-page screenshots retain legitimate content growth rather than clipping or scaling it.

## Data and functionality

Existing approved-version authority, eligibility/consent, frozen template, recipient snapshot, fallback handling, save-on-continue, schedule/timezone, pause recovery, wallet reservations, confirmation, retry idempotency and unsaved-navigation guards remain authoritative. Recipient examples are resolved by the saved server estimate only when audience/phone/version/mapping still match; edits revert to stored template examples. No local eligibility engine or invented financial metrics.

## Responsive behavior

Final operations, Personalize and Review were captured and visually inspected at 1440, 1024, 768 and 375px widths with 1000px viewport height. Steps/status views and history may scroll locally. Controls wrap and configuration precedes preview on narrow screens. Existing browser checks assert no page overflow. Baseline before captures use the earlier 1440 × 900 viewport; final captures are full-page where needed.

| Width | Operations | Personalize | Review |
| --- | --- | --- | --- |
| 1440 | [Screenshot](campaigns-1440.png) | [Screenshot](campaign-personalize-1440.png) | [Screenshot](campaign-studio-1440.png) |
| 1024 | [Screenshot](campaigns-1024.png) | [Screenshot](campaign-personalize-1024.png) | [Screenshot](campaign-studio-1024.png) |
| 768 | [Screenshot](campaigns-768.png) | [Screenshot](campaign-personalize-768.png) | [Screenshot](campaign-studio-768.png) |
| 375 | [Screenshot](campaigns-375.png) | [Screenshot](campaign-personalize-375.png) | [Screenshot](campaign-studio-375.png) |

Baseline: [operations](before/campaigns-1440.png), [Studio](before/campaign-studio-1440.png). First pass: [operations](first-pass/campaigns-1440.png), [Personalize](first-pass/campaign-personalize-1440.png), [Review](first-pass/campaign-studio-1440.png). The first-pass Personalize capture retains the visible failed-save toast from that iteration. Historical checkpoint artifacts remain unchanged.

## Accessibility

Axe checks cover populated layouts, loading and read-only states. Keyboard navigation, local scroll, named controls and permission boundaries are covered by browser checks. Lighthouse 12.8.2 accessibility: `/campaigns`, `/campaigns/new` and an existing draft `/campaigns/:id` each scored **100**, with zero failing audits and authenticated final URLs verified. [Sanitized results](accessibility.json). Automated accessibility evidence does not replace user visual review.

## Tests and concrete results — 2026-10-07

- Web unit tests: **15 passed**; API campaign unit tests: **5 passed**.
- Campaign worker lifecycle integration: **12 passed**, including real RLS, consent, duplicates, frozen-template recovery and 2,000-recipient execution (110.0s for that case).
- Campaign billing integration: **7 passed** on an unchanged focused rerun (15.74s overall). The initial combined run hit one existing 20s timeout during concurrent validation; its focused rerun passed that case in 3.912s. No timeout or assertion was weakened. These runs establish 19 distinct integration checks, not a claim that the initial combined run was clean.
- Campaign browser checks: **9 distinct tests passed across final/focused runs**: real launch/results/analytics, operations filters/four widths, funding/template recovery, Studio previews/four widths/stale sample behavior, unsaved navigation, lost launch response using the same idempotency key, read-only UI/API denial, loading/empty/error retry, and the three-route Lighthouse gate. The final combined run passed 8/9; the error-state test initially selected both the actual alert and Next.js route announcer. Scoping to the actual error alert passed in the focused regression run. Earlier selector fixes reflect accepted inline panels and accessible filter count suffixes; domain assertions remain intact.
- Final focused browser regression: **17 passed** (1.9m): 2 Campaigns permission/recovery tests plus 15 approved Home/Inbox/Contacts/Templates tests, including real messaging locks, consent/imports and template build → approval → inbox send. No tests skipped in this focused run.
- Web ESLint/typecheck, dependency boundaries (757 modules / 2,619 dependencies) and design-token check passed.
- Final Docker web production build passed (51 pages); the local web service is healthy.
- Final repository `pnpm format:check` and `git diff --check` passed.
- `pnpm smoke` passed API/Postgres/Redis/queue readiness, web sign-in rendering and API → outbox → relay → queue → worker round trip.

Commands: `pnpm --filter @fenwira/web exec playwright test campaigns.spec.ts campaigns-reconstruction.spec.ts experience-v2-batch-2.spec.ts --grep 'Campaign|Batch 2 primary'` with `EV2_CAMPAIGNS_LIGHTHOUSE=true`; focused campaign/approved-screen regression uses `--grep-invert Lighthouse`. Worker checks run their existing Vitest integration files in the test-profile container. Only isolated test data is used.

## Backend changes

None: no API, database, worker, billing/subscription, entitlement, Meta or platform authorization changes. No billing rollout flag is enabled for real users. No prices, promotional spending order, tax/gateway/postpaid policy or Phase 11 closure changes.

## Evidence and commit

Only intended screenshots, this review record and sanitized Lighthouse scores are retained. Browser reports, raw service logs, authentication state and temporary profiles are not added to Git. The local implementation commit contains this checkpoint; no push or deployment. Ready for visual review. Stop before Automations.
