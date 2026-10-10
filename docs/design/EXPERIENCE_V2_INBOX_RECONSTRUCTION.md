# Inbox visual reconstruction

## Authority and reference decomposition (before implementation)

The density-refined Home in `ef485de` is visually approved and is the canonical global language. It stays unchanged. Inbox uses the same shared shell, 224px sidebar, 56px topbar, compact 36px controls, 32px ordinary avatars, 14/20 body and 12–13px metadata. The original [02-Inbox reference](experience-v2/02-Inbox.png) determines composition rather than overriding Home's scale or the actual Inbox domain.

The reference separates four working regions beneath the global header: a calm contextual view rail; an avatar-led conversation list with grouped filters; a flexible warm conversation thread; and a lighter context panel with strong identity, tags, notes and activity. Fine dividers and small gutters keep the regions continuous. The thread leads through warm-neutral canvas, naturally sized white incoming and emerald outgoing bubbles, secondary timestamps/read ticks and a purposeful compact composer. Context has section hierarchy rather than a stack of generic cards.

Compared with the reference and approved Home, the previous Inbox has a 232px global sidebar, 160px views and a roughly 272px actual conversation list, a 256px context panel and a flexible thread. Search/status/unread controls stack without a list heading. Rows use 40px avatars and vertically stacked assignment/window/takeover metadata (roughly 118–152px per row in prior evidence), reducing human conversation volume. The thread header wraps its service-window badge and assignment/resolve actions above an oversized takeover alert. Bubbles can consume almost the full available width; the three-row textarea and separate toolbar resemble a general form. The 64px context avatar and repeated label/value sections dominate the narrow panel. Existing warm/emerald/note tokens, varied avatars and delivery statuses already provide the correct reusable palette.

## Planned geometry and behavior boundaries

- Reuse the exact approved Home shell geometry for Inbox only, preserving Home and all other modules. No separate global Inbox sidebar.
- At 1440×1000: views 176px, conversation list 320px, context 256px, thread the largest flexible region. At 1024, retain a contextual rail and narrower list while context moves to its existing drawer. At 768, views become list controls; list and thread remain beside each other. At 375, keep the existing sequential list → thread → back flow and accessible context drawer.
- Conversation rows: 32px deterministic varied avatars; 14px customer/preview, 12px timestamp/assignment; unread weight/count and selection tint/accent. Consolidate secondary state on a compact line without changing queries, status definitions, sorting or read behavior.
- Thread: compact identity/actions, separate real service-window/status/tag strip, restrained takeover explanation with its existing action. Limit bubbles to a comfortable fraction of thread width, preserve same-sender grouping and virtualized measurements; warm labelled private notes stay distinct.
- Composer: clear Reply/Internal note mode, a two-line writing surface with integrated toolbar and compact Send/Save action. Preserve every existing template, file-upload, canned-reply, lock, optimistic-send, busy/draft and error path. No emoji picker exists; do not invent one.
- Context: compact identity, stored tags, assignment, authoritative eligibility/consent, notes and actual other conversations. Existing permissions and contact read services remain authoritative; no CRM/SLA/teams/AI/call concepts. No fabricated global view counts or activity history.

## Validation and evidence plan

Persist populated fixtures through existing local APIs and mock-provider input; use real replies, notes, assignments, tags and delivery states. Capture 1440×1000 and iterate deliberately, then capture 1024/768/375 with Axe WCAG 2.2 AA and overflow checks. Compare final Home/Inbox side by side. Preserve original reference and earlier Inbox captures; retain new evidence separately under `experience-v2/evidence/inbox-reconstruction/`.

Run formatting, lint, typecheck, unit tests, existing Inbox integration, browser reliability/permissions/keyboard/tenant regressions, authenticated Lighthouse, production Docker web build and smoke. Record exact results and any limitations. Backend/domain changes: **none**. Billing enforcement unchanged. Stop for visual review; no later module propagation or Phase 12 work.

## Final implementation and results

### Panel geometry and scale

