# UI audit (2026-09-27)

Baseline: branch `phase-10-automation` (3018856), before Design System v1. Scope: `apps/web` (28 app pages, 70 feature components) and `packages/ui` (29 components). Method: source inventory with scripted greps (counts below are reproducible), a read of every shell and module entry point, and the existing axe e2e results.

**Accepted 2026-09-28** (decision DS-v1). The partly fixed and kept items below are normal backlog (`PRODUCT.md` → Product backlog), not a reopened milestone. The form-control border treatment is accepted for v1 while labelled controls and a compliant focus indicator stay enforced.

Each finding has an ID; `FENWIRA_DESIGN_SYSTEM.md` and the completion report refer to them. Status after v1 (branch `ui-design-system-v1`): ✅ fixed, 🔸 partly, ⏭ deferred or kept (with the reason).

## 1. Foundation already in good shape

- Tokens are the only color source. Tailwind's default palette, type scale, radii and shadows are reset in `packages/ui/src/styles/theme.css`, and `pnpm lint:design` fails on raw colors and arbitrary values. **No arbitrary colors were found in feature code.**
- `StatusBadge` is a single status → tone/label/icon map (`STATUS_PRESETS`).
- `DataTable` already supports sorting, selection, cursor pagination and loading/empty/error states.
- `EmptyState`, `ErrorState`, `Skeleton`, `ConfirmDialog` (`useConfirm`), `CommandPalette`, `Drawer`, `Tabs`, `PageHeader`, `KpiCard` exist and are used by most pages.
- No full-page spinners anywhere (0 `animate-spin` / `Loader2` in feature code); loading is skeleton-based.
- `prefers-reduced-motion` is already honored globally.

## 2. Existing reusable components (`packages/ui`)

Alert, Avatar, Badge, Breadcrumb, Button, Card, Checkbox/Radio/Switch, CommandPalette, ConfirmDialog, DataTable, Dropdown, Field/Label, Input/Textarea, KpiCard, Modal/Drawer, PageHeader, Pagination, Select, Skeleton, EmptyState/ErrorState, StatusBadge, Table, Tabs, Toast, Tooltip.

Missing from the v1 brief: **FilterBar, SearchInput, MetricCard (named), DetailDrawer, Timeline, PermissionState, ConnectionState**, and the page patterns **ListPage, DetailPage, BuilderPage, SettingsPage, DashboardLayout**.

## 3. Duplicated or feature-local implementations

| ID | Finding | Status |
| --- | --- | --- |
| D1 | `NoAccess` (permission state) lives in `apps/web/components/settings/no-access.tsx` and is imported by 20 pages; belongs in `packages/ui` as `PermissionState`. | ✅ |
| D2 | Two step timelines: `components/automation/execution-timeline.tsx` and the contact activity list in `contacts/[id]`. | ✅ shared `Timeline` |
| D3 | Three search boxes with their own markup (contacts list, inbox list, shell "Search" button). | ✅ `SearchInput` |
| D4 | Filter rows are hand-built per page (contacts, templates, campaign recipients, audit logs). | 🔸 `FilterBar` on contacts and templates; campaign recipients and audit logs keep their single select (follow-up) |
| D5 | WhatsApp connection status is rendered separately by `connection-card.tsx`, the dashboard (static) and the inbox header. | 🔸 `ConnectionState` in the sidebar footer and dashboard; the detailed `connection-card.tsx` (quality, tier, token, webhook) stays as the settings view |
| D6 | `KpiCard` vs the brief's "MetricCard": one component, two names in docs. | ✅ renamed `MetricCard` (`KpiCard` kept as alias for one release) |
| D7 | `segmented.tsx` (inbox) re-implements a tab-like toggle. | ⏭ kept: it's a filter toggle inside the list pane, not navigation; documented in UX_PATTERNS |

## 4. Colors

| ID | Finding | Status |
| --- | --- | --- |
| C1 | Danger is `#EF4444` and info `#6366F1`; the v1 brief specifies `#DC2626` and `#2563EB`. | ✅ |
| C2 | No token for secondary text (`#475569`) or strong borders (`#CBD5E1`); secondary text uses `muted` everywhere. | ✅ |
| C3 | Fenwira primary and WhatsApp green share no explicit distinction in token names (`success` doubles as "WhatsApp"). | ✅ `whatsapp` token + rule |
| C4 | No AA-safe text shades for success and warning (`#25D366` 1.98:1, `#F59E0B` 2.15:1); badge text falls back to `slate`, which is correct but undocumented as a rule. | ✅ `success-strong`, `warning-strong` |
| C5 | Status tone `primary` (Sent, Running, Open) is outside the five semantic status categories. | ✅ mapped to info/neutral |
| C6 | `DISCONNECTED` renders neutral; the brief classes disconnected as danger. | ✅ |

