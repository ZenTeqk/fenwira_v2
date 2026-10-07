# Experience V2 checkpoint evidence

Scope: EV2-01–04 only; stop for App Shell/Home/Inbox visual review. Later modules and Phase 11 closure are not declared complete.

## EV2-01 — Audit and foundation

Completed repository/route/component/API audit and visual inspection of all eleven references; recorded content-based Campaign/Studio filename correction. Reused the existing central UI theme, accessible primitives, typography and spacing. Refactored palette/control radius/focus into warm neutrals and distinct WhatsApp/success meanings; documented muted-text contrast deviation. No backend/schema/security changes.

Validation: UI unit suite **49 passed**, UI lint/typecheck passed, design-token check passed. Existing Radix Tabs test emits its pre-existing act warning; assertions pass. Contrast matrix includes selected/neutral/sidebar surfaces. Responsive and browser comparison are scheduled with the shell/Home/Inbox increments. See implementation plan for omitted unsupported screenshot features. Next: EV2-02 shell.

## EV2-02 — App Shell

Completed light 232px navigation, warm canvas, restrained active state, light mobile drawer, real member/role footer with shared account actions, wider contextual search and Home labels with stable `/dashboard` deep links. Reused session, workspace switch, command palette, notifications, help, permissions, wallet/connection hooks and shared primitives. No backend changes or rollout changes.

Validation: frontend lint/typecheck and **13 unit tests passed**; production web Docker build passed and local web restarted against existing mock services. Shell/navigation/keyboard/design/responsive/smoke browser run: **34 passed**, one renamed-link selector was ambiguous with the brand home link; corrected to exact Home navigation matching, focused rerun **1 passed**. Four widths (375/768/1024/1440) have no page overflow, icon rail persists at 64px, all visible navigation is reachable by command palette; shell/Home axe checks pass. No functionality was weakened to fix the selector. Final aggregate rerun follows Inbox.

Visual alignment: light sidebar/emerald selection/white topbar/warm surfaces follow all reference shells. Existing brand and icon rail remain intentionally preserved. Existing NOT_ENFORCED wallet visibility is preserved; no fictitious amount. Next: EV2-03 attention-first Home.

## EV2-03 — Home

Completed attention-first white rows, recent conversation links/avatars/assignment/unread, campaign state/update timeline, real flow status/run counts, compact secondary metrics and readable health status. Reused DashboardLayout, MetricCard (compact variant), Timeline, server-owned wallet/analytics state, permissions and existing queries. Refactored permission-aware loading and explicit activity-load errors; no backend changes.

Validation: frontend lint/typecheck, **13 frontend unit tests**, **49 UI unit tests**, UI lint and design check pass. Production web Docker build passes. **9 browser tests pass**, including real mock customer/campaign/flow records, Home deep links, API failure/retry, four-width no-overflow and WCAG 2.2 AA checks. Desktop and mobile screenshots visually inspected against reference 01; all four screenshots captured in ignored test-results for final checkpoint evidence.

Deliberate deviations: campaign state/update timeline replaces the unsupported unified event feed; seven-day figures stay labelled seven days and unprocessed analytics are explained; real run counts come from the existing flow contract, not screenshot values. Existing brand, status meanings and NOT_ENFORCED presentation preserved. No false “all clear” during failed activity loading. Next: EV2-04 Inbox.

## EV2-04 — Inbox

Completed `/inbox`: desktop view rail, avatar-led conversation rows, existing status/assignment/unread filters, balanced thread and lightweight contact context, shared textarea and wrapping real-action toolbar. Thread groups only matching sender/source within five minutes and the same day, labels internal notes, shows date breaks and previews actual authorized image/sticker media. Context has explicit contact/note/history loading and error states. Below 1280px context is a drawer; below 1024px view controls move into the list; below 768px list/thread are sequential with back navigation.

Reused the existing conversation/message/note queries, virtualized history, signed media URLs, compose locks, template picker, canned replies, attachments, assignment/status/takeover controls, permission service, eligibility and WhatsApp connection hooks. Added a small view-choice component and a pure presentation grouping helper. No API, schema, wallet, subscription, entitlement, platform authorization or other domain changes. No production flags changed.

Refactored two reproduced client correctness issues: reconnect now refreshes tenant-scoped authorized HTTP state so messages missed offline appear; pending sends disable editor/mode changes so an acknowledgement cannot erase a newly entered note. Regression tests reproduce real socket disconnection and hold the actual send response before checking draft protection. Server sending/eligibility remain authoritative.

Accessibility: read-only membership never renders reply actions; service-window, consent/eligibility and connection conditions retain explicit explanations. Focusable keyboard scrolling fixes the thread's axe finding. Contact and mobile-navigation drawers restore focus to their initiating buttons. Attachment input has visible keyboard focus; central input placeholder uses the accessible muted text token. Status and internal-note distinctions have text labels. Four-width axe checks, no-overflow checks and screenshots are part of the final checkpoint run.