| Dimension | Before | Reconstruction |
| --- | --- | --- |
| Global sidebar / topbar | 232 / 56px | 224 / 56px, identical to approved Home |
| Global search | Right-aligned 288px | Home's centered 384px at 1440, 288px at 1024 |
| Views | 160px | 176px; 36px controls with grouped views |
| Conversation list at 1440 | Approximately 272px | 320px |
| Thread at 1440 | Approximately 480px | 424px, still the largest individual region |
| Customer context | 256px | 256px; optional drawer below 1280 |
| Outer gutter / pane gaps | 8 / 8px | Preserved |
| Ordinary conversation avatar | 40px | 32px |
| Context identity avatar | 64px | 40px, stronger identity without an oversized identity card |
| Conversation preview | 13/18 | 14/20; unread preview has stronger weight |
| Ordinary row | Approximately 118px | 89px; selected assigned/takeover row 117px versus approximately 152px before |
| Thread header, populated case | Approximately 234px | 209px including tags, window, assignment and takeover explanation |
| Composer, normal populated case | Approximately 197px | 165px; two-line textarea and integrated toolbar |
| Composer controls | 36px with wide send button | 36px desktop / 40px mobile, compact round Send/Save |
| Message body / secondary text | 14px / 12–13px | Preserved |
| Bubble maximum width | `max-w-prose`, nearly full narrow thread | Five-sixths of usable width, naturally short messages stay short |

Baseline dimensions come from retained prior evidence and source. Final desktop geometry is exported directly from the production DOM, without user data or secrets. No zoom, scaling, new palette, dependency or global primitive size change.

### Conversation list

Added a compact heading and grouped search/status/unread controls. Existing All/Mine/Unassigned/Unread/Takeover/Resolved filters and status queries stay authoritative. Ordinary rows consolidate actual assignment and window state on secondary metadata; exceptional takeover/pending states remain visible. Selected tint/accent and unread counts/weight distinguish active work without a saturated block. Names and real message previews lead the row. The global unread badge retains its existing server counter; no invented contextual totals.

The scroll region uses paint containment after a populated nine-conversation fixture reproduced extra document height at 1024 and 768. A focused browser assertion now checks that long lists scroll locally without adding a second page scrollbar. Selection remains keyboard operable, with a visible focus ring inset inside the row.

### Thread and message surfaces

Identity and Resolve/More lead the compact header; masked phone is secondary, with authorized full contact details still available in context. Assignment moves into the real window/status/tag strip so it no longer truncates the customer's name. Existing individual-member actions, snooze/reopen/takeover and tag mutations are unchanged; the assignment menu says Workspace members rather than implying team queues.

The service-window countdown still uses the existing backend `isOpen`/`expiresAt`; healthy is soft emerald, existing last-hour expiry state and closed window are amber. Server eligibility remains authoritative. The takeover strip retains its explanation and existing Return to automation action. The warm thread uses white incoming, perceptible emerald outgoing and separately labelled private notes with restrained depth, compact timestamps and actual inline delivery state. Existing five-minute sender grouping, day boundaries, media links, earlier-message loading, error states and virtualized measurement/scroll behavior stay intact; grouped rows have less spacing than sender/event boundaries.

### Composer

An integrated writing surface and toolbar replace the separate textarea/form appearance. Reply and Internal note remain explicit; note mode has a warm surface and Only your team sees notes placeholder. Existing templates, file upload, canned reply insertion, Enter/Shift+Enter, compose locks, busy state, optimistic reconciliation and error handling are unchanged. No unsupported emoji picker, AI, call or automatic reply is added. Mobile toolbar targets are 40px; 14px body text and shared focus states remain.

### Customer context

Compact horizontal identity, stored contact tags and actual assignee precede authoritative messaging eligibility, consent, contact notes and other conversations. Conversation tags remain in the thread; contact tags remain in context, preserving their existing distinction. Fine separators and warm notes organize context without a card wall. Contact permissions gate the same read services; no new broad customer-data access or fabricated activity is introduced. Drawer focus restores to its existing trigger.

### Deliberate visual iteration

1. The first production capture established the four-pane composition and Home shell consistency. One populated case passed at all four widths (15.6s aggregate). Direct comparison exposed truncated thread identity and flat context hierarchy.
2. The second capture moved assignment below identity and separated context tags/assignment. Both populated and empty/error/search/keyboard cases passed (25.8s). All four captures were inspected. A subsequent geometry probe confirmed long-list document overflow at 1024 (1118px page height for a 1000px viewport) and 768 (1034px); desktop/mobile were 1000px. This is a presentation containment defect, not an Inbox domain issue.
3. Final refinement adds list paint containment with a vertical-overflow regression, a shorter search prompt and amber strip near expiry. Final evidence/validation follows below. Earlier iterations and historical Inbox/reference images stay untouched.

