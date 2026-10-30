# Fenwira Design System v1

**Status:** adopted 2026-09-27; visual foundation evolved by approved [Experience V2](FENWIRA_EXPERIENCE_V2.md), 2026-10-06. Supersedes the Phase 2 contract in `docs/DESIGN_SYSTEM.md` (now a pointer here). Companion docs: [UX_PATTERNS.md](UX_PATTERNS.md) (page patterns, module UX, quality gate) and [UI_AUDIT.md](UI_AUDIT.md) (the baseline this version fixes).

Fenwira is a WhatsApp operations workspace that people keep open all day. The interface is **calm, dense, fast and trustworthy**: restrained surfaces, strong hierarchy, obvious system status, and no decoration that competes with the work. No gradients, glassmorphism, oversized cards, heavy shadows or marketing-sized headings inside the app.

This is a contract. Tokens live in `packages/ui` and are the only source of color, type, radius and elevation. Feature code uses semantic utilities (`bg-primary-strong`, `text-secondary`, `border-border`) and shared components. No dark mode in v2 (decision DS1); because everything is tokenized, a second token set can add it later.

## 1. Color

### Brand and neutrals

| Token                       | Hex                   | Role                                                                                                     |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `primary`                   | `#00A884`             | Fenwira action accent: active-nav indicator, focus ring, selection, checkbox/switch fill. **Non-text.**  |
| `primary-hover`             | `#008F70`             | Hover of `primary` fills                                                                                 |
| `primary-soft`              | `#EAF7F2`             | Selected rows, variable chips                                                                            |
| `primary-strong` / `-hover` | `#007F64` / `#006B54` | **Filled primary buttons** (white text) and primary-colored text/links                                   |
| `whatsapp`                  | `#25D366`             | WhatsApp channel identity only (the WhatsApp preview frame, "on WhatsApp" marks). Never an action color. |
| `slate`                     | `#18201D`             | Primary text (compatibility token name)                                                                  |
| `slate-800`                 | `#1E293B`             | Dark surface compatibility; text on `neutral-soft` table headers                                         |
| `secondary`                 | `#4B5550`             | Secondary text: descriptions, labels in dense rows, metadata that must stay readable                     |
| `muted`                     | `#66716B`             | De-emphasized text: timestamps, hints, placeholders. AA-safe on all warm neutrals.                       |
| `slate-400`                 | `#94A3B8`             | Idle icons, disabled glyphs, sidebar text on `slate`, idle flow edges                                    |
| `background`                | `#F7F7F4`             | Application canvas                                                                                       |
| `surface`                   | `#FFFFFF`             | Cards, panels, tables, dialogs                                                                           |
| `border`                    | `#E5E7E3`             | Dividers, card and table borders                                                                         |
| `border-strong`             | `#D6D9D4`             | Form-control borders, emphasized dividers                                                                |
| `neutral-soft`              | `#F5F5F1`             | Table headers, neutral badges, system events                                                             |

**Fenwira primary ≠ WhatsApp green.** `#00A884` means "Fenwira action or selection". `#25D366` means "this is WhatsApp"; healthy states use the separate `success` token. They are different tokens so the two meanings can never be confused in code.

### Status

| Category | Meaning (examples)                                                          | Tokens                                        | Text shade                                  |
| -------- | --------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------- |
| Success  | active, connected, approved, delivered, read, healthy, granted, window open | `success` `#16A34A`, `success-soft` `#D1FAE5` | `success-strong` `#166534`                  |
| Warning  | paused, attention required, low balance, opted out, window closed           | `warning` `#F59E0B`, `warning-soft` `#FEF3C7` | `warning-strong` `#B45309`                  |
| Danger   | failed, rejected, disconnected, destructive                                 | `danger` `#DC2626`, `danger-soft` `#FEE2E2`   | `danger-strong` `#B91C1C` (hover `#991B1B`) |
| Info     | scheduled, processing, syncing, sent, running, open, human takeover         | `info` `#2563EB`, `info-soft` `#EFF6FF`       | `info-strong` `#1D4ED8`                     |
| Neutral  | draft, archived, inactive, cancelled, skipped                               | `neutral-soft`                                | `secondary`                                 |

### Contrast (verified by `packages/ui/test/tokens.test.ts`)

Every text pairing below clears WCAG AA 4.5:1; the test fails if a token change breaks one.