Visual alignment: warm light shell, separate view/list/thread/context surfaces, restrained green replies and neutral internal notes follow reference 02. The customer identity remains readable on mobile. Deliberate deviations retain supported personal assignment, takeover and resolved views instead of unimplemented team queues; omit fake unread counts, starred queues, calls, AI replies and CRM cards. Existing replies, templates, notes, media and history remain available by permission. No screenshot data is embedded in production code.

Remaining: **stop for App Shell/Home/Inbox visual review** after final validation below. EV2-05–12 are not implemented by this checkpoint.

## Aggregate checkpoint validation

Validation date: 2026-10-06. Local mock Meta services only; no production rollout or real customer data. [Eight inspected screenshots and comparison notes](experience-v2/evidence/README.md) are retained; transient test output stays in ignored `apps/web/test-results/`. No root log files created.

| Check | Concrete result |
| --- | --- |
| Repository lint | Passed: package ESLint, dependency boundaries (732 modules / 2540 dependencies), semantic design tokens. |
| Typecheck | Passed across the repository; frontend lint/typecheck rerun after the pending canned-reply guard. |
| Unit tests | **295 passed**: API 130, web 15, UI 49, contracts 40, config 16, WhatsApp 33, database 3, queue 5, worker 4. Unchanged backend tasks reused Turbo results; changed frontend/UI tests executed. |
| Browser regression | Full run: **83 passed**, two ambiguous account-menu selectors failed, one existing optional visual-capture test skipped. Fixed selectors; focused real sign-out and MFA rerun: **2 passed**. Both topbar and sidebar-footer actions verified. Final production-image rerun of responsive Inbox, pending-response draft protection (including canned replies), and existing canned-reply send: **3 passed (17.4s)**. All **85 non-optional cases** validated. |
| Responsive/accessibility | Home/Inbox at **1440/1024/768/375**, zero page overflow and zero axe WCAG 2.2 AA violations. Existing commercial/platform/overlay/keyboard regressions pass. |
| Lighthouse | Authenticated Home **100**, populated Inbox **100**, protected final paths verified; [sanitized scores](experience-v2/evidence/accessibility.json). |
| Backend integration | **476 passed**, two existing opt-in performance cases skipped: database 251, API 10, worker 215. Fresh migrations, post-migrate setup, seeding and RLS checks pass. Nine Turbo tasks successful; integration tasks uncached; total **10m24.332s**. Includes 50k-row import and 2,000-recipient campaign (**110.9s**), security matrices, provider-cost confidentiality and Steps 1–4 financial/subscription regressions. |
| Production build | Final web Docker build **passed** after the pending canned-reply guard, including TypeScript and 51 routes; three build tasks successful, **50.986s**. Local web restarted successfully. |
| Formatting | Passed, including final checkpoint documentation and evidence. |
| Smoke | Passed: API ready, web health/sign-in rendering, and API → outbox → relay → queue → worker round trip. All eight local services healthy. |

Integration storage is a new `fenwira_ev2_20261006_ui` database and previously empty Redis DB 7. Existing accepted ledger/audit history was not reset. Existing server-dev image sources were verified against 341 current backend/source/test/schema/SQL/contract files before reuse (aggregate SHA-256 `478e2e79da35dc90c3a47420e3ae430f3d30f48f19468ab96ba98d942442c7cc`). Integration tasks explicitly bypass Turbo cache.

Build limitation: host `pnpm build` first hit Google font retrieval restrictions; its retry progressed to a Turbopack/PostCSS port-binding `Operation not permitted` error in the execution environment. No bundler/font changes were introduced to conceal this. The production Docker build is the runnable build evidence. A fresh-clone/full-image pull and CI remain separate from this cached local-stack verification; the previously documented MinIO pull blocker is not resolved or reclassified by this UI work.

Existing Radix Tabs unit `act(...)` warnings and worker test-server listener warnings are recorded without weakening assertions. Final local rollout inspection confirms `BILLING_ENFORCED=false` and `BILLING_SUBSCRIPTIONS_ENFORCED=false`; source diff has no changes to backend services, contracts, database/schema/migrations, configuration, Compose or lockfile.

## Checkpoint decision and next work

Implemented independently: audit/foundation (`1a57b4c`), shell (`abd4330`), Home (`1e429b1`), Inbox plus checkpoint evidence (this increment). Current compositions are ready for user visual review against approved references 01/02 and the common shell.

Pending user review, **stop here**. Contacts, Templates, Campaigns and remaining EV2 compositions stay in the implementation plan. No all-Experience-V2 acceptance or Phase 11 closure is declared. The approved commercial/product/security decisions remain authoritative.

## Subsequent checkpoint — Batch 2

The user approved this foundation checkpoint and authorized Contacts → Templates → Campaigns → Campaign Studio. The historical validation above remains foundation evidence. The [Batch 2 checkpoint report](EXPERIENCE_V2_BATCH_2.md) records the separate increments and fresh regression results, with [24 responsive implementation captures](experience-v2/evidence/batch-2/README.md). Batch 2 stops for visual/product review before later compositions; foundation approval does not imply approval of this batch.