## 5. Spacing, typography, shape, elevation

| ID | Finding | Status |
| --- | --- | --- |
| T1 | Body line height 22px and small 20px; brief: 14/20 and 13/18. | ✅ |
| T2 | Section headings mix `text-md` (16) and `text-lg` (18) for the same role (dashboard, team, campaign detail, automation history). | ✅ `SectionHeader` |
| T3 | Auth/onboarding brand mark uses `text-xl` (20) ad hoc. | ✅ `BrandMark` |
| S1 | Spacing was mostly on scale (page 24, cards 20) but undocumented; panels varied between 12 and 16, and page sections between 16 and 24. | ✅ documented in FENWIRA_DESIGN_SYSTEM → Spacing; page patterns fix section spacing at 24 |
| R1 | Dead classes: `shadow-sm` ×3, `shadow-md` ×1, `rounded-xl` ×1 generate nothing because those tokens are reset (template preview bubble, inbox segmented control, composer popover, flow canvas node). | ✅ replaced with borders / `shadow-overlay` / `rounded-xl` token |
| R2 | Dialog radius equals card radius (12); brief: dialogs 12–16. | ✅ dialogs `rounded-xl` (16) |

## 6. Status treatments

| ID | Finding | Status |
| --- | --- | --- |
| ST1 | 23 direct `<Badge tone=…>` uses; consent (`CONSENT_TONE`), tags and service window pick tones in feature code. Tags are user-chosen colors (legitimate); consent and window are statuses. | ✅ consent + window via `StatusBadge` presets; tags stay `Badge` |
| ST2 | Service window shown as a small badge only; the composer explains it once closed. | ✅ `WINDOW_OPEN`/`WINDOW_CLOSED` status with time left in the header, a composer warning in the last hour, and the eligibility summary in the customer pane |

## 7. Tables

| ID | Finding | Status |
| --- | --- | --- |
| TB1 | 7 of 13 `DataTable` pages don't pass `error`, so a failed load shows an empty state ("No campaigns yet") — misleading. Templates, template detail, automations, history, campaigns, campaign detail, campaign analytics. | ✅ |
| TB2 | No column visibility, bulk-action bar or row-action menu primitives; contacts builds its bulk bar by hand. | ✅ `DataTable` toolbar, `columnVisibility`, `bulkActions`, `RowActions` |
| TB3 | Three raw `<table>` elements (consent history, import mapping, import preview). Mapping/preview are form grids, not record lists. | 🔸 consent history → `DataTable`; import grids kept (documented) |

## 8. Missing states

| ID | Finding | Status |
| --- | --- | --- |
| M1 | Dashboard, integrations, settings index, security and WhatsApp settings have no permission, loading or error handling of their own. | ✅ via patterns |
| M2 | Ad-hoc empty text instead of `EmptyState`: canned replies, contact fields, template picker, timeline, campaign tag step. | 🔸 canned replies, contact fields, notes and timeline fixed; the template picker and campaign tag step keep inline hints (they sit inside a dialog/step) |
| M3 | Empty states explain *what*, rarely *why* and *what next*; most have no primary action. | ✅ copy + actions per UX_PATTERNS |

## 9. Accessibility

| ID | Finding | Status |
| --- | --- | --- |
| A1 | axe runs WCAG 2.1 A/AA only; the target is 2.2 AA. | ✅ `wcag22aa` added |
| A2 | Sticky header can obscure focused elements when scrolling by keyboard (WCAG 2.2 2.4.11). | ✅ `scroll-padding-top` |
| A3 | Some icon buttons are 32px (`size-8`) — meets 2.5.8 (24px) but inconsistent. | ⏭ kept: all targets meet 2.5.8; 32px is used for dense row actions by design |
| A4 | Campaign launch (high impact) has no confirmation; the rest of the destructive set is confirmed. | ✅ |

## 10. Module-specific UX problems

| ID | Module | Finding | Status |
| --- | --- | --- | --- |
| U1 | Shell | Sidebar expands every module into child links (the brief: top-level only, sub-navigation inside modules). | ✅ `ModuleTabs` |
| U2 | Shell | No WhatsApp/wallet status; no help entry; workspace switcher only in the sidebar. | ✅ |
| U3 | Dashboard | System-health page; the "No WhatsApp number connected" card is static (shown even when connected). No attention list. | ✅ rebuilt |
| U4 | Inbox | Window state is a small badge; the composer only explains after it closes; no warning before it closes. | ✅ |
| U5 | Contacts | No quick inspection from the list (every look is a page navigation); eligibility is split across consent badges. | ✅ `DetailDrawer` preview + eligibility summary |
| U6 | Templates | Rejection reason only on the detail page's alert and versions table; not in the list. | ✅ |
| U7 | Campaigns | Wizard step "Variables" vs brief "Personalize"; no persistent summary; launch unconfirmed (A4). | ✅ |
| U8 | Automations | Only the advanced canvas/outline; no simple path for common SMB automations. | ✅ starter recipes (same flow model) |
| U9 | Command palette | Navigation only; no records or create actions. | ✅ |
| U10 | Analytics, Billing | Not shipped (Phase 11); only campaign analytics exists. | ⏭ Phase 11 (patterns documented; wallet surfaced in shell/dashboard) |