| Pair                                                    | Requirement |
| ------------------------------------------------------- | ----------- |
| White on primary/danger/info strong fills               | ≥ 4.5       |
| Strong status text on its soft tint                     | ≥ 4.5       |
| Primary/secondary/muted text on white and warm neutrals | ≥ 4.5       |
| Primary-strong focus outline on warm canvas             | ≥ 3         |

`tokens.test.ts` verifies the current actual values. New sidebar tokens: `sidebar` #FAFAF8, `sidebar-border` #E7E7E2. Muted text #66716B clears AA; screenshot decorative muted #737C77 does not.

Rules that follow from the numbers:

1. `primary`, `success` and `warning` are **never text colors** (each fails 4.5:1 on white). Use them for indicators, icons beside text, dots, borders and fills behind dark text. Colored text uses the `-strong` shade.
2. Filled buttons use `primary-strong` or `danger-strong` with white text.
3. `muted` is AA-safe on warm neutrals. Screenshot muted `#737C77` is `muted-decorative` only (4.30:1 on white); do not use it for small text.
4. Focus rings use `primary-strong` to meet 3:1 against warm surfaces.
5. Form controls use `border-strong`. Their boundary alone is below 3:1 (1.48), so every control also has a visible label; the focus state is the 3:1 indicator (WCAG 1.4.11 exception for components identified by their label).

### Status is never color alone

A status always shows a **label**, and usually an icon. `StatusBadge` is the only way to render a domain status: feature code passes the status key (`status="FAILED"`) and never picks a tone. `STATUS_PRESETS` in `packages/ui/src/components/status-badge.tsx` is the single mapping from status to category, label and icon. User-chosen colors (tags) use `Badge` with the tag's tone; they are labels, not statuses.

**Exception: inbox bubble ticks.** Outbound message bubbles in the inbox show delivery status as WhatsApp-style ticks with no visible label (`MessageTicks` in `packages/ui`, the single mapping for tick icons and colours): clock for sending, single grey tick for sent, double grey for delivered, double `info` (and heavier) for read, `danger` exclamation in a circle for failed. Each tick has an accessible label ("Sending", "Sent", "Delivered", "Read", "Failed to send") and a title, and its SVG is hidden from assistive technology. Failed is a button: focus or click shows Meta's reason and code. The tick colours meet the 3:1 non-text threshold on `message-outbound` (tokens test). This exception covers inbox bubble ticks only; campaigns, tables and every other list keep `StatusBadge`.

### Charts

`TrendChart` (Phase 11) is the only chart component. Series use `primary-strong`, `info`, `success-strong`, `danger`, `warning-strong` and `secondary`, which all meet 3:1 non-text contrast on the surface (WCAG 1.4.11). Values never depend on color alone: every series has a text legend, the chart's accessible name states the totals, and "Show as table" renders the same numbers as a table. No other chart library is used.

### Brand assets

