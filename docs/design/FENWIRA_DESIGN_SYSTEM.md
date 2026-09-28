# Fenwira Design System v1

**Status:** adopted 2026-09-27. Supersedes the Phase 2 contract in `docs/DESIGN_SYSTEM.md` (now a pointer here). Companion docs: [UX_PATTERNS.md](UX_PATTERNS.md) (page patterns, module UX, quality gate) and [UI_AUDIT.md](UI_AUDIT.md) (the baseline this version fixes).

Fenwira is a WhatsApp operations workspace that people keep open all day. The interface is **calm, dense, fast and trustworthy**: restrained surfaces, strong hierarchy, obvious system status, and no decoration that competes with the work. No gradients, glassmorphism, oversized cards, heavy shadows or marketing-sized headings inside the app.

This is a contract. Tokens live in `packages/ui` and are the only source of color, type, radius and elevation. Feature code uses semantic utilities (`bg-primary-strong`, `text-secondary`, `border-border`) and shared components. No dark mode in v2 (decision DS1); because everything is tokenized, a second token set can add it later.

## 1. Color

### Brand and neutrals

| Token | Hex | Role |
| --- | --- | --- |
| `primary` | `#00A884` | Fenwira action accent: active-nav indicator, focus ring, selection, checkbox/switch fill. **Non-text.** |
| `primary-hover` | `#008F70` | Hover of `primary` fills |
| `primary-soft` | `#E7FCE8` | Selected rows, outbound bubbles, variable chips |
| `primary-strong` / `-hover` | `#007F64` / `#006B54` | **Filled primary buttons** (white text) and primary-colored text/links |
| `whatsapp` | `#25D366` | WhatsApp channel identity only (the WhatsApp preview frame, "on WhatsApp" marks). Never an action color. |
| `slate` | `#0F172A` | Primary text, sidebar background |
| `slate-800` | `#1E293B` | Sidebar hover/active fill; text on `neutral-soft` table headers |
| `secondary` | `#475569` | Secondary text: descriptions, labels in dense rows, metadata that must stay readable |
| `muted` | `#64748B` | De-emphasized text: timestamps, hints, placeholders. **Never on `neutral-soft`** (4.34:1). |
| `slate-400` | `#94A3B8` | Idle icons, disabled glyphs, sidebar text on `slate`, idle flow edges |
| `background` | `#F8FAFC` | Application canvas |
| `surface` | `#FFFFFF` | Cards, panels, tables, dialogs |
| `border` | `#E2E8F0` | Dividers, card and table borders |
| `border-strong` | `#CBD5E1` | Form-control borders, emphasized dividers |
| `neutral-soft` | `#F1F5F9` | Table headers, neutral badges, system events |

**Fenwira primary ≠ WhatsApp green.** `#00A884` means "Fenwira action or selection". `#25D366` means "this is WhatsApp" (and, as `success`, a healthy state). They are different tokens so the two meanings can never be confused in code.

### Status

| Category | Meaning (examples) | Tokens | Text shade |
| --- | --- | --- | --- |
| Success | active, connected, approved, delivered, read, healthy, granted, window open | `success` `#25D366`, `success-soft` `#D1FAE5` | `success-strong` `#166534` |
| Warning | paused, attention required, low balance, opted out, window closed | `warning` `#F59E0B`, `warning-soft` `#FEF3C7` | `warning-strong` `#B45309` |
| Danger | failed, rejected, disconnected, destructive | `danger` `#DC2626`, `danger-soft` `#FEE2E2` | `danger-strong` `#B91C1C` (hover `#991B1B`) |
| Info | scheduled, processing, syncing, sent, running, open, human takeover | `info` `#2563EB`, `info-soft` `#EFF6FF` | `info-strong` `#1D4ED8` |
| Neutral | draft, archived, inactive, cancelled, skipped | `neutral-soft` | `secondary` |

### Contrast (verified by `packages/ui/test/tokens.test.ts`)

Every text pairing below clears WCAG AA 4.5:1; the test fails if a token change breaks one.

| Pair | Ratio |
| --- | --- |
| White on `primary-strong` | 4.98 |
| White on `danger` / `danger-strong` | 4.83 / 6.47 |
| White on `info` / `info-strong` | 5.17 / 6.70 |
| `success-strong` on white / on `success-soft` | 7.13 / 6.29 |
| `warning-strong` on white / on `warning-soft` | 5.02 / 4.51 |
| `info-strong` on `info-soft` | 6.16 |
| `danger-strong` on `danger-soft` | 5.30 |
| `secondary` on white / `background` / `neutral-soft` | 7.58 / 7.24 / 6.92 |
| `muted` on white / `background` | 4.76 / 4.55 |
| `slate` on every soft tint | ≥ 13 |

Rules that follow from the numbers:

1. `primary`, `success` and `warning` are **never text colors** (3.03, 1.98, 2.15 on white). Use them for indicators, icons beside text, dots, borders and fills behind dark text. Colored text uses the `-strong` shade.
2. Filled buttons use `primary-strong` or `danger-strong` with white text.
3. `muted` is not allowed on `neutral-soft` (4.34). Use `secondary` or `slate-800` there.
4. Focus rings use `primary` (3.03:1 on white meets the 3:1 non-text minimum).
5. Form controls use `border-strong`. Their boundary alone is below 3:1 (1.48), so every control also has a visible label; the focus state is the 3:1 indicator (WCAG 1.4.11 exception for components identified by their label).

### Status is never color alone

A status always shows a **label**, and usually an icon. `StatusBadge` is the only way to render a domain status: feature code passes the status key (`status="FAILED"`) and never picks a tone. `STATUS_PRESETS` in `packages/ui/src/components/status-badge.tsx` is the single mapping from status to category, label and icon. User-chosen colors (tags) use `Badge` with the tag's tone; they are labels, not statuses.

### Charts

`TrendChart` (Phase 11) is the only chart component. Series use `primary-strong`, `info`, `success-strong`, `danger`, `warning-strong` and `secondary`, which all meet 3:1 non-text contrast on the surface (WCAG 1.4.11). Values never depend on color alone: every series has a text legend, the chart's accessible name states the totals, and "Show as table" renders the same numbers as a table. No other chart library is used.

## 2. Typography

Font: Inter for UI, JetBrains Mono for identifiers, phone numbers and code (loaded with `next/font`).

| Role | Size / line (px) | Utility | Weight |
| --- | --- | --- | --- |
| Page title | 24 / 32 | `text-2xl` | semibold (via `PageHeader`) |
| Section title | 18 / 28 | `text-lg` | semibold (via `SectionHeader`) |
| Card title | 16 / 24 | `text-md` | semibold (via `CardTitle`) |
| Body | 14 / 20 | `text-base` | regular |
| Body strong | 14 / 20 | `text-base font-medium` | medium |
| Small | 13 / 18 | `text-sm` | regular |
| Caption | 12 / 16 | `text-xs` | regular / medium |
| Metric value | 24 / 32 | `text-2xl tabular-nums` | semibold (via `MetricCard`) |

`text-3xl` (30/36) is reserved for authentication and onboarding screens. Application pages never use headings larger than the page title. Headings follow document order (one `h1` per page from `PageHeader`, `h2` for sections, `h3` inside cards).

## 3. Spacing

Tailwind's 4px scale, used from this set: **4, 8, 12, 16, 20, 24, 32, 40, 48, 64** (`1, 2, 3, 4, 5, 6, 8, 10, 12, 16`). Arbitrary values (`p-[13px]`) are rejected by `pnpm lint:design`.

| Context | Value |
| --- | --- |
| Page gutter | 16 (mobile) / 24 (≥ md) |
| Page sections | 24 between sections |
| Card padding | 20 (`p-5`); dense panels 16 (`p-4`) |
| Form field stack | 16 between fields; 6 label → control |
| Table cell | 10 vertical × 12 horizontal (40px rows); header 40px |
| Inline groups | 8 (buttons, badges), 12 (icon + text blocks) |

## 4. Shape and elevation

| Element | Radius |
| --- | --- |
| Buttons, small controls | 6 (`rounded-sm`) |
| Inputs, selects, badges, panels | 8 (`rounded-md`) |
| Cards, tables | 12 (`rounded-lg`) |
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
| Sidebar | `slate` background; `slate-400` items; active item `slate-800` fill, white text, 3px `primary` indicator |
| Inbox outbound / inbound bubble | `primary-soft` / `surface` + `border` |
| Inbox selected conversation | `primary-soft` + 3px `primary` left border |
| Inbox system event / internal note | `neutral-soft` pill / `warning-soft` with an "Internal" label |
| Human takeover | `info` badge and banner |
| Template variables `{{n}}` | `primary-soft` chip, `primary-strong` text |
| WhatsApp preview frame | `neutral-soft` chat background, `surface` bubble, `whatsapp` channel mark |
| Flow nodes | trigger `slate`, message `surface`, condition `warning-soft`, action `info-soft`; selected `primary` ring; edges idle `slate-400`, traversed `primary` |

## 9. Enforcement

- `packages/ui/src/styles/theme.css` resets Tailwind's palette, type scale, radii and shadows; only tokens generate classes.
- `pnpm lint:design` rejects raw colors in `apps/web` and `packages/ui/src` (except `tokens.ts` and `theme.css`) and arbitrary Tailwind values in `apps/web`.
- ESLint rejects direct imports of the underlying primitive libraries in `apps/web`.
- `packages/ui/test/tokens.test.ts` pins the palette and every contrast pairing above.
- axe e2e (WCAG 2.2 A/AA) runs on every major page; see UX_PATTERNS.md → Quality gate.
- **Changing a token** means updating this document, `tokens.ts`, `theme.css` and the contrast test in the same change.
