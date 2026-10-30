# UX patterns (Design System v1)

How Fenwira screens are put together. Visual tokens are in [FENWIRA_DESIGN_SYSTEM.md](FENWIRA_DESIGN_SYSTEM.md); the baseline audit is [UI_AUDIT.md](UI_AUDIT.md).

## 1. Application shell

```text
┌──────────┬──────────────────────────────────────────────────────────────┐
│ Fenwira  │ Workspace ▾ · breadcrumb        [Search ⌘K]  ?  🔔  (Avatar) │ ← top bar 56px
│          ├──────────────────────────────────────────────────────────────┤
│ Home     │ Module tabs (only when the module has sub-pages)             │
│ Inbox  3 ├──────────────────────────────────────────────────────────────┤
│ Contacts │                                                              │
│ Campaigns│                    page (max 1280, gutter 16/24)             │
│ Templates│                                                              │
│ Automat. │                                                              │
│ ──────── │                                                              │
│ Integr.  │                                                              │
│ Settings │                                                              │
│ ──────── │                                                              │
│ ● WhatsApp connected                                                    │
│ ₹ Wallet ₹1,240 available                                               │
│ « Collapse                                                              │
└──────────┴──────────────────────────────────────────────────────────────┘
```

- **Sidebar** 232px expanded, 64px collapsed (remembered per browser), a drawer below 1024px. It lists **modules only** (except the approved Automations Workflows / Reply Studio children while that module is open): Home (route `/dashboard`), Inbox, Contacts, Campaigns, Templates, Automations, Analytics, then Integrations, Billing, Settings. A module appears once its phase has shipped (Analytics and Billing arrive in Phase 11) and only if the member may see it.
- **Module tabs** (`ModuleTabs`) under the top bar carry a module's sub-pages (Contacts → All contacts · Segments · Tags · Imports). They are links with `aria-current="page"`, not ARIA tabs.
- **Status footer**: the WhatsApp connection (`ConnectionState`, compact) and, when billing is enforced and the member can read billing, the available wallet balance. Both link to their settings; both turn into warnings (disconnected, low balance) without shouting.
- **Top bar**: workspace switcher, breadcrumb (section pages only; record pages such as a contact carry their own, more specific breadcrumb in the page header, so there is never a second trail), command/search (`⌘K` / `Ctrl K`), help menu (keyboard shortcuts; the component gallery in development), notifications, account menu.
- **Wallet** in the footer appears only when billing is enforced for the workspace. Its state comes from the billing domain (decisions P11-D1, P11-D12): the UI renders the backend's `NORMAL` / `LOW_BALANCE` / `INSUFFICIENT_FUNDS` / `NOT_ENFORCED` state from `GET /workspace/status` (every member; amounts only with `billing.read`) and never compares amounts itself. Wallet states use the `StatusBadge` presets `NORMAL` (Funded), `LOW_BALANCE`, `INSUFFICIENT_FUNDS` (No credits) and `NOT_ENFORCED` (Not billed).
- **Inbox** is full-bleed: it fills the viewport below the top bar with its own panes.

## 2. Page patterns (`packages/ui` → patterns)

| Pattern | Structure | Used by |
| --- | --- | --- |
| `ListPage` | `PageHeader` (title, one-line purpose, primary action) → optional attention banner → `DataTable` with toolbar (search, filters, column visibility, bulk actions) | Contacts, Segments, Tags, Imports, Templates, Campaigns, Automations, Team, Audit logs |
| `DetailPage` | Breadcrumb + `PageHeader` (name, status badge, actions) → optional status banner → summary strip → `Tabs` of sections | Contact, Template, Campaign, Automation history |
| `BuilderPage` | `PageHeader` with state (draft/published/saving) and the commit action → left palette · centre work area · right inspector → validation panel | Template editor, Campaign wizard, Flow builder |
| `SettingsPage` | `PageHeader` → stacked cards, each one setting group with its own save | Workspace, Security, Roles, WhatsApp |
| `DashboardLayout` | `PageHeader` → attention/current activity → recent conversations/automations → compact secondary metrics | Home |

The flow builder, template editor and campaign wizard keep their own layouts (they predate the pattern and embed tabs or steps around the work area) but follow the BuilderPage structure: header with state and commit action, palette · work area · inspector, validation beside the work.

