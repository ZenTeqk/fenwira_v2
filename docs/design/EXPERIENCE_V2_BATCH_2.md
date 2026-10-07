# Experience V2 — Batch 2 checkpoint

The user approved the App Shell/Home/Inbox foundation and authorized EV2-05, EV2-06, EV2-07A and EV2-07B. Baseline: `phase-11`, `15a92a0`, clean tree. Work is confined to `fenwira_v2`. Preserve the accepted foundation and stop after this batch for visual review.

Final checkpoint prepared on **2026-10-07**. All four increments are implemented and validated; visual/product approval remains pending.

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

Implementation and concrete validation evidence are recorded per increment and in the final aggregate checks below. No subsequent EV2 module or Phase 11/12 closure is authorized by this batch.

### EV2-05 — Contacts

Implemented avatar-based identity, actual assignment, tags, purpose-specific eligibility and last incoming-message context. Reused the existing list/search/filter/import/export/segment/bulk services and detail editor. The quick drawer uses existing conversation/activity/campaign reads, explicit loading/error states and permission-guarded navigation. The full profile keeps its existing consent, notes and lifecycle operations. No backend, schema, contract or authorization changes.

Validation: web/UI lint and typecheck pass; 15 web and 49 UI unit tests pass; design lint passes; Docker production build passes (51 routes). Six targeted Chromium cases pass: creation/consent/notes, filter/segment, CSV import, existing eligibility quick view, populated four-width accessibility/overflow/focus checks and retryable search/eligibility errors. Axe WCAG 2.2 checks report zero violations at 1440/1024/768/375. Eight screenshots under `experience-v2/evidence/batch-2/` were visually inspected. Stable column definitions preserve keyboard focus and prevent row remounts; both name-trigger and menu-trigger drawer focus restoration are verified. Mobile keeps a keyboard-focusable local table scroll area and a full-width context drawer, with no page overflow.

Deviations from the reference are data-driven: no invented assigned-person names, last-conversation field or send action for a contact without a conversation. The existing server eligibility service remains authoritative. Final whole-repository regression results are recorded below.

### EV2-06 — Templates

Replaced the dense administration table with a responsive message library. Existing current-version content, header/body/variables/footer/buttons/media and quality/status metadata remain authoritative. Shared signed sample URL access is reused by the editor and library. All/Approved/In review/Drafts/Needs attention views and real category/language/search filters lead to a focus-restoring preview drawer and the existing editor/detail/version actions. Inbox navigation is offered only when the existing approved-template read service says a version is sendable. Submission, resubmission, sync, deletion and Inbox sending retain their domain services. No backend/schema/contract changes or invented usage statistics.

A focused browser regression reproduced an existing create-and-submit failure: POST creation succeeds, submit fails, but the page remains `/templates/new`, so retry attempts another create. The adapter now opens the already saved draft on submission failure. The regression verifies retained DRAFT content/samples, the same saved identity and successful approval on retry. Both submit/save controls reject another click during a pending operation. Template lifecycle rules are unchanged; no Step 4 implementation is changed.

Validation: web lint/typecheck pass; 15 web unit tests pass; design lint passes; Docker production build passes (51 routes). Three Chromium cases pass: populated library/status/category/language/search/keyboard/four-width WCAG 2.2 checks; honest empty/retryable load state and create-submit-failure recovery; existing build/validate/submit/approve/version-history/Inbox-send lifecycle. Zero Axe violations and no page overflow at 1440/1024/768/375. Eight implementation screenshots retained under `experience-v2/evidence/batch-2/` and visually inspected. Accessibility audits wait for the transient submission toast to disappear after asserting its error; stored draft/editor content remains verified. Final whole-repository regression results are recorded below.

Reference deviations: stored content replaces fabricated message illustrations; template usage counts are omitted because the contract has none. Narrow screens use one column and a full-width overlay; status views scroll locally. Existing Meta identifiers remain supporting information on the full detail route.

### EV2-07A — Campaigns

