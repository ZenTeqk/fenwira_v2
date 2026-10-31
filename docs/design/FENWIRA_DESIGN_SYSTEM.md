# Fenwira Design System v1

**Status:** adopted 2026-09-27; visual foundation evolved by approved [Experience V2](FENWIRA_EXPERIENCE_V2.md), 2026-10-06. Supersedes the Phase 2 contract in `docs/DESIGN_SYSTEM.md` (now a pointer here). Companion docs: [UX_PATTERNS.md](UX_PATTERNS.md) (page patterns, module UX, quality gate) and [UI_AUDIT.md](UI_AUDIT.md) (the baseline this version fixes).

Fenwira is a WhatsApp operations workspace that people keep open all day. The interface is **calm, dense, fast and trustworthy**: restrained surfaces, strong hierarchy, obvious system status, and no decoration that competes with the work. No gradients, glassmorphism, oversized cards, heavy shadows or marketing-sized headings inside the app.

This is a contract. Tokens live in `packages/ui` and are the only source of color, type, radius and elevation. Feature code uses semantic utilities (`bg-action-primary`, `text-fg-secondary`, `border-border-subtle`) and shared components. Light is the default theme. Dark values exist for every role and are contrast-tested (§1), but no theme switcher is exposed yet (DS1 still holds for the product).

## 1. Color

**Theme token refactor (2026-10-31).** Approved direction: neutral surfaces, colorful feature accents, semantic statuses and emerald primary actions; the Inbox is a neutral shell around a WhatsApp-inspired chat area. Light is the default theme. Dark values are defined and contrast-tested but not exposed: `data-theme="dark"` on an element switches its subtree, and there is no switcher yet.

### Source of truth

`packages/ui/src/tokens.ts` is the only place color values live. It has three layers:

| Layer | Export | Naming | Use |
| --- | --- | --- | --- |
| Primitive palette | `palette` | hue + lightness: `neutral.600`, `emerald.700`, `chat.leaf` | Raw hex. Never referenced by feature code; becomes `--fw-<hue>-<step>` with no Tailwind utility |
| Semantic roles | `semanticTokens` | role: `canvas`, `fg-secondary`, `status-error-bg`, `chat-outgoing` | Each role is a `{ light, dark }` pair of palette references. Feature code uses these utilities (`bg-surface-muted`, `text-fg-secondary`) |
| Component tokens | `componentTokens` | `phone-bezel`, `category-*`, `avatar-*`, `chart-1…6` | Only where no semantic role fits: data-driven identities, chart series, the phone preview bezel |

`packages/ui/src/styles/tokens.css` is **generated** from `tokens.ts` by `renderThemeCss()` (`src/theme-css.ts`) and pinned by a file snapshot in `tokens.test.ts`, so the CSS cannot drift from the TypeScript. After changing a token, run `pnpm --filter @fenwira/ui test -u`. The generated file declares primitives on `:root`, every role as `--color-*` in `@theme static` (Tailwind utilities, always emitted), and the dark values under `[data-theme='dark']`. `theme.css` imports it and holds no color values. `colorTokens` (resolved light values) remains for the web manifest and browser `theme-color`.

### Semantic roles