Rules: one primary action per page header; secondary actions are `secondary`/`ghost` buttons or a "More" menu. Destructive actions live in menus or at the end, never as the primary button.

## 3. States

Every data region has all five states; the shared components render them consistently.

| State | Pattern |
| --- | --- |
| Loading | Skeletons shaped like the content (table rows, cards, metric values). No full-page spinners. Buttons show `loading` (spinner + `aria-busy`) during their own mutation. |
| Empty (first use) | `EmptyState`: what the feature does, why it helps, and **one** primary action. Filtered-empty says "No matches" and offers "Clear filters". |
| Error | `ErrorState` / `DataTable error`: what happened, what it affects, what to do (retry), plus a support reference. Never raw exception text. |
| Permission | `PermissionState`: which permission is missing and who can grant it. The navigation also hides what a role can't open. |
| Success | Toast for lightweight confirmation ("Tag added"); inline status change for longer operations. |

## 4. Feedback and notifications

- **Toasts** confirm a completed, low-stakes action. They never carry the only copy of an error that needs action.
- **Banners** (`Alert`, persistent until resolved) for ongoing conditions: WhatsApp disconnected, wallet empty/low, campaign paused, template rejected, integration failure. The dashboard's *Needs attention* list gathers them.
- **Notification center** (bell) for events addressed to the member (assignment, mention).

## 5. Confirmation

`useConfirm({ title, description, impact, confirmLabel, destructive })`. The dialog states the **expected impact** as a short list. Required for high-impact operations only:

| Operation | Impact shown |
| --- | --- |
| Launch or schedule a campaign | recipients, excluded count, template, when, estimated cost vs wallet |
| Cancel a running campaign | recipients not yet sent will be skipped; sent messages stay sent |
| Delete a template (Meta) / contact / segment / tag | what is deleted and what references it |
| Revoke an API key or session; remove a member | what stops working |
| Disconnect WhatsApp | sending and receiving stop; campaigns pause |
| Delete a workspace | 30-day recovery window |
| Cancel an automation run | stops now, doesn't resume |
| Financial adjustments (Phase 11) | amount and resulting balance |

Routine reversible actions (pause, resume, archive a draft, assign) are **not** confirmed.

## 6. Tables

Use `DataTable` for record collections; cards only for small sets of heterogeneous objects (connected numbers, setting groups). Toolbar order: search → filters → (right) column visibility → bulk actions appear when rows are selected ("3 selected · Tag · Delete"). Row actions live in a trailing "⋯" menu (`RowActions`). Sorting is by header button with `aria-sort`. Pagination is cursor-based under the table. Numeric columns are right-aligned with tabular figures.

Form grids (import column mapping and preview) are not record lists and may use `Table` directly.

## 7. Forms

Label above control, hint below, error below the hint (`Field`). Validate on blur and on submit, focus the first invalid field, keep the user's input. Required fields marked with `*` and "required" in the accessible name. Long forms are split into cards or wizard steps; each step saves its own progress where the backend supports drafts.

## 8. Drawers vs pages