Running/preparing/scheduled/paused communications now have operational cards with real audience-source summaries, frozen message text, server-backed inclusive sent/delivered/read counts and server rate definitions. A shared native Progress primitive exposes actual sent/eligible counts. Active cards load four initially with explicit expansion; history remains a focused DataTable, with All/Active/Scheduled/Paused/Completed/Drafts views and search. Statistics are requested only for visible snapshotted campaigns; unsnapshotted audiences are explicitly prepared at launch. Drafts never show fictitious totals. The detail route preserves existing controls/recipient export/reporting, adds frozen message context and groups supporting counts below four primary results.

Funding/template/subscription/manual/number pauses preserve existing recovery semantics. Funding links are billing-permission guarded. No switch-template action for a frozen running campaign. Failed statistics are explicit and retryable. No backend/schema/contract changes or wallet/state-machine changes.

Validation: web/UI lint and typecheck pass; 15 web and 51 UI unit tests pass (two new native progress boundary/accessibility cases); design lint passes; Docker production build passes (51 routes). Three targeted Chromium cases pass: existing create/review/launch/delivery/recipient/analytics flow, real scheduled/paused/completed/draft views with preserved recipient identities and four-width WCAG 2.2/overflow checks, and rare funding/template pause presentation. The latter uses explicitly documented read-only contract fixtures to exercise rare states without enabling real billing enforcement; domain funding/reservation behavior remains covered by the existing integration suite, to be rerun at the final checkpoint. Four screenshots were visually inspected and retained.

The browser checks caught and fixed invalid spaced tab IDs and an ambiguous duplicated empty-state action. A pause assertion was corrected to the existing domain rule: queued messages may finish after a pause, while the snapshotted recipient records remain intact. Reference metrics, universal audience names, fictional thumbnails and reply rates are omitted. Cards stack below desktop; history scrolls locally on narrow screens without page overflow. Final whole-repository regression results are recorded below.

### EV2-07B — Campaign Studio

Preserved the existing five-step builder and composed configuration beside a substantial WhatsApp preview and compact review summary. Explicit Save draft stays on the current step. Recipient personalization and eligibility/exclusions come from the server estimate after saving; unsaved changes clearly use template examples instead. Approved-template library navigation preselects only a version found in the existing phone-scoped approval service. Schedule/timezone conversion and launch validation remain server/domain-owned. Empty schedule time is safe and blocks continuation. Customer charge and available wallet funds retain their existing read models; no provider cost appears.

Unsaved links, browser Back and reload are protected; saved drafts exit freely. Confirmation cancellation restores focus, and discarding preserves the previously saved server draft. Pending operations block conflicting clicks/navigation. Save/estimate/launch failures retain inputs and offer explicit recovery. Launch retries reuse one idempotency key per saved revision, including a real successful launch whose response is intentionally lost. Canonical JSON comparison accounts for PostgreSQL JSONB property ordering when checking whether server previews match the saved configuration. No backend/schema/contract or Step 4 changes.

Validation: four targeted Chromium tests passed (existing create/review/launch/results, responsive Studio/server recipient samples/schedule conversion, unsaved navigation/reload/discard, and lost-response idempotent retry). Zero Axe WCAG 2.2 violations and no global overflow at 1440/1024/768/375. Four Studio screenshots were retained and visually inspected. Web lint/typecheck, 15 web unit tests and design lint pass; Docker production build passes (51 routes). Final whole-repository regression follows this increment.

## Commits

| Increment | Commit |
| --- | --- |
| EV2-05 Contacts | `68dfc43` |
| EV2-06 Templates | `cf93836` |
| EV2-07A Campaigns | `1d575fe` |
| EV2-07B Campaign Studio | `ae830c0` |
| Final validation/documentation | Recorded in the subsequent checkpoint commit. |

## Routes and shared components

Changed `/contacts`, `/contacts/:id`, `/templates`, `/templates/:id`, `/campaigns`, `/campaigns/new` and `/campaigns/:id`. Existing tabs, segments, imports, template versions and campaign analytics retain their routes. Reused the established shell, ListPage/DetailPage/BuilderPage, ModuleTabs, PageHeader, DataTable, Avatar, Button, StatusBadge, Tabs, Drawer, ConfirmDialog, Inputs, Textarea, EmptyState, ErrorState and skeletons. Shared DetailDrawer adds an optional contextual width and close callback without changing existing defaults. Shared TemplatePreview adds optional compact library rendering; existing Inbox preview behavior remains unchanged.