| Group | Tokens | Light | Dark |
| --- | --- | --- | --- |
| Surfaces | `canvas` · `sidebar` · `surface` · `surface-elevated` · `surface-muted` | #F5F5F4 · #EFEFED · #FFFFFF · #FFFFFF · #F0F0ED | #121311 · #171816 · #1D1E1C · #272826 · #232422 |
| Interaction surfaces | `surface-hover` · `surface-selected` · `surface-disabled` | #EAEAE7 · #E7E7E4 · #F0F0ED | #2E2F2C · #3B3B37 · #232422 |
| Inverse | `inverse` · `inverse-fg` · `inverse-fg-muted` · `inverse-border` · `inverse-hover` · `scrim` | #242622 · #FFFFFF · #B3B5AD · #4A4C46 · #2E2F2C · #242622 | #ECECE9 · #1D1E1C · #62665E · #CFCFC8 · #E7E7E4 · #000000 |
| Text | `fg` · `fg-secondary` · `fg-muted` · `fg-disabled` · `fg-subtle` (non-text icons) | #242622 · #62665E · #62665E · #B3B5AD · #80837B | #ECECE9 · #B3B5AD · #A8AAA2 · #4A4C46 · #7A7D75 |
| Borders and focus | `border-subtle` · `border-control` · `border-control-strong` · `focus-ring` | #DEDED8 · #CFCFC8 · #80837B · #047857 | #2E2F2C · #4A4C46 · #7A7D75 · #34D399 |
| Primary action | `action-primary` · `-hover` · `-fg` · `-subtle` · `-subtle-hover` | #047857 · #065F46 · #FFFFFF · #ECFDF5 · #D1FAE5 | #34D399 · #6EE7B7 · #022C22 · #143024 · #1A3D2E |
| Destructive action | `action-danger` · `-hover` · `-fg` | #B91C1C · #991B1B · #FFFFFF | #F87171 · #FCA5A5 · #2B0A0A |
| Brand and channel | `brand` · `whatsapp` | #00A884 · #25D366 | #10B981 · #25D366 |
| Conversation accent (blue) | `accent-conversation` · `-fg` · `-bg` · `-border` | #2563EB · #1D4ED8 · #EFF6FF · #BFDBFE | #60A5FA · #93C5FD · #17233A · #1E3A8A |
| Automation / AI accent (violet) | `accent-automation` · `-fg` · `-bg` · `-border` | #7C3AED · #6D28D9 · #F5F3FF · #DDD6FE | #A78BFA · #C4B5FD · #251C3B · #5B21B6 |
| Chat | `chat-canvas` · `chat-incoming` · `chat-incoming-border` · `chat-outgoing` · `chat-meta` · `chat-read` · `chat-pattern` | #F3F0EA · #FFFFFF · #DEDED8 · #DDEED5 · #62665E · #2563EB · #80837B | #151614 · #2A2B28 · #3B3B37 · #1E3A2B · #B3B5AD · #60A5FA · #7A7D75 |
| Internal notes | `chat-note` · `chat-note-border` · `chat-note-fg` | #FFF7E6 · #FDE3B0 · #92400E | #2E2410 · #5C4413 · #FCD34D |

