# Experience V2 — Batch 2 checkpoint

The user approved the App Shell/Home/Inbox foundation and authorized EV2-05, EV2-06, EV2-07A and EV2-07B. Baseline: `phase-11`, `15a92a0`, clean tree. Work is confined to `fenwira_v2`. Preserve the accepted foundation and stop after this batch for visual review.

## Repository-aware plan

1. **Contacts:** reuse ListPage/DataTable, contextual navigation, Avatar, filters, ContactFormModal, DetailDrawer and the centralized eligibility query. Refine contact identity/phone/tags, actual assignment and last incoming-message fields. Expand lightweight context with existing conversation/activity/campaign reads. Preserve imports, segments, consent and bulk operations. No invented team names or composite eligibility policy.
2. **Templates:** replace the dense table with a restrained message library using the existing TemplatePreview, current version content and real status/quality metadata. Add scoped status views/search/category/language filters and quick context. Reuse the authoritative editor/version/submission/deletion routes. No fabricated usage counts or new template formats.
3. **Campaigns:** show running/scheduled/paused communications ahead of refined history. Reuse campaign list, statistics, frozen template content, server rates and existing controls/deep links. Show explicit funding/template pause recovery. No fictional reply metrics, audience names or thumbnails.
4. **Campaign Studio:** preserve the five steps and existing domain services, but compose configuration beside a substantial live preview and summary. Use server sample estimates, actual field mapping and one-time schedule/timezone conversion. Add explicit draft saving/protection and pending-operation guards with focused regressions. Preserve launch confirmation and idempotency; no provider cost.

Approved reference mapping: 03 Contacts, 04 Templates, **06 contents = Campaigns list**, **05 contents = Studio**. Original references remain unchanged. All four images visually inspected before code changes. Existing accessible muted text token remains authoritative; no foundation/theme redesign.

Each increment will be runnable, tested and committed separately. Final validation includes format/lint/typecheck/unit/integration/browser/accessibility, Docker production build, smoke and existing dependency/design/OpenAPI checks. Capture implementation evidence separately under `experience-v2/evidence/batch-2/`, at 1440/1024/768/375 where applicable. Keep transient output in ignored test-results, not root log files.

## Known data boundaries

Contact list has `lastInboundAt`, not a denormalized last-conversation record. Contact owner IDs lack display names in the contact contract: show actual self/unassigned/assigned state, never fictional people. Eligibility stays purpose-specific and server-owned. Template usage counts are absent. Campaign counts/rates come from `/campaigns/:id/stats`; only supported metrics are shown. Audience configuration contains IDs/filter definitions, not universal friendly audience names. Campaign Studio obtains eligibility, exclusions, resolved samples and customer charge from the existing estimate endpoint after saving a valid configuration.

## Checkpoint results

Implementation and concrete validation evidence will be recorded per increment before final acceptance preparation. No subsequent EV2 module or Phase 11/12 closure is authorized by this batch.

### EV2-05 — Contacts

Implemented avatar-based identity, actual assignment, tags, purpose-specific eligibility and last incoming-message context. Reused the existing list/search/filter/import/export/segment/bulk services and detail editor. The quick drawer uses existing conversation/activity/campaign reads, explicit loading/error states and permission-guarded navigation. The full profile keeps its existing consent, notes and lifecycle operations. No backend, schema, contract or authorization changes.

Validation: web/UI lint and typecheck pass; 15 web and 49 UI unit tests pass; design lint passes; Docker production build passes (51 routes). Six targeted Chromium cases pass: creation/consent/notes, filter/segment, CSV import, existing eligibility quick view, populated four-width accessibility/overflow/focus checks and retryable search/eligibility errors. Axe WCAG 2.2 checks report zero violations at 1440/1024/768/375. Eight screenshots under `experience-v2/evidence/batch-2/` were visually inspected. Stable column definitions preserve keyboard focus and prevent row remounts; both name-trigger and menu-trigger drawer focus restoration are verified. Mobile keeps a keyboard-focusable local table scroll area and a full-width context drawer, with no page overflow.

Deviations from the reference are data-driven: no invented assigned-person names, last-conversation field or send action for a contact without a conversation. The existing server eligibility service remains authoritative. Final whole-repository regression is pending completion of all four increments.
