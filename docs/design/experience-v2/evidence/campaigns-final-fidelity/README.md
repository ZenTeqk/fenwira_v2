# Campaigns — populated reference fidelity review

Ready for visual review. This correction covers the Campaigns operations page shown in `06-Campaign-studio.png`. Create Campaign / Personalize Studio and the approved Home, Inbox, Contacts, Templates and shell language remain unchanged. No exact-match or user-approval claim.

## Reference decomposition and visual changes

| Reference area | Implemented correction |
| --- | --- |
| Status views and filter surface | Actual loaded status counts; compact search/status/date/audience/sort controls |
| Two featured campaign cards | Image-led identity, inline status, actual message summary and audience, working detail menus |
| Running campaign | Real sent/eligible progress and percentage; Delivered/Read/Started strip; frozen-template footer |
| Scheduled campaign | Actual schedule/timezone band, audience-at-launch explanation and View campaign navigation |
| Campaign history | Thumbnails, friendly authorized audience labels, compact rows, Campaign/Audience/Status/Sent/Delivered/Read/Date/actions |
| Pagination | Two five-row pages covering all ten additional persisted demo campaigns |

[Side-by-side comparison](compare.html) uses the actual uploaded reference and final rendered screenshot. Open at full size to assess the composition.

## Product differences

The approved shell stays 224px/56px, with existing Fenwira typography/tokens rather than globally changing accepted screens. Demo artwork is original, uploaded through the real template sample workflow; message text, dates and metrics are genuine synthetic local data rather than reference numbers. Artwork is taken only from frozen template IMAGE headers with the existing `templates.read` gate and tenant-scoped signed URL. Missing/unavailable/failed images retain semantic icons. The short description is the frozen message body; no new campaign-artwork/description schema exists. Catalog names are current authorized tag/segment labels and never redefine frozen recipients.

The campaign API has no attributed Replies field, and no supported bulk campaign action exists. Those reference controls remain absent rather than displaying fabricated metrics or nonfunctional checkboxes. Drafts retain an explicit view. Exceptional pause states and recovery links remain intact; additional active/paused campaigns remain accessible through Show more and status views. The footer explicitly describes loaded history records, not a fabricated server-wide total.

## Geometry, density and responsive behavior

Desktop uses two featured cards; narrow layouts stack them. Existing native history scroll keeps page width bounded. Card artwork is 128 × 80px from sm, reducing to 96 × 64px on mobile. History thumbnails are 56 × 36px. Table interiors are compact and the nested border/header background is removed to make one coherent history surface.

All final captures were visually inspected at 1440/1024/768/375 widths with 1000px viewport height. Full-page captures retain actual content growth. Both history pages show loaded data: the second-page capture waits for results/images and resets scroll before capture.

| View | Evidence |
| --- | --- |
| Desktop / first five history campaigns | [1440px](campaigns-populated-1440.png) |
| Desktop / remaining five history campaigns | [Page 2](campaigns-history-page-2.png) |
| Narrow desktop | [1024px](campaigns-populated-1024.png) |
| Tablet | [768px](campaigns-populated-768.png) |
| Mobile | [375px](campaigns-populated-375.png) |
| Prior implementation | [Before](before-1440.png) |
| First populated iteration | [Desktop](first-pass/campaigns-populated-1440.png), [mobile](first-pass/campaigns-populated-375.png) |

## Demo workspace and data