A `DetailDrawer` (right side, 480px) is for lightweight inspection and quick edits without losing the list context (contact preview from the contacts list, a run from the history list). A full `DetailPage` is for deeper work (a contact's conversations, consent history, notes). A drawer always links to the full page.

## 9. Command palette

`⌘K` / `Ctrl K` from anywhere. Groups: **Go to** (every page the member can see, including module sub-pages), **Create** (new contact, campaign, template, automation — permission-aware), and record groups for **Contacts**, **Conversations**, **Campaigns**, **Templates** and **Automations**. Records come from the existing endpoints after 2 characters (debounced 200 ms): contacts and conversations and templates are searched on the server; campaigns and automations are filtered from their (small, cached) lists. Each group shows at most 5. No AI dependency. Keyboard: arrows, Enter, Escape. Implementation: `apps/web/lib/command-search.ts`.

## 10. Responsive behavior

| Width | Behavior |
| --- | --- |
| ≥ 1280 | Full layouts: view rail + list + thread + context inbox, builder palette + canvas + inspector |
| 1024–1279 | Sidebar collapsible; inbox customer pane becomes a toggle; builder inspector narrower |
| 768–1023 | Sidebar in a drawer; tables scroll horizontally inside their card; two-pane inbox |
| < 768 | Single column. Priorities: Inbox (one pane at a time), contact lookup, notifications, campaign status, dashboard summary. The flow builder shows the Outline view and history; the canvas asks for a larger screen. |

## 11. Module UX

**Inbox.** Desktop views rail plus conversation list, conversation, customer context (toggle below 1280). The 24-hour service window is always visible in the conversation header (open with time left; closed). Before it closes (< 1 hour) the composer warns; once closed the free-text box is replaced by "Send a template", so an invalid send is impossible. The composer shows attachments, canned replies (`/`), templates and send. Customer context (consent, eligibility, tags, notes) stays beside the conversation.

**Contacts.** Dense table with search, saved segments, filters, bulk tag/delete and a preview drawer. The contact page has tabs: Overview, Conversations, Campaigns, Activity, Consent, Notes. **Eligibility** (can we send marketing/utility/service now, and why not) is shown at the top of the profile and in the drawer.

**Templates.** Editor beside a live WhatsApp preview; validation beside the field; statuses Draft, Pending, Approved, Paused, Rejected, Disabled. A rejected template shows Meta's reason in the list, on the detail page and in the editor, with "Edit and resubmit".

**Campaigns.** Wizard: Audience → Template → Personalize → Schedule → Review, with a persistent summary (≥ 1280) of audience, template, schedule and estimate. Review shows audience size, eligible, excluded and reasons, template, schedule, estimated usage and wallet availability. Launch is the only primary action on Review and asks for confirmation with that impact.

**Automations.** Two ways into the same flow model: **starter recipes** (common SMB automations such as "Reply to a keyword", "Welcome new contacts", "Tag and assign") that create a ready draft, and the **advanced builder** (palette · canvas · inspector) with the keyboard **Outline**. There is one flow format and one runtime; recipes only produce a draft graph. Validation, version, draft/published state and history stay visible in the builder header.

**Dashboard.** Answers "what is happening, what needs me, what do I do next". *Needs attention* first (disconnected number, low wallet, unassigned conversations, failed messages, paused campaigns, rejected templates, failing automations), then recent conversations and campaign/automation activity, then compact secondary metrics. No decorative charts.

**Analytics (Phase 11).** Views: Overview, Messaging, Campaigns, Inbox, Automations, Usage (Usage needs `billing.read`). Each: date range (presets resolved in the workspace timezone, or custom workspace-local dates; kept for the browser session) → freshness/retention notices → KPIs (`MetricCard` with change vs the previous period) → one primary chart (`TrendChart`, with "Show as table") → breakdowns and detail tables (`DataTable`). "Not processed yet" (`NOT_STARTED`, "Analytics are being prepared"), "processing" and "couldn't be updated" are distinct from zero; a rate with nothing to divide by shows "—" and says why. Metric definitions: `docs/ANALYTICS.md`.

**Billing (Phase 11).** Wallet: available balance, reserved, usage, promotional credits, adjustments, transaction history from the ledger (never from analytics aggregates). Tenant Usage shows customer charges only (P11-D23). Provider cost is visible solely in explicitly authorized Platform Operations. Today the wallet balance appears in the shell and on the dashboard.

**Integrations and Settings.** `SettingsPage` cards; each card saves on its own; destructive settings (disconnect, delete workspace) sit in a separate "Danger zone" card with confirmation.

## 12. Accessibility

WCAG 2.2 AA. Keyboard operation for everything (the flow canvas has the Outline alternative); visible focus that is never hidden behind the sticky header (scroll padding); one `h1` per page and ordered headings; labelled forms with announced errors; dialogs trap focus and restore it; live regions for async status (save state, validation, toasts); reduced motion honored; status never by color alone; targets at least 24×24px.

## 13. UI quality gate

A feature is done when every applicable item holds. Reviewers check the list in the PR.

- [ ] Semantic design tokens only; no arbitrary colors or values (`pnpm lint:design`)
- [ ] Shared components and page patterns used; no duplicate component without a documented reason
- [ ] Responsive behavior verified at 375, 768, 1024 and 1440
- [ ] Keyboard operation verified (tab order, focus visible, Escape closes, no traps)
- [ ] Loading, empty (first-use and filtered), error and permission states
- [ ] Success feedback (toast or inline)
- [ ] Destructive or high-impact actions confirmed with their impact; routine ones not
- [ ] axe (WCAG 2.2 A/AA) passes on the new screens (`e2e/a11y.spec.ts` or the feature spec)
- [ ] Lighthouse accessibility ≥ 95 checked on new top-level pages
- [ ] Critical browser e2e passes

**Platform Operations (Phase 11 Step 5).** Separate `/platform` shell and privileged sign-in, search-driven workspace selection, contextual commercial summary and activity. Internal cost coverage is separate from customer charges. No customer conversations or general database editor. Financial actions require fresh MFA, review/confirmation and immutable receipts.

## Home reconstruction checkpoint

The reference-driven Home variant of `DashboardLayout` uses separate attention/update and communication/campaign-summary bands (70:30 and approximately 44:56 above 1280px), then horizontal real automation summaries. Recent conversation previews show the latest four records, with full history in Inbox. The summary retains the actual seven-day analytics period; campaign progress uses the existing cumulative `sent` counter and actual total. An unlaunched campaign has no progress. Current update times are not an event history. The approved Home density refinement uses 224px navigation, 36px nav rows, 18px nav icons, 56px topbar and a centered desktop search; 1024px keeps a narrower search and smaller spacer. The welcome heading is 24/32, section headings 16/24, body 14/20 and semantic icon containers 32px. Home surface content padding is 16px, band gaps remain 16px and desktop gutters remain 24px. Other modules retain their existing geometry. The reconstructed Home direction is approved; stop for visual review of its scale refinement before propagation.

## Inbox reconstruction checkpoint

Home's final density is now visually approved and canonical. Inbox reuses that exact shell presentation; Home remains unchanged. At 1440, calm 176px views sit beside a 320px conversation list, the largest flexible thread and 256px customer context. Existing filters and assignment semantics stay intact; no invented view totals or team queues. Names/preview/unread lead each 32px avatar row. Assignment and real service-window state use compact secondary metadata. The warm thread differentiates white incoming, emerald outgoing and labelled private notes, with fractional bubble widths and existing same-sender grouping. The integrated two-line composer keeps Reply/Internal note, template, attachment and canned-reply actions; note mode uses its warm private treatment. No emoji picker exists.

At 1024, context becomes the existing accessible drawer and the list narrows; at 768, views move into list controls; mobile keeps sequential list/thread/back and context details. Long lists scroll locally with paint containment; they must not add a second page scrollbar. Normal body text remains 14px; mobile composer targets are 40px. Every region retains loading/error/empty/permission states, existing locks, pending-send draft protection, real-time/offline recovery and server eligibility. Stop for Inbox visual review before later modules.

## Inbox final fidelity checkpoint

The Inbox reconstruction is not visually approved. Preserve the Home shell and four-pane widths; refine only Inbox density and message character. Two-line conversation rows use 36px deterministic avatars, with operational metadata in accessible details/selected context rather than mandatory extra lines. Consolidate quiet window/tag/takeover context below the compact primary identity/actions. Reply/note writing rests at one line, grows to 160px and then scrolls; modes and toolbar remain explicit and mobile controls 40px. The original low-opacity SVG texture is decorative only. Outgoing message contrast uses the refined outbound-only semantic token. Identity/assignment/tags lead the context pane; centralized server eligibility and consent remain fully accessible through a native keyboard disclosure with exceptional service restrictions visible. Contact module presentation is unchanged. Exact measurements, two screenshot cycles and checks: [final-fidelity report](EXPERIENCE_V2_INBOX_FINAL_FIDELITY.md). Stop for visual review.

## Inbox views moved into list heading

The user subsequently requested removal of the separate 176px contextual Inbox rail. Its existing six filters now use an icon menu beside the current list heading at all widths, preserving queries and selected-state/keyboard semantics. List/context widths are unchanged; the 1440 thread grows from 424px to 608px using the reclaimed rail/gutter space. This focused refinement supersedes the earlier four-pane recommendation; Home and its shell stay unchanged. [Review evidence and verification](experience-v2/evidence/inbox-view-menu/README.md). Stop for visual review.

The user subsequently authorized a header chevron to hide/show the right customer-details panel. Desktop retains the panel by default and lets the thread use its freed width when collapsed. Smaller screens retain the existing details drawer, with keyboard closure/focus return and a clean switch back to the inline panel on resize. Labels and expanded state explain the arrow; draft and permission behavior stay intact. [Toggle review evidence](experience-v2/evidence/inbox-contact-toggle/README.md).

## Contacts reconstruction checkpoint

Home and Inbox are now visually approved by the user. Contacts follows their exact shell/identity language with reference-specific composition: header, contextual navigation, compact filters and human directory rows on one white surface. Selected contacts have an inline 288px desktop context and an accessible drawer below 1280px; mobile uses contact cards. Normal rows target 52–60px, allowing legitimate tag wrapping to increase height. Context prioritizes identity, contact information, tags, server WhatsApp relationship, owner and actual activity; full eligibility/consent remains in a keyboard disclosure. Bulk selection stays separate from the current inspected contact. Do not invent screenshot capabilities or fields. [Contacts evidence](experience-v2/evidence/contacts-reconstruction/README.md) requires visual review before later modules.

## Templates reconstruction checkpoint

Templates reuses the approved 224px navigation/56px topbar only at its library route. A compact message library follows status tabs and existing server-backed search/category/language/status filters. Selected cards open a 320px inline context above 1280px; below that, one accessible drawer preserves keyboard focus/closure and mobile reading. Category/language/status and actual message content precede update/preview metadata. Lifecycle edits/submit/delete remain on the existing full record page; approved-version availability gates sending links. No concept-only sync time, usage count or variable label is synthesized. [Review evidence](experience-v2/evidence/templates-reconstruction/README.md); stop for visual approval before Campaigns.

## Experience V2 Campaigns / Create Campaign reconstruction checkpoint

Reuse the approved 224px navigation and 56px header for Campaign routes. Operations uses compact loaded-record views/filters and active/scheduled communication cards above one history surface. Counts and filters reflect the collection actually loaded; unavailable artwork, audience names or attributed replies must not be fabricated. Keep fund/template pause recovery explicit.

Create Campaign keeps the five saved steps in connected navigation, one coherent configuration surface and a recipient preview at desktop (3:2 from xl), stacked below configuration at smaller widths. Use 12px configuration/preview interiors and 16px operational cards. Put the existing save/back/exit/launch controls in a separate footer; preserve confirmation, busy state and unsaved-draft protection. The Studio-only compact phone option reduces wallpaper space without clipping message content; Templates keeps its approved default. Preview recipient data must come from a matching saved server estimate, with stored examples otherwise. History and step navigation can scroll locally; the page must not overflow.

[Validation and screenshots](experience-v2/evidence/campaigns-reconstruction/README.md). Ready for visual review, not authorization to propagate to Automations.

### Populated Campaigns fidelity refinement

Campaign thumbnails can reuse the existing frozen template IMAGE sample via its tenant-scoped signed URL and `templates.read` gate. Use the semantic campaign icon while a sample is missing, unavailable or fails to load. The short description is actual frozen message text, not an invented campaign metadata field. Resolve friendly tag/segment labels only from the permission-gated catalogs; fall back to the saved source label if unavailable. Current catalog names do not alter recipient snapshots.

Show progress above Delivered/Read/Started on running cards, with primary-strong View campaign navigation. Feature two cards first, retaining Show more and explicit paused recovery. History follows Campaign/Audience/Status/Sent/Delivered/Read/Date/actions with five-row local pagination over the loaded collection. Row menus expose supported navigation; omit nonfunctional selection and unsupported Replies. Mobile artwork shrinks to 96 × 64px without reducing touch controls. [Populated review evidence](experience-v2/evidence/campaigns-final-fidelity/README.md).

### API-driven Campaigns visual checkpoint

Category, saved audience and frozen recipient count share one wrapping card metadata line; full campaign identity and actual template content lead the card. Scheduled cards use View schedule to the existing detail route. History and active cards are separate reusable presentation components over the existing tenant-scoped queries. Campaign statuses use the default `StatusBadge` mapping (RUNNING is info, like every module). Friendly list errors show retry without backend diagnostics. The layout must handle long names/audiences, absent snapshots and the API's full loaded collection, with local table overflow only. [Current evidence](experience-v2/evidence/campaigns-data-driven/README.md); stop for Campaigns visual review.

## Automations reconstruction checkpoint

Campaigns was visually approved on 8 October 2026, authorizing Automations next. The optional BuilderPage studio appearance joins a searchable step library, light dotted canvas and contextual settings. White icon-led nodes use semantic category accents and explicit branch labels; browser node measurements are retained locally for the minimap, never persisted in the graph. The existing Outline remains the initial phone view, and settings below 1280px use a focus-trapped modal with explicit focus return. Autosave/If-Match, validation, published versions, history, replay and every existing node form remain authoritative. Save flushes the same adapter; Publish confirms impact. Header counters are actual total/running counts. Message/template previews preserve expression markers, with no fabricated customer values. No wait-for-reply, customer-replied condition, simulator or daily execution metrics are added. [Reference decomposition and checkpoint](EXPERIENCE_V2_AUTOMATIONS_RECONSTRUCTION.md). Stop for Automations visual review before Analytics.

## Analytics reconstruction checkpoint

Automations and its phone preview were approved, authorizing Analytics next. AnalyticsFrame now owns its permission-filtered module links below its heading, a contextual date control and the retained workspace-local range/freshness notices. Joined MetricCard strips use the optional Analytics appearance; default/Home presentations remain unchanged. Overview places the daily chart beside actual delivery/read indicators and inbound counts, then campaign, team-response and automation summaries. Supplemental messaging/inbox queries retain independent loading/error/freshness states. See [Analytics reconstruction](EXPERIENCE_V2_ANALYTICS_RECONSTRUCTION.md). Stop for Analytics visual review.

## Integrations reconstruction checkpoint

After Analytics approval, `/integrations` presents a supported overview: actual WhatsApp connection summaries, paired API/Webhooks entry cards and a configured endpoint table. Existing management routes/forms remain authoritative. Overview is permission-filtered; disabled queries must not appear as loading. Meta webhook subscription and outbound endpoint configuration are distinct from delivery health. Query parameters are omitted from overview destinations; secrets remain in their existing one-time management dialogs. No native third-party connector grid or invented request/delivery metrics. [Mapping and review](EXPERIENCE_V2_INTEGRATIONS_RECONSTRUCTION.md). Stop for visual review before Billing/Settings.

### Compact module density — 8 October 2026

The user requested smaller Templates, Campaigns, Automations, Analytics and Integrations. These modules use 20px page headings, 13px descriptions, compact summary icons/artwork and tighter vertical padding. Analytics joined metrics use 20px values and 32px icon surfaces. Charts measure container width, keeping SVG labels and explicit chart height stable as a panel widens instead of magnifying the entire graph. Automation canvas height is 480px/544px at desktop breakpoints; its outline and side inspectors remain available. Long lists/content may scroll; do not shrink body text or apply CSS zoom/scale to force all data into one viewport. Existing mobile touch controls and keyboard/focus behavior remain.

The native application grid contains the four requested providers with real configuration/connection state, short setup dialogs and explicit export/disconnect impact. OAuth apps awaiting operator configuration are disabled with a setup explanation. Secrets never become decorative connection-card content.

## Billing wallet reconstruction checkpoint

The next checkpoint follows reference 10 using a compact available-balance and ledger column, read-only current subscription context and configured manual-funding support. `/billing/wallet` owns its Billing heading and contextual page links under the approved 224px shell. Effective features come from the entitlement response; ledger promotional identity does not imply independently available fund buckets. Unsupported forecasts, sample prices and tax/payment controls stay absent. The Usage alias reaches the existing customer-charge analytics view. [Mapping and validation](EXPERIENCE_V2_BILLING_RECONSTRUCTION.md). Stop for visual review before Settings.


## Automation dashboard reference refinement

The user-supplied Workflows and Reply Studio dashboard images authorize nested Workflows /
Reply Studio links within the active Automations sidebar. Workflows owns its library tabs;
Reply Studio owns Auto Replies / Bot Flows links and Reports in the header. This exception is
scoped to Automations. Cards, dense reply rows, real graph snippets and the compact summaries
follow the existing design tokens. See FENWIRA_DESIGN_SYSTEM.md → Automation dashboard image
references. The existing builder, reporting routes, permissions and send eligibility are retained.

The Automations sidebar row has a separate disclosure arrow. It opens or closes Workflows and
Reply Studio without navigating, supports Enter/Space and exposes `aria-expanded`. The module
label still opens Workflows. The disclosure also works in the mobile navigation drawer; the
icon-only collapsed desktop sidebar retains its module link.


## Approved three-panel Inbox reference (2026-10-30)

The user's approved inbox reference supersedes the older Inbox shell/density checkpoints:
original application navigation, 320px conversation list and 320px customer context at 1440px;
compact 56px global header, flexible warm thread, 76px minimum conversation rows and one docked
rectangular composer. The latest user correction preserves the original sidebar and topbar.
Scope the new palette inside Inbox so navigation retains its original presentation. Customer details
use the existing accessible drawer below 1280px, while mobile
keeps sequential list/chat/details navigation. All/Mine/Unassigned use server counts; message
filters open on demand. See the design-system section for tokens and supported capabilities.

### Conversation-list refinement

The latest inbox refinement replaces the underline view tabs with a compact neutral segmented
selector and moves Agent takeover beside search in an advanced-filter menu. An active takeover
chip is removable; view/status/unread/search combinations retain their original server semantics.
Rows use 36px stable identity avatars, one-line previews, a right timestamp/count column and
rounded mint selection with a short emerald inset indicator. Focusing a row shows its full name
and context without opening or marking it read. Keep controls fixed above the scrolling list.

Existing thread caches can enrich matching latest-message summaries without extra requests;
unavailable direction, rendered template text, delivery status and photos remain unavailable.
Do not manufacture values from identifiers. Below 1280px, details now use the accessible drawer
instead of reopening a narrow docked panel. Compact system events preserve every history entry;
the amber closed-window notice retains the existing eligibility and Choose template action.

### Centre-panel reply-window refinement

Keep the sole centre-panel countdown next to Reply/Internal note in the composer. The header
strip describes automation only. Use muted, amber and imminent badge treatments at the 60/15
minute thresholds, with one short imminent-expiry explanation and a compact closed-window
template notice afterward. Never display a countdown or customer restriction in note mode.
Unknown eligibility disables customer sends; actual server restrictions and rejected sends retain
their explanations and drafts. Recheck on focus, reconnect, inbound updates and expiry without
announcing every minute. The expiry tooltip follows the workspace timezone.

Use one compact composer surface (approximately 112–136px empty), a 44–160px input and one
bottom toolbar. Keep attachment and saved-reply icons accessible through labels/tooltips,
Templates visibly labelled, and Send compact. Put shortcut guidance in the Send tooltip instead
of a footer. Notes keep the amber surface and Add note action. Notices and text scaling can grow
the composer. While customer details are open, remove the header's open-panel control and its
space. The details collapse control restores the header trigger and focus after it mounts;
keyboard opening moves focus into the panel without stealing focus on initial page load.
System events have small contextual icons and no outlined pills; attachment cards reduce padding
without changing file permissions, receipts or history grouping. The original application shell,
conversation list and customer-panel presentation retain the preceding refinements.

### Customer-panel refinement

The right context panel now uses a compact profile, sticky 36px tabs and independent scrolling.
Keep its 320px dock, original collapse/reopen focus and accessible mobile drawer. Reuse the same
avatar identity as the conversation list, including generated numbered names. Copy phone reports
accessible feedback; Edit and missing-field actions reuse the existing validated contact editor.

Overview orders assignment, tags, label/value contact fields, contact notes, eligibility and
automation. Use wrapping semantic tags, readable stored country names and compact amber note
previews that expand to full content. The notes count remains complete even when only the first
three cards are initially shown. Read-only roles get values and quiet missing-field dashes.
Eligibility and automation start collapsed with truthful summaries and recorded details. Keep the
sole countdown, template action and primary Resume action in the centre panel.

Activity shows recorded assignment, tags, contact notes and automation events newest first.
Page its two existing data sources independently from the chat, revealing older events only when
both cursors cover that time range. Files preserve authorized links, existing type filters and
Jump to message. Tabs, closing/reopening and delayed responses from another customer must keep
drafts, thread scroll and contact/workspace cache isolation intact. Loading, empty and retry states
stay local to the affected section. Unsupported photos, note edit/delete and flow context remain
absent. Evidence: `experience-v2/evidence/inbox-customer-refinement/`.
