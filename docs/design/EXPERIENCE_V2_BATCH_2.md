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

### EV2-06 — Templates

Replaced the dense administration table with a responsive message library. Existing current-version content, header/body/variables/footer/buttons/media and quality/status metadata remain authoritative. Shared signed sample URL access is reused by the editor and library. All/Approved/In review/Drafts/Needs attention views and real category/language/search filters lead to a focus-restoring preview drawer and the existing editor/detail/version actions. Inbox navigation is offered only when the existing approved-template read service says a version is sendable. Submission, resubmission, sync, deletion and Inbox sending retain their domain services. No backend/schema/contract changes or invented usage statistics.

A focused browser regression reproduced an existing create-and-submit failure: POST creation succeeds, submit fails, but the page remains `/templates/new`, so retry attempts another create. The adapter now opens the already saved draft on submission failure. The regression verifies retained DRAFT content/samples, the same saved identity and successful approval on retry. Both submit/save controls reject another click during a pending operation. Template lifecycle rules are unchanged; no Step 4 implementation is changed.

Validation: web lint/typecheck pass; 15 web unit tests pass; design lint passes; Docker production build passes (51 routes). Three Chromium cases pass: populated library/status/category/language/search/keyboard/four-width WCAG 2.2 checks; honest empty/retryable load state and create-submit-failure recovery; existing build/validate/submit/approve/version-history/Inbox-send lifecycle. Zero Axe violations and no page overflow at 1440/1024/768/375. Eight implementation screenshots retained under `experience-v2/evidence/batch-2/` and visually inspected. Accessibility audits wait for the transient submission toast to disappear after asserting its error; stored draft/editor content remains verified. Final whole-repository regression is pending.

Reference deviations: stored content replaces fabricated message illustrations; template usage counts are omitted because the contract has none. Narrow screens use one column and a full-width overlay; status views scroll locally. Existing Meta identifiers remain supporting information on the full detail route.

### EV2-07A — Campaigns

Running/preparing/scheduled/paused communications now have operational cards with real audience-source summaries, frozen message text, server-backed inclusive sent/delivered/read counts and server rate definitions. A shared native Progress primitive exposes actual sent/eligible counts. Active cards load four initially with explicit expansion; history remains a focused DataTable, with All/Active/Scheduled/Paused/Completed/Drafts views and search. Statistics are requested only for visible snapshotted campaigns; unsnapshotted audiences are explicitly prepared at launch. Drafts never show fictitious totals. The detail route preserves existing controls/recipient export/reporting, adds frozen message context and groups supporting counts below four primary results.

Funding/template/subscription/manual/number pauses preserve existing recovery semantics. Funding links are billing-permission guarded. No switch-template action for a frozen running campaign. Failed statistics are explicit and retryable. No backend/schema/contract changes or wallet/state-machine changes.

Validation: web/UI lint and typecheck pass; 15 web and 51 UI unit tests pass (two new native progress boundary/accessibility cases); design lint passes; Docker production build passes (51 routes). Three targeted Chromium cases pass: existing create/review/launch/delivery/recipient/analytics flow, real scheduled/paused/completed/draft views with preserved recipient identities and four-width WCAG 2.2/overflow checks, and rare funding/template pause presentation. The latter uses explicitly documented read-only contract fixtures to exercise rare states without enabling real billing enforcement; domain funding/reservation behavior remains covered by the existing integration suite, to be rerun at the final checkpoint. Four screenshots were visually inspected and retained.

The browser checks caught and fixed invalid spaced tab IDs and an ambiguous duplicated empty-state action. A pause assertion was corrected to the existing domain rule: queued messages may finish after a pause, while the snapshotted recipient records remain intact. Reference metrics, universal audience names, fictional thumbnails and reply rates are omitted. Cards stack below desktop; history scrolls locally on narrow screens without page overflow. Final whole-repository regression is pending.

### EV2-07B — Campaign Studio

Preserved the existing five-step builder and composed configuration beside a substantial WhatsApp preview and compact review summary. Explicit Save draft stays on the current step. Recipient personalization and eligibility/exclusions come from the server estimate after saving; unsaved changes clearly use template examples instead. Approved-template library navigation preselects only a version found in the existing phone-scoped approval service. Schedule/timezone conversion and launch validation remain server/domain-owned. Empty schedule time is safe and blocks continuation. Customer charge and available wallet funds retain their existing read models; no provider cost appears.

Unsaved links, browser Back and reload are protected; saved drafts exit freely. Confirmation cancellation restores focus, and discarding preserves the previously saved server draft. Pending operations block conflicting clicks/navigation. Save/estimate/launch failures retain inputs and offer explicit recovery. Launch retries reuse one idempotency key per saved revision, including a real successful launch whose response is intentionally lost. Canonical JSON comparison accounts for PostgreSQL JSONB property ordering when checking whether server previews match the saved configuration. No backend/schema/contract or Step 4 changes.

Validation: four targeted Chromium tests passed (existing create/review/launch/results, responsive Studio/server recipient samples/schedule conversion, unsaved navigation/reload/discard, and lost-response idempotent retry). Zero Axe WCAG 2.2 violations and no global overflow at 1440/1024/768/375. Four Studio screenshots were retained and visually inspected. Web lint/typecheck, 15 web unit tests and design lint pass; Docker production build passes (51 routes). Final whole-repository regression follows this increment.
