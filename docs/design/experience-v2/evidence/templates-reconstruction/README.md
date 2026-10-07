# Templates — visual review checkpoint

Module: **Templates only**. Captured 2026-10-07 against the production local web image. Home, Inbox and Contacts are visually approved and unchanged. Campaigns and all later checkpoints remain gated on Templates visual approval.

## Reference decomposition

Compare the [approved Templates reference](../../04-Templates.png), [before library](before/templates-1440.png), [before overlay](before/template-context-1440.png), [first library pass](first-pass/templates-1440.png) and [first context pass](first-pass/template-context-1440.png). The [decomposition and correction report](../../../EXPERIENCE_V2_TEMPLATES_RECONSTRUCTION.md) was written before implementation and records the visual/product differences and iteration.

## Product differences from concept

Actual Meta identifiers, content, status, language, category, quality and version/account timestamps are used. No invented friendly-name field, usage counter, last-sync timestamp, semantic variable labels or customer photos. Counts describe the current queried library. Stored examples remain samples; they are not customer personalization mappings. Editing/new-version, submission/retry, version history and confirmed deletion continue through the full record page. Use in campaign and Open Inbox appear only with authoritative approved-version availability and the corresponding permission. Pending may still have a usable previous approved version; paused templates cannot send.

## Visual changes and geometry

Reference composition: header/actions → compact status navigation → one filtered message library → selected-template context. Library cards use 12px padding/gaps, 14px message text, semantic category/status, quiet updated/preview footer and emerald selection. The desktop panel groups name/status/actions, supported details, WhatsApp preview, stored examples and lifecycle explanations. The initial tall action stack was condensed; the reproduced 9px mobile header overflow was corrected through a Templates-only wrapping constraint. In-review text uses the warning token and retains its actual PENDING state/icon.

[Measured 1440 geometry](geometry-1440.json): **224px sidebar**, **56px topbar**, **320px context**, **approximately 261px card width** with context open. A short fixture card is **218px high**; longer messages determine their grid row height. The library-only preview treatment leaves builder, Inbox and Campaign renderer defaults intact. No shared shell styling changed.

## Data/functionality

Existing `/templates` queries support search/category/language/status; `/templates/sync` and its toast/invalidation retain the current sync behavior. Signed media sample reads, current version previews and `/templates/approved` are reused. The existing approved-version campaign entry link is preserved. Needs attention groups rejected/paused/disabled and stored submission failures without changing domain status. Sending-option failures have explicit retry. All records in screenshots are synthetic browser fixtures persisted through APIs/mock Meta, never hard-coded into production.

## Responsive evidence

| Width | Library | Selected template | Behavior |
| --- | --- | --- | --- |
| 1440 × 1000 | [Library](templates-1440.png) | [Inline context](template-context-1440.png) | Three-column message library, selected card and 320px panel |
| 1024 | [Library](templates-1024.png) | [Drawer](template-context-1024.png) | Two-column library; full context moves into drawer |
| 768 | [Library](templates-768.png) | [Drawer](template-context-768.png) | Navigation drawer, wrapping controls and two-column objects |
| 375 | [Library](templates-375.png) | [Full-width drawer](template-context-375.png) | One-column objects, practical preview targets, scrollable status navigation |

All final captures are visually inspected. Thumbnail/major-surface comparison is composition review, not pixel identity. Consistency: [Home](home-consistency-1440.png), [Inbox](inbox-consistency-1440.png), [Contacts](contacts-consistency-1440.png), plus their geometry JSON files. Approved screens keep their existing scale and presentation.

## Accessibility

Four-width WCAG 2.2 AA axe and no-page-overflow assertions cover library and context. Keyboard Preview/Enter/Escape/focus return, resize handoff and read-only inspection are verified. [Sanitized Templates Lighthouse audit](accessibility.json) scores **100**, verifies the protected final URL and reports **no failed accessibility audits**. No cookies, tokens, browser profiles, raw Lighthouse reports or verbose logs are retained. [Contacts regression audit](contacts-accessibility.json) scores **100** with no failed audits.

## Tests and build

- Web lint/typecheck, semantic design tokens, dependency boundaries and formatting pass. Boundaries: **752 modules, 2609 dependencies**.
- Web unit tests: **15 passed** across 4 files, 1.48s. Template contract validation: **12 passed**, 1.72s. Meta template payload unit tests: **5 passed**, 948ms. Total relevant unit checks: **32 passed**.
- Existing Templates integration suite: **12 passed**, 22.33s, isolated test database/mock Meta. Covers create/approval/send, immutable versions, previous approved version during review, schema/API validation, failed/lost submission retry, sync/status/quality/category, media, permissions/cross-tenant isolation, deletion, concurrent sync and periodic fan-out.
- Templates browser suite: **6 passed, zero failures/skips**, 1.1m. Covers four-width library/context and focus handoff, real sync/status/category/language/search filters, paused-template sending restriction, draft submission failure, read-only access, approved-option failure/retry, Lighthouse and create → approval → Inbox send.
- Foundation browser regression: **13 passed, zero failures/skips**, 1.4m. Includes Home/Inbox/Contacts four-width composition, messaging/realtime, keyboard, drafts, read-only access, contact filters/consent/CSV import and Contacts Lighthouse audit.
- The final shared-Badge substitution retains the language tag appearance; responsive/read-only/Lighthouse checks rerun: **3 passed**, 29.8s. Final captures come from this run.
- Production web build generates **51 pages** with **3 successful uncached tasks**. Local web container healthy; API/web/outbox smoke passes.

Browser commands:

```sh
EV2_TEMPLATES_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test templates.spec.ts templates-reconstruction.spec.ts experience-v2-batch-2.spec.ts --grep 'Templates|build →'
EV2_CONTACTS_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test home-reconstruction.spec.ts inbox-reconstruction.spec.ts inbox.spec.ts contacts-reconstruction.spec.ts contacts.spec.ts
```

The initial test import duplication was corrected; the first responsive run reproduced the header overflow and preserved failure evidence through the correction report. No tests were weakened. Earlier captures remain in before/first-pass folders.

## Backend/domain changes

**None.** No API contracts, migrations, domain services, queues, worker semantics, RBAC/RLS, Meta configuration, billing enforcement or platform UI changes. Existing lifecycle/security authority remains intact.

Ready for visual review. Stop here; do not begin Campaigns until the user approves Templates.