## Phase 11 Step 5 — Platform Operations (2026-10-05)

Separate protected platform shell follows Design System v1 with search-driven workspace selection, contextual commercial summary, activity timeline and narrowly scoped actions. Shared primitives provide labels, status text, confirmation dialogs, focus handling and read-only details; ordinary tenant navigation has no platform entry.

Quality gate evidence: lint/design tokens and typecheck pass; seven platform browser tests pass, including permission variants, keyboard cancellation, retry/receipt details, real MFA and grant revocation. axe covers login/MFA, workspace detail and audit; real commercial views visually reviewed at 375/768/1024/1440 pixels. No page overflow; wide tables expose labelled focusable scroll regions. Trial is labelled explicitly. Loading/empty/error states and read-only access are covered by platform tests. Lighthouse accessibility is 100 on all five platform routes, with protected final URLs verified ([sanitized results](../plans/STEP5_ACCESSIBILITY.json)). Step 5 is accepted by the closure-verification request; Phase 11 closure is separate.

## Phase 11 closure verification

Closure verification adds responsive WCAG 2.2 AA checks for Wallet, Subscription, six Analytics views, API keys and Webhooks. Reproduced defects are fixed in shared components: commercial table scroll regions are keyboard-focusable with visible focus, and Analytics loading uses named status semantics. The controlled-response loading regression audits the pending state. The final full browser suite passes 72 tests (one existing optional visual-capture skip); all 15 authenticated Lighthouse routes score 100. Trial-warning/expired/cancelled banner fixtures pass keyboard and WCAG checks at mobile/laptop widths. Final counts and Lighthouse evidence are recorded in [closure evidence](../plans/PHASE_11_CLOSURE.md).

## Experience V2 — App Shell / Home / Inbox checkpoint (2026-10-06)

Audited all eleven approved references and current routes, contracts and permissions before implementation. The shared foundation now has light customer navigation, warm surfaces and accessible emerald/text/focus tokens. Home is attention first with actual communication/campaign/flow activity and secondary metrics. Inbox adds supported views, avatar rows, grouped messages, real actions and responsive context. Historical U10 above is superseded by the shipped Phase 11 commercial routes; their behavior and platform isolation are preserved.

Four-width axe and no-overflow checks pass; Home and populated Inbox score 100 in Lighthouse with protected final URLs verified. Explicit regression coverage checks real sends/notes, pending-response draft protection, messages missed offline, read-only membership and drawer focus restoration. Full checkpoint results, deliberate reference differences and remaining modules are in the [checkpoint report](EXPERIENCE_V2_CHECKPOINT.md); eight inspected screenshots and sanitized accessibility results are in [visual evidence](experience-v2/evidence/README.md).

**Visual acceptance is pending user review.** This checkpoint stops before Contacts/Templates/Campaigns compositions and does not declare all Experience V2 or Phase 11 complete.

## Experience V2 — Batch 2 review checkpoint

The user approved the foundation and authorized Contacts/Templates/Campaigns/Studio. People-led contact rows and contextual inspection, a reusable message library, active communications ahead of campaign history and paired Studio configuration/preview now use the established shared foundation. Existing read models and services remain authoritative; backend, tenant isolation and accepted commercial behavior are unchanged. Retry, contextual permissions, unsaved navigation, responsive and accessibility evidence are recorded in the [Batch 2 checkpoint](EXPERIENCE_V2_BATCH_2.md). The [24 screenshots](experience-v2/evidence/batch-2/README.md) are separate from approved references. **Batch 2 visual acceptance is pending user review.** Later module compositions remain outside this checkpoint.

## Foundation visual-fidelity correction — 2026-10-07

The user identified flat, overly uniform visual treatments and authorized a focused App Shell/Home/Inbox polish pass. Preserve the established page compositions and domain behavior. New semantic communication surfaces and opt-in avatar/timeline/message-status appearances restore purposeful color and hierarchy; other module defaults stay unchanged. The [correction report](EXPERIENCE_V2_VISUAL_FIDELITY.md) records the reference comparison, validation and separate before/after review evidence. **Visual approval remains pending; stop after this correction.**