Added the shared native Progress primitive with meaningful finite-bound/accessibility unit tests. Added focused feature compositions TemplateMessage and CampaignResults, a shared signed template sample URL hook, the editor-scoped draft-protection hook and the opt-in navigation-intent helper. Command-search and workspace-switch/create adapters consult that helper only when an editor guard is active. Server estimates and existing field definitions drive Studio previews. No alternative shell, token set, generic dashboard or CRM was introduced.

## Backend changes and domain behavior

**No backend application-service, endpoint, contract, schema, migration, authentication, RBAC, RLS, worker or platform-operation changes.** The two existing Docker runtime installation lists receive the narrow reproduced Perl security patch documented below; no application entrypoint or business logic changes. Accepted Step 4 behavior is unchanged. Consent, eligibility, template lifecycle, campaign state machines, reservation/funding, subscription and entitlements remain authoritative in existing services. Tenant financial displays use customer charges/available wallet state; provider cost is not exposed. No production enforcement flags were changed.

Focused adapter safeguards improve existing retry/navigation correctness: already-created template drafts survive submission failures, and campaign launch retries keep their idempotency reference even when a successful server response is lost. Tests exercise the real domain endpoints and persisted state. The frontend never independently determines eligibility, pricing, variable resolution or recipient snapshot state.

## Responsive validation and deviations

At 1440/1024 desktop, contacts use calm comparison rows with contextual inspection, templates use a message library and campaigns give active communications stronger presence than history. Studio pairs configuration with a substantial preview. At 768/375, cards/configuration stack; context overlays use available width. Wide contact/history tables and status tabs have local scrolling; global overflow is prohibited and browser-asserted. Dialog names, labels, stepper semantics, statuses and focus restoration are verified.

Reference differences deliberately reflect available data: last incoming message replaces unsupported last-conversation metadata; unknown assignees are not given fictional names; template usage counts and campaign reply rates are omitted; current/frozen message content replaces fake illustrations. Campaign source summaries never fabricate segment/tag names. Unsaved Studio configuration uses clearly labelled template examples until the server has estimated the saved configuration. Real approved phone-scoped versions govern contextual template use. Accessible muted text stays at the accepted foundation token instead of the inaccessible screenshot value.

## Remaining and checkpoint boundary

This batch is prepared for **visual/product review**; approval is not inferred from automated tests. Later Experience V2 Automations, Analytics, Integrations, Billing and Settings compositions and aggregate Experience V2 closure remain pending review/authorization. `/platform` redesign, Phase 12, production Meta onboarding and commercial policy remain outside scope. No Phase 11 closure is executed or declared. Existing App Shell/Home/Inbox compositions remain established.

## Validation exception — dependency security

The normal CI production dependency audit reproduced one HIGH finding, `GHSA-68fv-2mgg-jv7q`, through Next → PostCSS → source-map-js 1.2.1. The [upstream advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) identifies 1.2.2 as the patched version. A narrowly scoped exact pnpm override pins affected source-map-js dependencies to **1.2.2**; no major/direct dependency or runtime policy is changed. The lockfile and production images are revalidated. The scoped dependency patches below are the only dependency/configuration exceptions to the frontend-only source scope; they change no product/domain service.

The first aggregate browser run passed 31 cases before Docker Desktop disconnected during the concurrent image build. The remaining failures originated from missing Docker/API access. The image build itself ended in a BuildKit RPC EOF. These interrupted runs are not reported as passing acceptance evidence. The final aggregate validation passed after the stack was healthy, with heavy build/browser/integration phases sequenced.

On the resumed 2026-10-07 run, the audit also reported `GHSA-wq5f-xc86-pv6w` through Next → Sharp 0.35.4. The [maintainer advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) specifies Sharp 0.35.5 with patched librsvg. An exact override upgrades only that patch release and its associated native binaries. Both dependency changes are isolated checkpoint security fixes, not product/domain changes.