The thumbnail composition is deliberately communication-led: human avatar rows, active emerald selection, a warm central exchange, emerald outbound messages, clearly private notes and structured lightweight context. Differences from the concept are actual data/product constraints: no Teams/Sales/Support/Orders, ticket/SLA/priority/CRM, calls, AI, voice-waveform mockup, product carousel, fabricated typing indicator or view counts. Real delivery states and supported media presentation are retained.

### Responsive, accessibility and final validation

All final captures were visually inspected: 1440/1024/768/375, private note composer, mobile list/context and Home consistency. At 1024 the views remain 176px and the list becomes 264px; context uses its existing drawer. At 768 the views become list controls alongside the thread. At 375 selection/back navigation remains sequential, with the context drawer restoring focus. Desktop geometry matches the table above. Final document height stays within the 1000px viewport at every width; long lists scroll inside their pane. Axe WCAG 2.2 AA reports zero violations on all four populated widths and the mobile drawer, with additional empty/error-state coverage. Authenticated Lighthouse 12.8.2 scores **100 for Home and 100 for Inbox**, with final URLs verified and no failing accessibility audits; see the sanitized [results](experience-v2/evidence/inbox-reconstruction/accessibility.json).

Concrete local validation:

- `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`: passed. **299 unit tests** across the workspace; the changed web suite executes 15 tests, including message grouping, while unchanged package suites reuse valid task-cache results. Dependency boundaries and design checks pass.
- `docker compose --profile test run --rm --no-deps fenwira-test sh -c 'pnpm --filter @fenwira/worker exec vitest run --config vitest.integration.config.mts test/inbox.int.test.ts'`: **10 passed (33.85s)** on the unchanged isolated Inbox suite. Its initial run had 4 passed and 6 failed waiting for verification email; rerunning the same suite passed. No integration assertion, harness or domain implementation changed, and the mail-delay root cause is not established. Coverage includes ordering/unread/deduplication, window enforcement, takeover, tenant isolation, assignment, snooze and canned-reply permissions.
- `EV2_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test inbox-reconstruction.spec.ts inbox.spec.ts experience-v2.spec.ts home-reconstruction.spec.ts responsive.spec.ts keyboard.spec.ts design-system.spec.ts smoke.spec.ts tenancy.spec.ts a11y.spec.ts campaigns.spec.ts`: **60 passed, 1 failed (4.2m)**. The failure was in the updated palette test: its leaf-label check mistakenly treated Analytics → Inbox as the root Inbox. Restricting the check to the exact root label preserves both route assertions. The focused rerun, `pnpm --filter @fenwira/web exec playwright test keyboard.spec.ts --grep 'CommandPalette navigates'`, **passed (1 test, 7.3s)**. Thus all **61 distinct cases** were verified across these runs, with no skips; the original aggregate is not represented as wholly passing. Browser coverage includes real Inbox replies/notes/canned replies, window state, permissions, two-agent locking, pending drafts, offline recovery, empty/error/search states, keyboard navigation, tenant cache isolation, Home regressions and responsive accessibility.
- Final production Docker web build: **3 uncached build tasks passed (40.025s), 51 routes built**; rebuilt web starts healthy. Earlier visual iterations were also built and exercised against production web. No backend rebuild or source change was necessary.
- `pnpm smoke`: passed API readiness, web sign-in and the persisted outbox → relay → queue → worker round trip. All eight local services are healthy. Both local billing enforcement flags remain false.

These are local checks against the existing stack and isolated Inbox integration database; no CI, clean-volume deployment, full integration-suite or Phase 11 closure result is claimed.

### Backend/domain changes

**None.** No backend, schema, contract, RLS, RBAC, messaging/campaign/automation engine, analytics, wallet/subscription or rollout changes. No approved Home presentation changes; its existing conditions produce the same shell and its application components are untouched. No later module or platform styling changes. Billing enforcement remains rollout-controlled and disabled in the local stack. No Phase 12 or closure milestone.

### Evidence and review boundary

New evidence is separate under [Inbox reconstruction](experience-v2/evidence/inbox-reconstruction/README.md), including the original-reference/prior/final comparison and Home/Inbox consistency at 1440. Historical Home/Inbox screenshots are preserved. Stop for user visual review; engineering test success is not visual approval.
