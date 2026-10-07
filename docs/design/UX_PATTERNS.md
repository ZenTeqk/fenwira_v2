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

- **Sidebar** 232px expanded, 64px collapsed (remembered per browser), a drawer below 1024px. It lists **modules only**: Home (route `/dashboard`), Inbox, Contacts, Campaigns, Templates, Automations, Analytics, then Integrations, Billing, Settings. A module appears once its phase has shipped (Analytics and Billing arrive in Phase 11) and only if the member may see it.
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