## Accessibility

Final authenticated Lighthouse 12.8.2 accessibility scores are **100** for `/contacts`, `/templates`, `/campaigns`, `/campaigns/new` and `/campaigns/:id` (saved draft). Home and populated Inbox remain **100**. Final protected URLs were checked, avoiding false scores on login redirects. [Sanitized Batch 2 scores](experience-v2/evidence/batch-2/accessibility.json) and [foundation regression scores](experience-v2/evidence/batch-2/foundation-accessibility.json) contain no credentials or profiles. Four-width Axe WCAG 2.2 AA checks report zero violations and zero global overflow. Keyboard, labels, dialogs, drawer focus restoration, stepper and status semantics pass the full browser regression.

## Tests

Final browser command: `EV2_LIGHTHOUSE=true EV2_BATCH2_LIGHTHOUSE=true pnpm --filter @fenwira/web exec playwright test`: **95 passed, one existing opt-in visual-capture case skipped, 14.8 minutes**. Batch 2 has its own 24 deterministic responsive captures, so evidence is retained despite that pre-existing optional suite. No assertions were deleted or loosened for markup changes.

Final unit command: `pnpm test`: **297 passed** — API 130, web 15, UI 51, contracts 40, config 16, WhatsApp 33, database 3, queue 5, worker 4. The sandbox initially denied local mock-server listening; the permitted port-binding rerun passed all cases. Unchanged tasks may use Turbo unit/build results; integration tasks explicitly bypass cache. Existing Radix Tabs `act(...)` warnings are recorded without weakening assertions.

Repository lint, typecheck, formatting, design-token check and OpenAPI check pass. Dependency boundaries: **742 modules / 2573 dependencies**, zero violations. Frozen-lockfile installation passes and production dependency audit reports **no known vulnerabilities** after the two scoped security patches. Full Git-history secret scan reports no leaks; the final checkpoint commit is scanned separately.

## Build

Final `docker compose build` passes for API, worker, migrate, web and mock Meta. The last uncached frontend build includes TypeScript and **51 routes**, three successful tasks, **44.282s**. `docker compose up -d --wait --wait-timeout 180` passes: eight services healthy, migration and storage initialization jobs successfully exited. `pnpm smoke` passes API readiness, web/sign-in rendering and API → outbox → relay → queue → worker round trip. Native image conversion also passes inside the final web container: Sharp **0.35.5**, librsvg **2.63.2**, SVG → PNG → resized JPEG at the expected dimensions.

The host build remains a separate environment limitation: Turbopack/PostCSS cannot bind its processing port (`Operation not permitted`). The permitted retry reproduced the same restriction. No font, bundler or test setting was altered to hide it; production Docker build is the runnable evidence. This local-stack verification does not claim a new clean-volume/fresh-clone or remote GitHub Actions run.

Local API rollout flags remain **`BILLING_ENFORCED=false` and `BILLING_SUBSCRIPTIONS_ENFORCED=false`**. No rollout/configuration change enables them for real users.

## Visual evidence

[All 24 implementation captures and comparison notes](experience-v2/evidence/batch-2/README.md) are retained at 1440/1024/768/375. The final images were recaptured on **2026-10-07** against the rebuilt production stack, using synthetic fixtures and authoritative API data. Original references and accepted foundation evidence remain unchanged. Screenshots use the same calm light shell, warm canvas, white communication surfaces and accessible shared tokens. Transient logs, profiles, traces and raw audit payloads remain ignored; no root log files are created.

### Backend integration evidence

Final full integration run: **476 passed, two existing opt-in performance cases skipped** — database **251**, API **10**, worker **215**. Nine Turbo tasks successful, **11m37.086s**; integration tasks explicitly uncached. All **20 existing migrations**, post-migrate security setup and seeding succeeded in the new `fenwira_ev2_batch2_20261006_ui` database, with previously empty Redis DB **8**. No existing accepted database, wallet ledger or audit history was reset.