The Fenwira mark, lockups, app icons and link-preview banner are image assets (`docs/brand/README.md`), produced from originals by `scripts/brand-assets.py`. Their gradient is part of the artwork only; it doesn't add UI colours. Official logos of supported integrations (WhatsApp, ERPNext, Google Sheets, Zoho, Shopify) are likewise unmodified image assets, shown only through `IntegrationLogo` on a white tile beside the integration's name. Their colours are artwork, not UI colours ([docs/brand/README.md → Third-party logos](../brand/README.md#third-party-logos)).

## 2. Typography

Font: Inter for UI, JetBrains Mono for identifiers, phone numbers and code (loaded with `next/font`).

| Role          | Size / line (px) | Utility                 | Weight                         |
| ------------- | ---------------- | ----------------------- | ------------------------------ |
| Page title    | 24 / 32          | `text-2xl`              | semibold (via `PageHeader`)    |
| Section title | 18 / 28          | `text-lg`               | semibold (via `SectionHeader`) |
| Card title    | 16 / 24          | `text-md`               | semibold (via `CardTitle`)     |
| Body          | 14 / 20          | `text-base`             | regular                        |
| Body strong   | 14 / 20          | `text-base font-medium` | medium                         |
| Message       | 15 / 22.5 (1.5)  | `text-message`          | regular; inbox message text only |
| Small         | 13 / 18          | `text-sm`               | regular                        |
| Caption       | 12 / 16          | `text-xs`               | regular / medium               |
| Metric value  | 24 / 32          | `text-2xl tabular-nums` | semibold (via `MetricCard`)    |

`text-3xl` (30/36) is reserved for authentication and onboarding. The approved Home scale refinement returns its welcome heading to 24/32, section headings to 16/24 and primary body/row text to 14/20. Other application pages retain their existing typography. Headings follow document order (one `h1` per page from `PageHeader`, `h2` for sections, `h3` inside cards).

## 3. Spacing

Tailwind's 4px scale, used from this set: **4, 8, 12, 16, 20, 24, 32, 40, 48, 64** (`1, 2, 3, 4, 5, 6, 8, 10, 12, 16`). Arbitrary values (`p-[13px]`) are rejected by `pnpm lint:design`.

| Context          | Value                                                |
| ---------------- | ---------------------------------------------------- |
| Page gutter      | 16 (mobile) / 24 (≥ md)                              |
| Page sections    | 24 between sections                                  |
| Card padding     | 20 (`p-5`); dense panels 16 (`p-4`)                  |
| Form field stack | 16 between fields; 6 label → control                 |
| Table cell       | 10 vertical × 12 horizontal (40px rows); header 40px |
| Inline groups    | 8 (buttons, badges), 12 (icon + text blocks)         |

## 4. Shape and elevation

| Element                                         | Radius            |
| ----------------------------------------------- | ----------------- |
| Buttons, small controls                         | 8 (`rounded-sm`)  |
| Inputs, selects, badges, panels                 | 8 (`rounded-md`)  |
| Cards, tables                                   | 12 (`rounded-lg`) |
| Dialogs, drawers' inner sheets, command palette | 16 (`rounded-xl`) |

Surfaces are separated by **borders, not shadows**. Two elevation tokens exist: `shadow-raised` (small floating affordances: canvas nodes, segmented thumbs, preview bubbles) and `shadow-overlay` (menus, popovers, dialogs, drawers, toasts). Tailwind's default shadows are reset and generate nothing.

## 5. Motion

Transitions are short (150–200 ms) and functional (hover, open/close, drawer slide). `prefers-reduced-motion: reduce` collapses every animation and transition to ~0 ms globally (`theme.css`).

## 6. Iconography

`lucide-react`, 16px in controls and rows, 18px in the sidebar, 20–24px in empty/error states. Icons that carry no information beyond adjacent text are `aria-hidden`. Icon-only buttons have an accessible name and a tooltip.

## 7. Components (`packages/ui`)

Foundation: Button, Input, Textarea, Select, Checkbox, RadioGroup, Switch, Field/Label, Badge, StatusBadge, Avatar, Tooltip, Dropdown, Modal, Drawer, Tabs, Card, Table, Breadcrumb, Pagination, Skeleton, Toast, Alert.

Composites (v1): **DataTable** (toolbar slot, sorting, selection with a bulk-action bar, a Columns menu, right-aligned numeric columns via `meta.align`, pagination, loading/empty/error) with **RowActions**, **FilterBar**, **SearchInput**, **MetricCard** (`KpiCard` is a deprecated alias for one release), **EmptyState**, **ErrorState**, **PermissionState**, **ConnectionState**, **ConfirmDialog** (`useConfirm`, with an `impact` list), **DetailDrawer**, **Timeline**, **SectionHeader**, **PageHeader**, **CommandPalette** (controlled search for server results), **ModuleTabs**, **Alert** (action wraps under the text on narrow screens).

Page patterns (`packages/ui/src/components/patterns.tsx`): **ListPage**, **DetailPage** (+ `SummaryItem`), **BuilderPage**, **SettingsPage**, **DashboardLayout** (see UX_PATTERNS.md).

Web-app composites built on these: `ConsentBadge`, `EligibilitySummary` and `ContactPreview` (contacts), `SidebarStatus`, `HelpMenu`, `BrandMark` (shell), the command-palette data hook `lib/command-search.ts`, and workspace status hooks `lib/workspace-status.ts`.

Every component: built on Radix primitives via `@fenwira/ui` (feature code may not import Radix, cmdk, sonner, TanStack Table or CVA directly), keyboard operable, visible `primary` focus ring, and shown on the `/dev/ui` gallery.

## 8. Module color usage

| Context                            | Treatment                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sidebar                            | `sidebar` background, `sidebar-border` divider, `secondary` labels with `slate-400` icons; active `primary-soft` fill, `primary-strong` icon and text, 3px `primary` bar |
| Inbox outbound / inbound bubble    | `message-outbound` **#D2F2DF** / `surface` + `border`                                                                                                  |
| Inbox selected conversation        | `primary-soft` + 3px `primary` left border                                                                                                             |
| Inbox system event / internal note | `neutral-soft` pill / `warning-soft` with an "Internal" label                                                                                          |
| Human takeover                     | `info` badge and banner                                                                                                                                |
| Template variables `{{n}}`         | `primary-soft` chip, `primary-strong` text                                                                                                             |
| WhatsApp preview frame             | `neutral-soft` chat background, `surface` bubble, `whatsapp` channel mark                                                                              |
| Flow nodes                         | trigger `slate`, message `surface`, condition `warning-soft`, action `info-soft`; selected `primary` ring; edges idle `slate-400`, traversed `primary` |

## 9. Enforcement

- `packages/ui/src/styles/theme.css` resets Tailwind's palette, type scale, radii and shadows; only tokens generate classes.
- `pnpm lint:design` rejects raw colors in `apps/web` and `packages/ui/src` (except `tokens.ts` and `theme.css`) and arbitrary Tailwind values in `apps/web`.
- ESLint rejects direct imports of the underlying primitive libraries in `apps/web`.
- `packages/ui/test/tokens.test.ts` pins the palette and every contrast pairing above.
- axe e2e (WCAG 2.2 A/AA) runs on every major page; see UX_PATTERNS.md → Quality gate.
- **Changing a token** means updating this document, `tokens.ts`, `theme.css` and the contrast test in the same change.

## Experience V2 communication polish (2026-10-07)

The approved visual correction adds controlled color to the existing calm foundation, without changing page structure or domain meaning. New semantic surfaces: `thread-soft` **#F3F2ED** (warm focused conversation canvas), `message-outbound` **#D2F2DF** (perceptible emerald outbound bubble), `note-soft` **#FFF8EB** (private team notes). Incoming messages remain white. Outbound metadata uses secondary/strong status text rather than muted text: muted on the stronger emerald tint fails AA. Executable contrast tests cover all actual new foreground/background pairings. The accessible muted token remains #66716B.

Avatar `appearance="varied"` selects a stable, deterministic soft emerald/blue/amber/red/green identity treatment using existing accessible strong foregrounds; it never implies status. Home, Inbox and account identity opt in; all other avatar defaults remain unchanged. Timeline `appearance="activity"` uses existing status semantics for compact tinted icon circles and connecting lines, with default audit timelines preserved. Inbox bubbles use `MessageTicks` (see the exception above) instead of an inline `StatusBadge`.

Use compact tinted attention icons, fine section dividers, stronger identity/type hierarchy and existing `shadow-raised` for messages/composer. No gradients, illustrations, heavy shadows, arbitrary palette or change to selected navigation geometry. Tags continue to honor persisted user-selected colors. Existing routes, permissions, communication behavior and data remain authoritative.

## Inbox final fidelity refinement

The outbound-only `message-outbound` surface is **#D2F2DF**, with all actual message/status foregrounds checked by the existing AA contrast matrix. No Home or other module consumes this token. The Inbox thread overlays an original 400px seamless line-art tile (`packages/ui/src/assets/chat-doodle.svg`: speech bubble, phone, clock, heart, star, paper plane, tick, camera, gift, location pin; 1.5px strokes, no fills) applied as a CSS mask through the `chat-doodle` utility on a `bg-slate-400` layer at 12% opacity, so its color comes from a token and the asset carries none. The layer is `aria-hidden`, does not intercept events, and is removed under `prefers-contrast: more`. No external/WhatsApp wallpaper or imagery. White incoming messages and labelled warm notes retain their readable surfaces. Composer writing starts at 40px and grows to 160px before internal scrolling; mobile controls stay 40px. Shared default primitive sizes and the approved Home shell remain unchanged.

### Campaign operations running state

Campaign statuses use the default `StatusBadge` mapping everywhere (the former `context="campaign"` success override is removed): draft/archived neutral; scheduled, running and processing info; paused, paused for no credits and low balance warning; completed, delivered and read success; failed danger. Message receipts are told apart by icon as well as label: sent a single tick, delivered a double tick, read a heavier double tick. Metric trends render through `StatusBadge` (`TREND_*` presets): the arrow carries direction, the tone carries good or bad news, inverted for metrics where up is bad (failures, spend). Feature code must not substitute ACTIVE for RUNNING or override status colors locally.

## Automations and Reply Studio presentation (2026-10-29)

These screens reuse the existing palette, type scale, 12px card radius, 16px sheet radius
and `shadow-raised` hover elevation. No tokens are added. Layout follows an 8px grid:
8px inline gaps, 16px card padding, 24px page sections. Segmented route navigation uses
links with `aria-current`; in-page Auto Replies/Bot Flows use keyboard-accessible tabs.
Flow cards and rows share labelled status badges and permission-aware switches.
Starter snippets are illustrative conversation recipes, not Meta message templates.

The wizard has a stepper, form and fixed-height `PhoneFrame`; the stepper moves above
the form at intermediate widths and the phone moves into a Preview drawer on phones.
The trial reminder uses a slim warning surface with `warning-strong` text. Dismissal is
scoped to the user and workspace until the next Asia/Kolkata calendar day; expired or
sending-blocked reminders cannot be dismissed. Existing billing destinations are retained.
Stats and previous-period comparisons use the existing reports endpoint. Response previews
read existing draft versions for displayed flow cards and Reply Studio rows; no list/API fields or
execution behavior change. Empty-draft cleanup archives only drafts verified to have zero
nodes, after confirmation; drafts containing steps are retained.

## Reply Studio compact overview

The image-reference refinement gives Automations two nested sidebar destinations: Workflows
and Reply Studio. Reply Studio owns the Auto Replies / Bot Flows route tabs and a Reports
header action. Other modules retain their existing navigation. The old `/automations` and `/automations/reply-studio` entry URLs redirect to
`/automations/workflows` and `/automations/reply-studio/auto-replies`.
The live count and three report metrics share one compact summary surface; the live hours indicator belongs
to the header action. Starter conversations retain their token-drawn previews within 128px.
No new tokens are introduced.

Reply Studio empty tabs show relevant starters immediately, with no search/status controls.
Populated tabs show every saved item, including drafts, before an optionally expanded starter
section. Its preference is stored per user/workspace/kind. Starter cards share preview, title,
purpose, metadata and aligned Use starter actions. Five starters do not need a gallery.

## Reply Studio editors and diagnostics

Single-rule Auto Replies use a left configuration column with a shared fixed-height phone
on the right; mobile opens that preview in a drawer. The view reuses the canvas save,
validation and publish handlers. Draft changes and Published version have separate labelled
status badges, version metadata and an optimistic discard action. Bot Flow nodes retain
actual snippets and saved field names; branches use node-aware labels without changing
persisted handles. Session/ordering controls remain under Advanced settings.

A dry-run transcript explains matching, conditions and eligibility with shared reason codes.
Sample eligibility is labelled, and reports distinguish execution outcomes from sends.
Recent activity reuses the last-20 executions endpoint. Failure links open the canvas at the
reported node; publishing previews illustrative saved fields, customer review and the existing
private handover note. Existing tokens and PhoneFrame are reused throughout.

## Automation dashboard image references (2026-10-29)

The supplied Workflows and Reply Studio screenshots guide hierarchy and density, using existing
Fenwira tokens and shared page components. Workflows uses an inline seven-day summary,
Your workflows / Starter workflows tabs, search/status/trigger filters and three-column cards.
Step previews follow at most three connected `next` edges and stop at branches; they read actual
saved draft graphs. Last-run times use executions, and failure/success figures use the existing
analytics endpoint with explicit unavailable/processing states. History chooses an existing flow.

Reply Studio uses compact bordered rows with response/number context, keyword or trigger chips,
seven-day starts, status and existing lifecycle actions. The WhatsApp filter uses connected numbers;
rules applying to every number remain included. Compact starter tiles expand into the retained
conversation previews. Both dashboards use two-column metric grids on phones, and existing
permission gates, confirmations, archive/restore and node-linked activity remain available.
Screenshot counts, workspace identity and example conversations are not product data. Populated
visual evidence uses isolated browser fixtures; no runtime, schema or messaging behavior changes.


## Approved three-panel inbox (2026-10-30)

The supplied WhatsApp team inbox reference supersedes prior Inbox geometry checkpoints.
This presentation is scoped with `fw-inbox-theme` inside the Inbox workspace. The application
sidebar and topbar retain their original presentation, including the 224px expanded / 64px
collapsed sidebar and original palette. At 1440px the conversation list and customer panel are
320px each, and the thread fills the remainder. The topbar is 56px, conversation header 72px,
conversation rows at least 76px with 36px avatars. Below 1280px customer details use the
existing accessible drawer; below 768px list and conversation are separate views.

Inbox semantic tokens: action `inbox-primary` #047857, hover #065F46, selected #ECFDF5,
outbound #E8F7F0, main text #172B25, secondary #66756F, border #E5EAE7. The existing
#F7F7F4 canvas and white panels remain. Notes use #FFF7E6 with #FDE3B0 borders and #92400E
labels; warning tags retain their recorded meaning with #FFF1DE / #9A4D0B. Informational
controls reuse blue. Secondary text is used on white; outgoing metadata uses main text to
maintain AA contrast on mint. The scoped palette is tested alongside the original contract.

Opt-in `Avatar` inbox appearance hashes the stable contact identity to pink (#FCE0EC/#9D2455),
lavender (#EBDDFB/#66379B), peach (#FFE1C7/#974613), mint (#CFF3E8/#065F46) or blue
(#DAE7FF/#274B97). These are identity colors and convey no presence or status.

The docked rectangular composer retains the existing send, template, immediate file-upload,
internal-note, draft and collision-control paths. Its input grows to 160px and respects IME entry.
Message-type filters remain accessible from the header and its overflow menu. Overview,
Activity (existing conversation history) and Files use real permission-gated data. Team,
pinning, emoji and new-conversation controls are omitted because the inbox has no such
capabilities. No consent or contact details are synthesized from the reference.

### Inbox icon density refinement

Within conversation and customer panels only, use 14px action glyphs, 12px metadata icons,
18–20px file icons and 24px media play marks. Scope this with `fw-inbox-compact-icons`, including
the customer drawer. File-icon containers are 32px and desktop icon-only controls 32px;
preserve mobile targets. Global navigation and avatars retain their existing sizes. The
redundant list view menu is removed; its unique agent-takeover filter is in the advanced menu
beside search, with a removable active chip.

### Inbox typography density refinement

Scope `fw-inbox-compact-type` to the conversation and customer panels, including the mobile
customer drawer. Body text is 13px, supporting text and metadata 12px, compact headings 14px
and panel titles 16px. Message text uses a 1.5 line height for readability. The application
navigation and inbox conversation-list typography retain their existing scale. This uses
scoped typography tokens so controls, messages and details share a consistent hierarchy.

### Conversation-list refinement (2026-10-30)

The list keeps its 320px desktop width and original application navigation. Its fixed control
area uses an 18px Inbox heading, 36px search with an adjacent advanced-filter button, a 36px
neutral segmented group (32px buttons), and 32px status/unread controls. Selected segments
use a white surface, subtle border/shadow and emerald text instead of an underline. Counts
come from the existing server endpoint; compact visible numbers retain full accessible labels.
Agent takeover moves into the advanced menu, with a removable chip while active. Counts remain
hidden during takeover filtering because the count endpoint does not support that combination.

Rows have a 76px minimum height, 36px stable identity avatars, 14px names, 13px one-line previews
and 12px timestamps. An 8px list inset surrounds rounded mint selection; its short inset
indicator is 3px wide. Rows grow with text scaling. Unread uses weight, darker preview text and
a labelled count. Keyboard focus has its own outline and never selects or marks a row read.
Hover/tinted-surface text uses main text for AA contrast. Full names and assignment context
remain available through the shared tooltip. Only the generated `Textile Demo Shopper N`
pattern substitutes its final number for normal initials; other names keep their initials.

Previews use stored summaries, with richer content from already-loaded unfiltered thread
caches when their latest-message timestamp matches. Frozen template bodies are used only
without unresolved variable markers. Fallback template names replace underscores with spaces;
the message details retain technical identifiers. Search snippets keep priority without inferred
sender attribution. Delivery/failure states use inline `StatusBadge`; event updates refresh
existing caches without per-row requests. Current summaries do not expose direction, status,
rendered template body or contact photos, so those are not synthesized for unloaded rows.

Customer context docks at 1280px and above; narrower desktop/tablet widths use the accessible
drawer to keep the conversation usable. System events use 12px text, small corners and reduced
padding/margins without grouping or hiding history. The composer eligibility notice uses a
single subtle amber border, small clock, concise copy and the existing template action. Its
action stacks below the copy when the composer container is narrower than 400px.

### Centre-panel reply-window refinement

The centre panel has one reply-window indicator, beside the composer tabs in Reply mode.
`useReplyWindow` shares the existing eligibility query and one countdown timeout. It uses the
server expiry, checks on focus/visibility, reconnection, inbound messages and eligibility or
conversation-window updates, and clears its listeners/timeouts on unmount. More than 60 minutes
uses muted inline text; 15–60 minutes uses amber inline text; the last 15 minutes uses a small
amber badge and one helper sentence. Positive partial minutes round up; expired windows never
show 0m. The tooltip uses the existing workspace metadata query/timezone and AM/PM dates, with
the established India timezone convention as metadata fallback. Minute changes are not live
announcements; expiry is announced politely. Internal notes hide all customer-window messaging.

Unknown/failed eligibility checks do not enable sending. Server contact/consent/number blockers
retain their own explanations. A closed-window rejection removes the optimistic message,
preserves the draft, refreshes eligibility and offers only permitted template actions. The closed
notice says “Choose an approved template to message this customer.” It uses 12px padding and
the existing subtle amber treatment and responsive action layout.

The unified composer has 8px padding, a 44px resting input and 160px input maximum followed by
internal scrolling. Its empty height is approximately 122px on desktop and 130px on phones.
Compact Reply/Internal note tabs sit above one toolbar with an attachment icon/tooltip, labelled
Templates, a saved-reply icon menu and compact Send. Keyboard guidance lives in the Send tooltip;
there is no permanent shortcut footer or extra full-width separator. Note mode retains its amber
surface/lock and labels its action Add note. Notices, text scaling and upload state can grow the
container. The chat header's customer-panel button is absent while details are open, leaving no
reserved gap. The panel's collapse control restores the header button and focus after it mounts;
keyboard opening focuses the inline collapse control or the existing accessible drawer.
The header strip is now automation-only,
neutral and approximately 36px on desktop. Explicit takeover shows Automation paused; explicit
pause shows Automation paused manually; active policy retains Take over. Existing permissions,
mutation pending/error behavior and automation endpoint remain authoritative. The API exposes
policy state, not flow applicability or detailed pause reasons; no running flow is inferred.

Timeline system events retain every entry, timestamp and historical wording, with small relevant
icons and no outlined pill. Document bubbles use 12px horizontal padding and compact 8px card
padding/gaps, retaining real filename/type/size, downloads, sender grouping and receipt states.

### Customer-panel refinement

The right panel retains its 320px desktop width, accessible drawer below 1280px and independent
scrolling. Its heading uses a 48px minimum row; the profile has an 88px minimum, a 40px avatar,
14px wrapping name, 13px phone and 12px Open contact link. Profile identity reuses the list's
contact identity and generated-name fallback. Phone copying reports success or failure through
accessible toasts. Existing contact editing opens from the profile or missing-field actions only
with write permission and loaded property definitions. Tabs are 36px with a thin emerald selection
and stay at the top of the panel's scroller. These are minimums and can grow with text scaling.

Overview uses 16px horizontal padding, 13px section headings/values and 12px secondary text.
Sections combine 8px top padding with 8px gaps and fine separators. Assignment keeps the existing
actions in a 32px desktop/36px mobile dropdown. Tags retain semantic colours, 24px minimum height,
wrapping labels and labelled remove/add controls. Label/value rows show stored email/language,
readable country names and actual custom properties. Missing fields use working edit actions or
a dash according to permissions. No attributes or consent are inferred.

Contact notes use pale amber cards with 8px padding, three-line previews, full-content expansion
and 12px author/time metadata. The count covers all loaded notes; Show all preserves access to
every note. Messaging eligibility and automation are collapsed by default. Eligibility uses actual
backend verdicts with small amber restriction badges and recorded reasons/consent on expansion;
unknown values never appear allowed. Automation uses a neutral inline badge for the explicit
policy state. No countdown, template picker or Resume automation action is duplicated here.

Activity merges recorded contact tag/note audits with conversation assignment/automation system
events, newest first. Independent cursors and a shared coverage boundary preserve chronological
order without paging or scrolling the chat. Files retain existing image/video/document filters,
authorized file links and Jump to message, with compact rows and two-column media thumbnails.
Drawer density and timeline rules are scoped to the customer-panel marker; other modules keep
their default components. Current APIs expose no contact photo, note edit/delete, flow applicability
or detailed automation context; the panel does not invent those capabilities.