The local review workspace is **Acme Electronics — Campaign Demo**, account **campaign-visual-demo-muydq9uidnf1@fenwira.test**. Sign in through [local Fenwira](http://localhost:3000/sign-in) with the existing public local E2E `PASSWORD` fixture in [support.ts](../../../../../apps/web/e2e/support.ts). This account contains synthetic data only; no browser cookies, CSRF tokens, signed media URLs, sessions or real customer credentials are retained in evidence. [Sanitized account/campaign snapshot](demo-workspace.json).

Two featured campaigns (Diwali Electronics Offer and Weekend Sale) plus **ten additional campaigns**: October Offers, Product Launch, Payment Reminder, Back to School, Festive Reminder, Customer Appreciation, New Arrivals, Service Reminder, Loyalty Rewards and Year End Preview. Capture state: one running, one scheduled, eight completed, one cancelled and one draft. These are persisted API/domain records, not frontend route mocks. Eighty synthetic consenting contacts and real demo audience tags support the campaigns. Original banner images are uploaded, byte-verified and submitted as template samples through the real API; the local Meta mock approves them and simulates delivery/read receipts.

The running campaign starts after history preparation, using a deliberately slow mock response specific to its synthetic phone number so actual in-progress results can be captured. The browser fixture checks that API and mock targets are localhost/127.0.0.1 before creating anything. No Meta production call or billing rollout is performed. Statuses and counters continue to evolve normally after capture; refreshing later can show completion, and the scheduled campaign proceeds at its actual scheduled time. Earlier test fixtures live in separate synthetic accounts; this snapshot identifies the final review account.

## Data/functionality and backend changes

No API, database/schema, worker, subscription, entitlement, wallet, billing flag, Meta production configuration or platform authorization changes. Existing domain services provide every state/count/sample. No financial history is changed. Save, launch, scheduling, confirmation, frozen versions, consent, retries, idempotency, reservations and unsaved-draft protection stay authoritative. HTTP/CLI business logic is unaffected. No gateway, prices, tax rules or promotional consumption policy. No Phase 11 closure or Automations milestone.

## Accessibility and concrete validation — 2026-10-07

- Final populated fixture **passed** (1.8m): 12 real campaigns; correct running/scheduled state; five history rows per page; next/previous; fully loaded images/results; working keyboard detail menu and focus return; media-access failure fallback; no page overflow and zero Axe violations at all four widths.
- Final focused browser run **2 passed** in **2.6m**, including the populated fixture and protected-route Lighthouse gate.
- Lighthouse 12.8.2: `/campaigns`, `/campaigns/new`, and existing draft `/campaigns/:id` all **100**, zero failed audits, final authenticated URLs verified. [Sanitized scores](accessibility.json).
- **Eight existing Campaigns/Studio browser checks passed**: read-only UI/API denial, loading/first-use/error retry, real launch/results/analytics, populated filters/four widths, funding/template pause recovery, server-backed recipient preview/stale sample behavior, unsaved navigation, and lost launch response with the same idempotency key.
- The initial combined run passed those eight checks while the new fixture lacked the required template-submit idempotency header. A later fixture preparation let its campaign finish before capture. The fixture now supplies the required key and starts its deliberately slow simulated campaign after preparing history. No domain code or lifecycle assertions were weakened. A populated first-pass fixture also passed before the final mobile/history capture refinements.
- Web ESLint/typecheck, design tokens and dependency boundaries **passed** (758 modules / 2,625 dependencies). Web unit tests **15 passed**.
- Final Docker web production build **passed** (51 pages), local web healthy.
- Final repository `pnpm format:check` and `git diff --check` **passed**.
- `pnpm smoke` **passed**: API/Postgres/Redis/queue readiness, sign-in rendering and API → outbox → relay → queue → worker round trip.

Final capture command: `EV2_CAMPAIGNS_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test campaigns-visual-fidelity.spec.ts experience-v2-batch-2.spec.ts --grep 'Campaigns populated|Batch 2 primary'`. Earlier behavior validation used the existing Campaigns/Studio spec set with `--grep Campaign`. Full Phase 11 or backend integration closure was not repeated for this presentation-only correction; previous acceptance evidence remains unchanged.

## Evidence and commit

Retain only intended screenshots, the comparison document, sanitized demo snapshot and Lighthouse scores. Raw logs, browser reports/profiles and authentication state are not added to Git. The local correction commit contains this checkpoint; no push or deployment. Ready for visual review; stop before Automations.