The reused server-dev image was verified against **341 unchanged backend/source/test/schema/SQL/contract files**, aggregate SHA-256 `478e2e79da35dc90c3a47420e3ae430f3d30f48f19468ab96ba98d942442c7cc`. The scoped dependency patches affect the frontend compiler/image pipeline, not those backend services. Functional integration covers 50k-row import, the 2,000-recipient campaign (**112.2 seconds**), template availability/consent pauses, reservations/funding recovery, duplicate dispatch/status updates, tenant RBAC/RLS/security matrices, API-key/public route restrictions, provider-cost confidentiality, platform MFA/session/concurrency/audit and accepted Steps 1–4 behavior. These timings are local diagnostics, not production SLAs. Existing test-server listener warnings are recorded without suppressing them or weakening assertions.

## Acceptance boundary

Contacts, Templates, Campaigns and Campaign Studio are implemented, tested and documented as separate increments. The accepted foundation is preserved. No unsupported commercial/product capability is added; no provider cost or secrets are exposed. Loading, empty, retry, permission and consequential launch/draft states have explicit browser coverage. Responsive evidence and sanitized accessibility results are retained separately from references. **Stop for visual/product review.** Later modules and Phase 11 closure remain outside this task.

### Runtime security exception

Normal CI Trivy scans reproduced **seven fixable HIGH/CRITICAL findings per production image**, all in Debian `perl-base` **5.36.0-7+deb12u3**, with zero detected secrets ([sanitized pre-patch evidence](experience-v2/evidence/batch-2/image-security-before.json)). A disposable apt probe confirms security candidate **5.36.0-7+deb12u4**; the [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2026-13221) confirms that Bookworm update is fixed. Both existing runtime installation lists now explicitly include `perl-base`, alongside their existing PCRE patch. No broad distribution upgrade, Node version change, application entrypoint or domain service change. Images are rebuilt/rescanned and post-patch startup/smoke/browser workflows checked. This is the only Dockerfile change in the batch and addresses a reproduced normal-CI security failure.

### Programmatic navigation regression

Final review reproduced unsaved campaign loss through command-palette selection: the direct router call navigated to Contacts without the editor confirmation. The focused browser regression failed at the missing dialog before implementation. A small opt-in navigation-intent helper now lets the active campaign editor protect command-palette selections, workspace changes and workspace creation alongside links, browser Back and reload. Workspace identity and tenant cache changes execute only after confirmation; cancellation retains the original workspace and draft. Existing synchronous navigation remains unchanged when no editor guard is active. No shell composition, menu structure or routing destinations are redesigned.

Editor focus restoration now remembers the connected editor element when the invoking command/dropdown item has unmounted. The regression covers command-palette cancellation, both workspace-menu paths, native reload/Back, harmless saved-draft exit and confirmed workspace switching while preserving the saved campaign in its original tenant. Shared adapter changes are confined to command-search, SessionProvider.switchTenant and the workspace-create menu handler; server RBAC/RLS and session authorization remain authoritative.

## Image security validation

All four final production images have **zero fixable HIGH/CRITICAL vulnerabilities and zero detected secrets** under the normal CI Trivy policy (`--ignore-unfixed`, vulnerability + secret scanners). [Sanitized image evidence](experience-v2/evidence/batch-2/image-security.json) records exact image hashes, counts and scan reuse explicitly. The three unchanged backend image hashes retain their successful post-Perl scans; the final rebuilt web image is rescanned after the navigation fix. Running API/web packages are verified at `perl-base` **5.36.0-7+deb12u4**. The [pre-patch evidence](experience-v2/evidence/batch-2/image-security-before.json) preserves the reproduced seven findings per image. Scanner caches/raw payloads are removed after sanitization.

Post-Perl validation: startup and smoke pass; **21 targeted browser tests pass (4.7 minutes)** across password/MFA/session flows, all Batch 2 responsive/state/estimate/launch routes, authenticated Lighthouse, actual platform funding/revocation and template submission/Inbox sending. After the additional reproduced navigation fix, **five focused regressions pass (38.2 seconds)**: unsaved command/workspace/Back/reload protection, command discovery, keyboard commands, all visible command destinations and normal cross-workspace cache isolation. Final full browser regression passed on that last application build and is recorded above. Backend integration source remains unchanged.