**Four greens, four meanings.** `action-primary` is "Fenwira action or selection"; `brand` (#00A884) is the logo's emerald for brand marks and the active-navigation bar, never text or an action; `status-success` (#16A34A) means healthy/approved; `chat-outgoing` is a message the business sent; `whatsapp` (#25D366) means "this is WhatsApp". `tokens.test.ts` fails if any two collapse to the same value. The Inbox's former private action greens (`inbox-primary` and friends) are now the shared action tokens.

Dark surfaces are neutral charcoal: the test rejects any blue or green cast (channel spread above 4) on canvas, sidebar, surfaces and the chat canvas/incoming bubble.

### Status

Every status has four tokens: the solid (dots, bars, icons beside a label), `-fg` (text), `-bg` (tint) and `-border`.

| Category | Meaning (examples) | Light solid · fg · bg · border | Dark solid · fg · bg · border |
| --- | --- | --- | --- |
| `status-success` | active, connected, approved, delivered, read, healthy, granted, window open | #16A34A · #166534 · #DCFCE7 · #BBF7D0 | #4ADE80 · #86EFAC · #14281B · #14532D |
| `status-warning` | paused, attention required, low balance, opted out, window closed | #D97706 · #9A4D0B · #FEF3C7 · #FDE3B0 | #FBBF24 · #FCD34D · #2E2410 · #5C4413 |
| `status-error` | failed, rejected, disconnected, destructive | #DC2626 · #B91C1C · #FEE2E2 · #FECACA | #F87171 · #FCA5A5 · #331A1A · #7F1D1D |
| `status-info` | scheduled, processing, syncing, sent, running, open, human takeover | #2563EB · #1D4ED8 · #EFF6FF · #BFDBFE | #60A5FA · #93C5FD · #17233A · #1E3A8A |
| `status-neutral` | draft, archived, inactive, cancelled, skipped | #80837B · #62665E · #F0F0ED · #DEDED8 | #7A7D75 · #B3B5AD · #2E2F2C · #4A4C46 |

The light warning solid moved from #F59E0B to #D97706 and warning text from #B45309 to #9A4D0B: the old values failed 3:1 as a bar on white and 4.5:1 as text on the grey sidebar/muted surfaces.

### Component tokens

`phone-bezel` (WhatsApp preview frame), template categories (`category-marketing-fg/-bg` violet, `category-authentication-fg/-bg` orange; Utility uses `status-info`), inbox avatar identities (`avatar-{pink,lavender,peach,mint,periwinkle}-fg/-bg`, deterministic and decorative, never a status) and chart series `chart-1` … `chart-6` (emerald, blue, green, red, amber, neutral).

### Contrast (verified by `packages/ui/test/tokens.test.ts`, both themes)

The test resolves both themes and checks actual pairs. Text pairs need 4.5:1 (WCAG 1.4.3); non-text pairs need 3:1 (1.4.11).

| Pair | Requirement |
| --- | --- |
| `fg`, `fg-secondary`, `fg-muted` on canvas, sidebar, every surface (incl. hover/selected), action subtle tints, chat canvas/bubbles/notes, every status and accent tint | ≥ 4.5 |
| `action-primary` text on canvas, sidebar, surfaces, subtle tints and incoming bubbles (not on the neutral `surface-selected`, where it is 4.43:1 in light) | ≥ 4.5 |
| Action `-fg` (and legacy `text-surface`) on their fills and hover fills; inverse text on inverse | ≥ 4.5 |
| Status and accent `-fg` on their tint, surface, canvas, sidebar and muted surface | ≥ 4.5 |
| `chat-meta` on both bubbles and the chat canvas; info/success/error/action text on outgoing bubbles; note text on notes | ≥ 4.5 |
| Category and avatar `-fg` on their `-bg` | ≥ 4.5 |
| `focus-ring` on canvas, sidebar, surfaces, selected, subtle tint and chat canvas | ≥ 3 |
| `fg-subtle`, `border-control-strong`, status/accent solids, action fills, chart series on surfaces | ≥ 3 |
| Delivery ticks (`chat-meta`, `chat-read`, `status-error`) on both bubbles | ≥ 3 |

Rules that follow:

1. Status solids are never text; colored text uses the `-fg` token.
2. Filled buttons use `action-primary`/`action-danger` with their `-fg` token (white in light, near-black on the lighter dark-mode fills).
3. In light, `fg-muted` equals `fg-secondary`: no lighter grey clears AA on `surface-selected`. Hierarchy comes from `fg` versus secondary and from weight/size.
4. Text-field outlines use `border-control` (below 3:1; every field has a visible label and a 3:1 focus state, the WCAG 1.4.11 exception). Checkbox, radio and switch boundaries use `border-control-strong` (≥ 3:1).
5. `fg-disabled` is exempt from contrast (WCAG 1.4.3 incidental text) and always pairs with disabled semantics.

### Deprecated aliases

Design System v1 names (`primary`, `primary-strong`, `primary-soft`, `success`/`-soft`/`-strong`, `warning…`, `danger…`, `info…`, `slate`, `slate-800`, `slate-400`, `secondary`, `muted`, `background`, `border`, `border-strong`, `sidebar-border`, `neutral-soft`) still generate utilities. Each is a CSS variable pointing at its semantic token (`tokens.ts → tokenAliases`), so it follows the theme. Shared components in `packages/ui` no longer use them; new code must not. Remove an alias once nothing references it. The component palettes `inbox-*`, `template-*`, `thread-soft`, `message-outbound`, `note-soft`, `muted-decorative` and the old `avatar-*` names are retired, and `pnpm lint:design` rejects them.

### Status is never color alone

A status always shows a **label**, and usually an icon. `StatusBadge` is the only way to render a domain status: feature code passes the status key (`status="FAILED"`) and never picks a tone. `STATUS_PRESETS` in `packages/ui/src/components/status-badge.tsx` is the single mapping from status to category, label and icon. User-chosen colors (tags) use `Badge` with the tag's tone; they are labels, not statuses.

**Exception: inbox bubble ticks.** Outbound message bubbles in the inbox show delivery status as WhatsApp-style ticks with no visible label (`MessageTicks` in `packages/ui`, the single mapping for tick icons and colours): clock for sending, single `chat-meta` tick for sent, double for delivered, double `chat-read` (and heavier) for read, `status-error` exclamation in a circle for failed. Each tick has an accessible label ("Sending", "Sent", "Delivered", "Read", "Failed to send") and a title, and its SVG is hidden from assistive technology. Failed is a button: focus or click shows Meta's reason and code. The tick colours meet 3:1 on both bubbles in both themes. This exception covers inbox bubble ticks only; campaigns, tables and every other list keep `StatusBadge`.

### Charts

`TrendChart` (Phase 11) is the only chart component. Series use `chart-1` … `chart-6`, which meet 3:1 non-text contrast on the surface in both themes (WCAG 1.4.11). Values never depend on color alone: every series has a text legend, the chart's accessible name states the totals, and "Show as table" renders the same numbers as a table. No other chart library is used.

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

| Context | Treatment |
| --- | --- |
| Sidebar | `sidebar` background, `border-subtle` divider, `fg-secondary` labels with `fg-subtle` icons, `surface-hover` hover; active `surface-selected` fill, `fg` icon and medium label, 3px `action-primary` bar (`brand` is below 3:1 on the selected grey) |
| Inbox shell | Neutral: `canvas`, `surface` panels, `border-subtle`; conversation rows hover `surface-muted`, selected `surface-selected` + 3px `action-primary` inset, keyboard focus the shared focus ring; unread rows use semibold names, `fg` previews/times and an `action-primary` count |
| Inbox thread | `chat-canvas` with the original `chat-doodle` tile at 5% (`chat-pattern`, decorative, hidden for `prefers-contrast: more`); incoming `chat-incoming` + `chat-incoming-border` on the left, outgoing `chat-outgoing` on the right, both `shadow-raised`; the first bubble of a sender group squares its top corner on the sender's side; metadata and sent/delivered ticks `chat-meta`; read ticks `chat-read` |
| Internal notes | `chat-note` + `chat-note-border`, `chat-note-fg` "Internal" label |
| Inbox system event | `surface-muted` / `surface` pill with `fg-secondary` text |
| Human takeover | `status-info` badge and banner |
| AI handling, AI flow steps | `accent-automation` (violet) |
| Ordinary links | `textLink` (`@fenwira/ui`): `fg` text with a `border-control` underline that darkens to `fg` on hover; `Button` `link`/`tertiary` use it. Emerald is for primary actions only |
| Home | White cards on `canvas` with one header style (16/24 title, `border-subtle` divider, 12×16 padding); Needs attention marks its header amber only while items exist; conversation tiles `accent-conversation`, automation tiles `accent-automation`, campaign tiles neutral; `MetricCard` icon tiles are neutral by default with an optional `iconTone` |
| Tables (shared `Table`/`DataTable`) and Contacts directory | Row hover `surface-muted`, selected `surface-selected` (the checkbox also marks it), bulk-action bar `surface-muted` + `border-control`; long names truncate inside their column with the full name in the title/label; detail values wrap (`wrap-anywhere`) and empty fields show a muted dash read as "Not set" |
| Templates library and detail | White cards on `canvas`; status and category are separate labelled badges; the previewed card gets an `fg` outline, keyboard focus the `focus-ring` colour; Preview is a secondary button; rejection reasons are `status-error-fg` lines with an icon and failed submissions `status-warning-fg`; preview stages use `chat-canvas` |
| Campaigns | Status is the labelled badge only (no coloured card outline); artwork placeholders and summary icons are neutral; the stepper has charcoal labels with small emerald done/current markers; the delivery funnel uses `Progress` tones: sent emerald, delivered `status-success`, read `status-info` |
| Template variables `{{n}}` | `action-primary-subtle` chip, `action-primary` text |
| Template categories | Utility `status-info`, Marketing `category-marketing-*`, Authentication `category-authentication-*` |
| WhatsApp preview frame | `phone-bezel` frame, `chat-canvas` background, `whatsapp` channel mark |
| Flow nodes | trigger `inverse`, message `action-primary-subtle`, condition `status-warning-bg`, action `status-info-bg`, AI `accent-automation-bg`; selected `action-primary` ring; edges idle `fg-subtle`, traversed `action-primary` |

## 9. Enforcement

- `packages/ui/src/tokens.ts` is the only source of color values; `styles/tokens.css` is generated from it and pinned by a file snapshot (`tokens.test.ts`).
- `packages/ui/src/styles/theme.css` resets Tailwind's palette, type scale, radii and shadows; only tokens generate classes.
- `pnpm lint:design` rejects raw colors in `apps/web` and `packages/ui/src` (except `tokens.ts`, the generated `tokens.css` and `theme.css`), retired color token names, and arbitrary Tailwind values in `apps/web`.
- ESLint rejects direct imports of the underlying primitive libraries in `apps/web`.
- `packages/ui/test/tokens.test.ts` checks every contrast pairing above in both themes, the separation of the four greens and neutral dark surfaces.
- axe e2e (WCAG 2.2 A/AA) runs on every major page; see UX_PATTERNS.md → Quality gate.
- **Changing a token** means updating this document, `tokens.ts` and, where needed, the contrast pairs in the same change, then regenerating `tokens.css` with `pnpm --filter @fenwira/ui test -u`. Never weaken a contrast threshold to make a color pass.

## Experience V2 communication polish (2026-10-07)

> Token names in this and later dated sections are historical; see §1 for current roles.

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

> **Superseded tokens (2026-10-31):** the `inbox-*` palette below was folded into the shared semantic tokens (§1): actions → `action-primary*`, selection → `action-primary-subtle`, text/border → `fg`/`fg-secondary`/`border-subtle`, outbound → `chat-outgoing`, notes → `chat-note*`, follow-up → `status-warning-*`, avatars → `avatar-*-fg/-bg`. Geometry and behavior below still apply.

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
internal scrolling. Its empty height is approximately 126px on desktop and 134px on phones.
Compact Reply/Internal note tabs sit above one toolbar with only attachment and template icons
beside compact Send, grouped together at the right. Both icons have accessible labels/tooltips;
saved replies remain available through the `/` picker. A small gap
below the tabs and 8px input padding keep the writing area clear of the top edge.
Keyboard guidance lives in the Send tooltip;
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

### Template library polish

> **Superseded tokens (2026-10-31):** the `template-*` palette below now maps to semantic tokens (§1): border → `border-subtle`, preview stage → `chat-canvas`, approved/review/attention → `status-success`/`-warning`/`-error`, preview action → `action-primary-subtle(-hover)`, categories → `category-*`. Layout below still applies.

The Templates collection uses the existing warm `background` (#F7F7F4), a compact white filter
toolbar and a wrapper-free 3/2/1-column grid with 16–20px gaps. White cards use 12px corners,
16px padding, `template-border` (#E3E7E4), subtle hover elevation and visible keyboard focus.
Readable sentence-case titles (16px semibold) are derived only for display; exact identifiers
remain underneath in muted 12px text. Category/language sit below the title and approval status
has a consistent position. Footers align to the bottom of each row.

Scoped semantic colours:

| Meaning | Background token/value | Text token/value |
| --- | --- | --- |
| Utility | `info-soft` #EFF6FF | `info-strong` #1D4ED8 |
| Marketing | `template-marketing` #F5F3FF | `template-marketing-text` #6D28D9 |
| Authentication | `template-authentication` #FFF7ED | `template-authentication-text` #C2410C |
| Approved | `template-approved` #ECFDF5 | `template-approved-text` #047857 |
| In review | `template-review` #FFFBEB | `warning-strong` #B45309 |
| Needs attention | `template-attention` #FEF2F2 | `danger-strong` #B91C1C |
| Language/draft/zero counts | `neutral-soft` | `secondary` |

Preview stages use `template-preview` (#EEF4F0), a 192px height, a white 12px-radius bubble,
13px text, existing mint variable chips and a subtle bottom fade without nested scrolling.
Media, headers, footers and buttons retain stored content; full content remains in Preview.
The 32px eye-icon Preview button uses `template-preview-action` (#E8F5EF),
`template-preview-action-hover` (#D5EEE2) and `template-approved-text` (#047857), with 8px corners.
On hover, text uses existing `primary-strong-hover` (#006B54): #047857 on the requested hover
background has only 4.48:1 contrast, below AA for small text.
Status tabs retain their filtering semantics and show green/amber/red counts with neutral zeros;
the active tab is emerald. Create remains the primary solid action and Sync stays secondary.
No summary cards or unavailable overflow actions are added. The application remains light-only
(DS1); new colours are tokenized and contrast-tested without changing other modules.
